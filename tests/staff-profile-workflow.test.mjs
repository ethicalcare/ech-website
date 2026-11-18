import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,readFile,writeFile,rename,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {createStaffProfileWorkflow} from '../lib/admin/staff-profile-workflow.js';
const staff={active:true,user_id:'fictional-staff',operational_role:'staff'};
const admin={active:true,user_id:'fictional-admin',operational_role:'manager',delegated_user_admin:true,application_admin:false,technical_admin:false};
// Local fictional persistence harness, not a production adapter. Each transaction
// writes an atomic replacement; this sequential test does not claim concurrency.
function repository(path){return {read:async id=>(JSON.parse(await readFile(path,'utf8')))[id],pending:async()=>Object.values(JSON.parse(await readFile(path,'utf8'))).filter(r=>r.pending),transact:async(id,fn)=>{const all=JSON.parse(await readFile(path,'utf8'));const result=fn(all[id]);await writeFile(path+'.next',JSON.stringify(all));await rename(path+'.next',path);return result;}};}
test('persisted staff submission, admin notification queue, approval, direct edit and credential renewal',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ech-profile-fictional-'));const path=join(dir,'profiles.json');
 try{
  await writeFile(path,JSON.stringify({'fictional-staff':{profile:{id:'fictional-staff',name:'Fictional staff',revision:1,workerType:'care_aide',availability:'Weekdays',vacationStart:'',vacationEnd:'',photo:null,credentials:[],payGrade:'Private grade',hourlyRate:'Private rate',performance:'Private notes'},pending:null,events:[]}}));
  let workflow=createStaffProfileWorkflow(repository(path),{now:()=> '2026-11-18T12:00:00Z',id:()=> 'submission-1'});
  const submitted=await workflow.change(staff,staff.user_id,1,{availability:'Mondays',vacationStart:'2026-12-01',vacationEnd:'2026-12-03',photo:{objectKey:'private/fictional-photo',contentType:'image/png'},credentials:[{id:'first-aid',name:'First aid',expiresOn:'2027-11-18'},{id:'language',name:'Language',expiresOn:null}]});
  assert.equal(submitted.status,'pending_review');
  // Fresh workflow/repository proves readback from disk rather than component state.
  workflow=createStaffProfileWorkflow(repository(path),{now:()=> '2026-11-18T12:01:00Z'});
  assert.equal((await workflow.read(staff,staff.user_id)).profile.availability,'Weekdays');
  const inbox=await workflow.inbox(admin);assert.equal(inbox.length,1);assert.equal(inbox[0].changes.availability,'Mondays');
  await workflow.approve(admin,staff.user_id,submitted.submissionId);
  const after=await workflow.read(staff,staff.user_id);assert.equal(after.profile.availability,'Mondays');assert.equal(after.pending,null);assert.equal(after.profile.payGrade,undefined);assert.equal(after.profile.performance,undefined);
  const saved=await workflow.change(admin,staff.user_id,2,{payGrade:'Updated private grade'});assert.equal(saved.status,'saved');assert.equal((await workflow.inbox(admin)).length,0);
  await workflow.verifyCredential(admin,staff.user_id,3,'first-aid');
  assert.equal((await workflow.read(staff,staff.user_id)).profile.credentials[0].verifiedBy,admin.user_id);
  const renewal=await workflow.change(staff,staff.user_id,4,{credentials:[{id:'first-aid',name:'First aid',expiresOn:'2028-11-18'}]});
  await workflow.approve(admin,staff.user_id,renewal.submissionId);
  const renewed=(await workflow.read(staff,staff.user_id)).profile.credentials[0];assert.equal(renewed.expiresOn,'2028-11-18');assert.equal(renewed.verifiedBy,null);
  await assert.rejects(()=>workflow.change(staff,staff.user_id,5,{hourlyRate:'Not allowed'}),{code:'forbidden_field'});
  await assert.rejects(()=>workflow.inbox(staff),{code:'forbidden'});
 }finally{await rm(dir,{recursive:true,force:true});}
});
