import test from 'node:test';
import assert from 'node:assert/strict';
import {readOperations} from '../lib/admin/operations-read-dispatch.js';
import {createVisitActionsClient} from '../admin-src/app/shared/visit-action-client.ts';
const actor='10000000-0000-4000-8000-000000000001',visitId='20000000-0000-4000-8000-000000000001';
const flags={ECH_HOSTED_OPERATIONS_READS:'true',ECH_HOSTED_OPERATIONS_WRITES:'true',ECH_HOSTED_VISIT_ACTIONS:'true'};
const current=(role='staff')=>({principal:{id:actor,operationalRole:role},member:{active:true,operational_role:role,revision:5}});
const request=(query='commands=1',role='staff')=>new Request('https://example.invalid/api/admin/operations?'+query,{headers:{'x-ech-schedule-actor':actor,'x-ech-schedule-role':role}});
const noProvider=()=>assert.fail('Availability must not invoke provider or write RPC');
test('availability requires all hosted write admissions and accepts mapped managerial roles without granting assignment',async()=>{
 for(const role of ['staff','manager','owner']) assert.deepEqual(await readOperations(current(role),request('commands=1',role),noProvider,flags),{schema:1,enabled:true,membershipRevision:5});
 for(const key of Object.keys(flags)) for(const value of [undefined,false,true,'TRUE',' true','false']) {
  assert.equal((await readOperations(current(),request(),noProvider,{...flags,[key]:value,ECH_LOCAL_VISIT_ACTIONS:true})).enabled,false);
 }
});
test('availability rejects malformed selectors, wrong actor scope and invalid revision',async()=>{
 for(const query of ['commands=0','commands=1&commands=1','commands=1&report='+visitId]) await assert.rejects(readOperations(current(),request(query),noProvider,flags),e=>e.status===400);
 await assert.rejects(readOperations(current(),request('commands=1','owner'),noProvider,flags),e=>e.status===409);
 await assert.rejects(readOperations({...current(),member:{...current().member,revision:0}},request(),noProvider,flags),e=>e.status===503);
 await assert.rejects(readOperations({...current(),member:{...current().member,active:false}},request(),noProvider,flags),e=>e.status===403);
});
const fields={summary:'Fictional report',issue:'',actualStart:'2026-11-01T10:00:00.000Z',actualEnd:'2026-11-01T11:00:00.000Z',completedTasks:['Fictional task'],observations:''};
const action=()=>({schema:1,operationId:crypto.randomUUID(),visitId,visitRevision:2,reportRevision:0,membershipRevision:5,command:{type:'submit',outcome:'completed',...fields}});
function setup(){const a=action();const at='2026-11-01T12:00:00.000Z';const receipt={schema:1,operationId:a.operationId,visitId,visitRevision:3,reportRevision:1,reportVersion:0,action:'submit',recordedAt:at};const report={visitId,visitRevision:3,reportRevision:1,versions:[{revision:1,version:0,actorId:actor,actorRole:'staff',recordedAt:at,reason:null,outcome:'completed',...fields}],reviews:[]};return {a,report,client:createVisitActionsClient(async()=>Response.json(receipt),actor,'staff')};}
test('acknowledged report requires pinned scoped detail and matching event readback before success',async()=>{
 const {a,report,client}=setup();const calls=[];
 const result=await client.commit(a,new AbortController().signal,{id:visitId,revision:2,status:'In progress'},async(id,rev)=>{calls.push(['detail',id,rev]);return {};},async(id,rev,signal,reportRev)=>{calls.push(['report',id,rev,reportRev]);return report;});
 assert.deepEqual(calls,[['detail',visitId,3],['report',visitId,3,1]]);assert.equal(result.visit.status,'Completed');
});
test('acknowledged writes stay unconfirmed after missing, failed or mismatched report readback',async()=>{
 for(const change of [()=>null,r=>({...r,versions:[]}),r=>({...r,versions:[{...r.versions[0],summary:'Different content'}]}),()=>{throw Error('read failed');}]) {
  const {a,report,client}=setup();await assert.rejects(client.commit(a,new AbortController().signal,{id:visitId,revision:2,status:'In progress'},async()=>({}),async()=>change(report)),{code:'write_unconfirmed'});
 }
});
test('review eligibility rejects original/latest author and staff, permits independent manager for server recheck',()=>{
 const report={versions:[{actorId:actor},{actorId:'other'}]};
 assert.equal(createVisitActionsClient(noProvider,actor,'manager').reviewEligibility(report).allowed,false);
 assert.equal(createVisitActionsClient(noProvider,'other','manager').reviewEligibility(report).allowed,false);
 assert.equal(createVisitActionsClient(noProvider,'third','staff').reviewEligibility(report).allowed,false);
 assert.equal(createVisitActionsClient(noProvider,'third','manager').reviewEligibility(report).allowed,true);
});
test('commit binds the supplied visit identity and revision before sending',async()=>{
 const a=action();let calls=0;const client=createVisitActionsClient(async()=>{calls++;throw Error('must not send');},actor,'staff');
 for(const visit of [{id:'other-visit',revision:2},{id:visitId,revision:1},null]) await assert.rejects(client.commit(a,new AbortController().signal,visit,async()=>({}),async()=>null),{code:'stale_visit'});
 assert.equal(calls,0);
});
test('malformed successful receipts and body-stream errors remain unconfirmed without raw details',async()=>{
 for(const response of [new Response('{broken',{headers:{'content-type':'application/json'}}),new Response(new ReadableStream({start(c){c.error(Error('private-provider-detail'));}}),{headers:{'content-type':'application/json'}})]) {
  const a=action(),client=createVisitActionsClient(async()=>response,actor,'staff');
  await assert.rejects(client.commit(a,new AbortController().signal,{id:visitId,revision:2},async()=>({}),async()=>null),error=>error.code==='write_unconfirmed'&&!error.message.includes('private-provider-detail'));
 }
});
test('cancellation during response-body read is preserved rather than replaced with uncertainty',async()=>{
 const controller=new AbortController(),a=action();
 const client=createVisitActionsClient(async()=>new Response(new ReadableStream({pull(c){controller.abort(new DOMException('Cancelled','AbortError'));c.error(Error('stream failed'));}}),{headers:{'content-type':'application/json'}}),actor,'staff');
 await assert.rejects(client.commit(a,controller.signal,{id:visitId,revision:2},async()=>({}),async()=>null),{name:'AbortError'});
});
test('internal request deadline after sending remains write_unconfirmed',async t=>{
 const deadline=new AbortController();t.mock.method(AbortSignal,'timeout',()=>deadline.signal);
 const a=action(),client=createVisitActionsClient(async()=>{deadline.abort(new DOMException('Timed out','TimeoutError'));throw deadline.signal.reason;},actor,'staff');
 await assert.rejects(client.commit(a,new AbortController().signal,{id:visitId,revision:2},async()=>({}),async()=>null),{code:'write_unconfirmed'});
});
