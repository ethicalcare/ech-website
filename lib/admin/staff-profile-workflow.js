import {capabilities} from './permissions.js';
// Repository contract: read(id), pending(), and transact(id, callback). The
// transaction atomically stores {profile,pending,events}, returning callback result.
// Production adapters must also enforce current authorization at the database.
const publicFields=['workerType','availability','vacationStart','vacationEnd','photo','credentials'];
const privateFields=['payGrade','hourlyRate','performance'];
const fields=[...publicFields,...privateFields];
const manager=member=>capabilities(member).includes('users.manage');
function fail(code){throw Object.assign(new Error(code),{code});}
function authorize(member,id){if(!member?.active||(!manager(member)&&(member.operational_role!=='staff'||member.user_id!==id)))fail('forbidden');}
export function cleanChanges(input,admin){
 if(!input||Array.isArray(input)||typeof input!=='object')fail('invalid_profile');
 const result={};
 for(const [key,value]of Object.entries(input)){
  if(!fields.includes(key)||(!admin&&privateFields.includes(key)))fail('forbidden_field');
  if(key==='photo'){
   if(value!==null&&(!value||Object.keys(value).sort().join(',')!=='contentType,objectKey'||!['image/jpeg','image/png','image/webp'].includes(value.contentType)||typeof value.objectKey!=='string'||!value.objectKey||value.objectKey.length>300))fail('invalid_photo');
   result[key]=value===null?null:{objectKey:value.objectKey,contentType:value.contentType};
  }else if(key==='credentials'){
   if(!Array.isArray(value)||value.length>50)fail('invalid_credentials');
   const ids=new Set();result[key]=value.map(c=>{
    if(!c||Object.keys(c).some(k=>!['id','name','expiresOn'].includes(k))||typeof c.id!=='string'||!c.id||c.id.length>100||ids.has(c.id)||typeof c.name!=='string'||!c.name.trim()||c.name.length>200)fail('invalid_credentials');ids.add(c.id);
    if(c.expiresOn!==null&&!validDate(c.expiresOn))fail('invalid_expiry');
    return {id:c.id,name:c.name.trim(),expiresOn:c.expiresOn,verifiedBy:null,verifiedAt:null};
   });
  }else{
   if(typeof value!=='string'||value.length>2000)fail('invalid_profile');
   if(key==='workerType'&&!['','care_aide','lpn','rn'].includes(value))fail('invalid_worker_type');
   if(['vacationStart','vacationEnd'].includes(key)&&value!==''&&!validDate(value))fail('invalid_vacation');
   result[key]=value;
  }
 }
 if(!Object.keys(result).length)fail('no_changes');return result;
}
function validDate(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const date=new Date(value+'T00:00:00Z');return Number.isFinite(+date)&&date.toISOString().slice(0,10)===value;}
function validateMerged(profile,changes){const p={...profile,...changes};if((p.vacationStart||p.vacationEnd)&&(!p.vacationStart||!p.vacationEnd||p.vacationStart>p.vacationEnd))fail('invalid_vacation');}
function project(profile,admin){const output={id:profile.id,name:profile.name,revision:profile.revision};for(const field of admin?fields:publicFields)if(Object.hasOwn(profile,field))output[field]=structuredClone(profile[field]);return output;}
export function createStaffProfileWorkflow(repository,{now=()=>new Date().toISOString(),id=()=>crypto.randomUUID()}={}){
 return {
  async read(member,target){authorize(member,target);const record=await repository.read(target);if(!record)fail('not_found');return {profile:project(record.profile,manager(member)),pending:record.pending?{id:record.pending.id,submittedAt:record.pending.submittedAt,status:'pending_review'}:null};},
  async change(member,target,expectedRevision,input){
   authorize(member,target);const admin=manager(member);const changes=cleanChanges(input,admin);
   return repository.transact(target,record=>{
    if(!record||record.profile.revision!==expectedRevision)fail('stale_profile');validateMerged(record.profile,changes);
    if(changes.credentials)changes.credentials=changes.credentials.map(c=>{const previous=record.profile.credentials?.find(old=>old.id===c.id&&old.name===c.name&&old.expiresOn===c.expiresOn);return previous?{...c,verifiedBy:previous.verifiedBy,verifiedAt:previous.verifiedAt}:c;});
    if(!admin){if(record.pending)fail('pending_review');const submissionId=id();record.pending={id:submissionId,actor:member.user_id,submittedAt:now(),expectedRevision,changes};record.events.push({action:'submitted',actor:member.user_id,at:now(),submissionId});return {status:'pending_review',submissionId};}
    record.profile={...record.profile,...changes,revision:record.profile.revision+1};record.pending=null;record.events.push({action:'admin_saved',actor:member.user_id,at:now()});return {status:'saved',profile:project(record.profile,true)};
   });
  },
  async inbox(member){if(!manager(member))fail('forbidden');const records=await repository.pending();return records.map(record=>({id:record.pending.id,staffId:record.profile.id,staffName:record.profile.name,submittedAt:record.pending.submittedAt,changes:structuredClone(record.pending.changes)}));},
  async approve(member,target,submissionId){if(!manager(member))fail('forbidden');return repository.transact(target,record=>{
   if(!record?.pending||record.pending.id!==submissionId||record.pending.expectedRevision!==record.profile.revision)fail('stale_submission');
   record.profile={...record.profile,...record.pending.changes,revision:record.profile.revision+1};record.events.push({action:'approved',actor:member.user_id,at:now(),submissionId});record.pending=null;return {status:'saved',profile:project(record.profile,true)};
  });},
  async verifyCredential(member,target,expectedRevision,credentialId){if(!manager(member))fail('forbidden');return repository.transact(target,record=>{
   if(record?.pending)fail('pending_review');
   if(!record||record.profile.revision!==expectedRevision)fail('stale_profile');
   const credential=record.profile.credentials?.find(c=>c.id===credentialId);if(!credential)fail('credential_not_found');credential.verifiedBy=member.user_id;credential.verifiedAt=now();record.profile.revision++;
   record.events.push({action:'credential_verified',actor:member.user_id,at:now(),credentialId});return {status:'saved',profile:project(record.profile,true)};
  });}
 };
}
