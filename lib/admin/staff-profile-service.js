import {AdminError,UUID,exact} from './shared-commands.js';
import {rpc} from './shared-repository.js';
import {capabilities} from './permissions.js';
import {cleanChanges} from './staff-profile-workflow.js';
const managementKeys=['payGrade','hourlyRate','performance'];
const isManager=current=>capabilities(current.member).includes('users.manage');
function target(current,id){if(!UUID.test(id||''))throw new AdminError(400,'invalid_request','Choose a staff profile.');if(!isManager(current)&&current.member.user_id!==id)throw new AdminError(403,'forbidden','This profile is not available.');}
function projection(snapshot,manager){if(!snapshot?.profile||!Number.isSafeInteger(snapshot.storageVersion)||snapshot.storageVersion<1)throw new AdminError(404,'not_found','This staff profile has not been created yet.');const p=snapshot.profile;
 const profile={id:p.id,name:p.name,revision:p.revision,workerType:p.workerType||'',availability:p.availability||'',vacationStart:p.vacationStart||'',vacationEnd:p.vacationEnd||'',credentials:p.credentials||[],photo:p.photo||null};
 if(manager)profile.management=Object.fromEntries(managementKeys.map(key=>[key,p[key]||'']));
 const pending=snapshot.pending?{id:snapshot.pending.id,submittedAt:snapshot.pending.submittedAt,status:'pending_review',...(manager?{changes:snapshot.pending.changes,stale:snapshot.pending.stale}: {})}:null;
 return {schema:1,profile,pending};
}
export async function readStaffProfile(current,id,fetcher){target(current,id);return projection(await rpc(current,'ech_staff_profile_store_read',{p_staff:id},fetcher),isManager(current));}
export async function changeStaffProfile(current,body,fetcher){
 exact(body,['action','id'],['expectedRevision','changes','submissionId','credentialId']);target(current,body.id);
 const manager=isManager(current);if(!['save','initialize','approve','verify'].includes(body.action))throw new AdminError(400,'invalid_request','Choose a profile action.');
 if(body.action!=='save'&&!manager)throw new AdminError(403,'forbidden','Only management can perform this action.');
 let snapshot=await rpc(current,'ech_staff_profile_store_read',{p_staff:body.id},fetcher);
 if(body.action==='initialize'){
  if(snapshot)throw new AdminError(409,'conflict','Profile already exists.');
  await rpc(current,'ech_staff_profile_store_write',{p_staff:body.id,p_expected_version:0,p_action:'initialized',p_changes:null},fetcher);
  return {status:'saved',...(await readStaffProfile(current,body.id,fetcher))};
 }
 if(!snapshot?.profile)throw new AdminError(404,'not_found','Create the staff profile first.');
 if(body.action==='save'&&body.expectedRevision!==snapshot.profile.revision)throw new AdminError(409,'conflict','Profile changed. Reload before saving.');
 let changes=null;try{if(body.action==='save')changes=cleanChanges(body.changes,manager);}catch{throw new AdminError(400,'invalid_request','Review the profile fields.');}
 if(changes?.photo&&(!changes.photo.objectKey.startsWith(body.id+'/')||changes.photo.objectKey.includes('..')))throw new AdminError(400,'invalid_request','Choose a photo uploaded for this staff profile.');
 const submission=body.action==='approve'?body.submissionId:!manager&&body.action==='save'?crypto.randomUUID():null;
 if(body.action==='approve'&&(!UUID.test(submission||'')||snapshot.pending?.id!==submission))throw new AdminError(409,'conflict','Submission changed. Reload it.');
 if(body.action==='verify'&&snapshot.pending)throw new AdminError(409,'conflict','Resolve the pending profile submission before verifying credentials.');
 if(body.action==='verify'&&(typeof body.credentialId!=='string'||!body.credentialId||body.credentialId.length>100))throw new AdminError(400,'invalid_request','Choose a credential.');
 const action=body.action==='save'?(manager?'admin_saved':'submitted'):body.action==='approve'?'approved':'credential_verified';
 const receipt=await rpc(current,'ech_staff_profile_store_write',{p_staff:body.id,p_expected_version:snapshot.storageVersion,p_action:action,p_changes:changes,p_submission:submission,p_credential:body.action==='verify'?body.credentialId:null},fetcher);
 if(receipt?.storageVersion!==snapshot.storageVersion+1||receipt.status!==(action==='submitted'?'pending_review':'saved'))throw new AdminError(502,'write_unconfirmed','Save could not be confirmed. Reload the profile.');
 if(action==='submitted')return {status:'pending_review',submissionId:submission};
 return {status:'saved',...(await readStaffProfile(current,body.id,fetcher))};
}
