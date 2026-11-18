import test from 'node:test';import assert from 'node:assert/strict';
import {readStaffProfile,changeStaffProfile} from '../lib/admin/staff-profile-service.js';
const id='11111111-1111-4111-8111-111111111111';const manager={member:{active:true,application_admin:true},config:{base:'https://example.test',key:'fixture'},token:'fixture'};
const staff={...manager,member:{active:true,user_id:id,operational_role:'staff'}};
test('normal save uses current storage version and confirmed readback',async()=>{
 let state={storageVersion:1,profile:{id,name:'Test',revision:1,availability:'Weekdays'}};const calls=[];
 const fetcher=async(url,options)=>{const body=JSON.parse(options.body);calls.push(body);if(url.endsWith('_write')){state={storageVersion:2,profile:{...state.profile,...body.p_changes,revision:2}};return Response.json({storageVersion:2,status:'saved'});}return Response.json(state);};
 const result=await changeStaffProfile(manager,{action:'save',id,expectedRevision:1,changes:{availability:'Monday'}},fetcher);
 assert.equal(result.profile.availability,'Monday');assert.equal(calls[1].p_action,'admin_saved');assert.equal(calls[1].p_expected_version,1);
});
test('staff submits all sections once without management fields in readback',async()=>{
 const state={storageVersion:3,profile:{id,name:'Test',revision:2,payGrade:'PRIVATE',hourlyRate:'SECRET',performance:'PRIVATE'}};let write;
 const fetcher=async(url,options)=>{if(url.endsWith('_write')){write=JSON.parse(options.body);return Response.json({storageVersion:4,status:'pending_review'});}return Response.json(state);};
 const result=await changeStaffProfile(staff,{action:'save',id,expectedRevision:2,changes:{availability:'Tuesday',credentials:[{id:'first-aid',name:'First aid',expiresOn:null}]}},fetcher);
 assert.equal(result.status,'pending_review');assert.equal(write.p_action,'submitted');assert.equal(write.p_changes.credentials.length,1);
 const view=await readStaffProfile(staff,id,fetcher);assert.equal(view.profile.management,undefined);assert.doesNotMatch(JSON.stringify(view),/PRIVATE|SECRET/);
});
test('management resolves a pending profile before verifying saved credentials',async()=>{
 let writes=0;const fetcher=async url=>{if(url.endsWith('_write'))writes++;return Response.json({storageVersion:2,profile:{id,revision:1},pending:{id:'33333333-3333-4333-8333-333333333333'}});};
 await assert.rejects(changeStaffProfile(manager,{action:'verify',id,credentialId:'first-aid'},fetcher),/Resolve the pending profile/);assert.equal(writes,0);
});
