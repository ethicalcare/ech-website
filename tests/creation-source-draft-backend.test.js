import test from 'node:test';
import assert from 'node:assert/strict';
import { handleAdmin } from '../lib/admin/handler.js';
import { operationsCommandLimit } from '../lib/admin/operations-write-dispatch.js';
import { creationDraftEnvelope, sameCreationDraftRequest } from '../lib/operations/schedule-draft-wire.js';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const env={ADMIN_ORIGIN:'https://staff.example.invalid',SUPABASE_URL:'https://abcdefghijklmnopqrst.supabase.co',SUPABASE_PUBLISHABLE_KEY:'fictional-key',ECH_HOSTED_OPERATIONS_READS:'true',ECH_HOSTED_OPERATIONS_WRITES:'true',ECH_HOSTED_SCHEDULE_COMMANDS:'true'};
const source={clientId:id(3),clientName:'Fictional client',service:'Home support',area:'Fictional area',instructionsVersion:1,instructionsSavedAt:'2026-11-01T00:00:00.000001Z',confirmedAt:'2026-11-01T00:01:00.000001Z',inquiryId:null,inquiryRevision:null,sourceToken:'a'.repeat(64)};
const creation={schema:1,operationId:id(1),visitId:id(2),visitRevision:0,membershipRevision:5,command:{type:'create',clientId:id(3),workerId:null,service:'Home support',source,start:'2026-11-01T17:00:00.000Z',end:'2026-11-01T18:00:00.000Z'}};
const result={visit:{id:id(2),clientId:id(3),workerId:null,service:'Home support',start:creation.command.start,end:creation.command.end,status:'Open',revision:1},receipt:{operationId:id(1),expectedRevision:0,revision:1}};
const draft=(action='recover',request=null)=>({action,membershipRevision:5,request,reservedRole:null});
function request(body, {query=body?'creationDraft=1':'scheduleSources=1&membershipRevision=5',actor=id(9),role='manager',origin=env.ADMIN_ORIGIN,cookie=true}={}) {
 return new Request(env.ADMIN_ORIGIN+'/api/admin/operations?'+query,{method:body?'POST':'GET',headers:{...(cookie?{cookie:'__Host-ech-access=fictional-token'}:{}),origin,'x-ech-schedule-actor':actor,'x-ech-schedule-role':role,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
}
function fixture({role='manager',revision=5,active=true,session=true,respond}={}){
 const calls=[];return {calls,fetcher:async(url,options)=>{
  const path=new URL(url).pathname;calls.push({path,options});
  if(path==='/auth/v1/user')return Response.json({id:id(9),email:'fictional@example.invalid'});
  if(path==='/rest/v1/ech_memberships')return Response.json([{user_id:id(9),active,operational_role:role,revision}]);
  if(path==='/rest/v1/rpc/ech_session_active')return Response.json(session);
  assert.ok(['/rest/v1/rpc/ech_operations_schedule_sources','/rest/v1/rpc/ech_operations_creation_draft'].includes(path),'Unexpected RPC '+path);
  assert.equal(options.headers.Authorization,'Bearer fictional-token');assert.equal(options.cache,'no-store');assert.equal(options.redirect,'manual');
  return respond?respond(path,JSON.parse(options.body)):Response.json({schema:1,draft:null});
 }};
}
const run=(p,r=request(),config=env)=>handleAdmin('operations',r,config,p.fetcher);
const rpcCalls=p=>p.calls.filter(c=>c.path.endsWith('ech_operations_schedule_sources')||c.path.endsWith('ech_operations_creation_draft'));
test('source selector returns only exact manager-reviewed provenance with role and membership pins',async()=>{
 for(const role of ['owner','manager']){
  const p=fixture({role,respond:(path,body)=>{assert.ok(path.endsWith('ech_operations_schedule_sources'));assert.deepEqual(body,{p_expected_role:role,p_membership_revision:5});return Response.json({schema:1,membershipRevision:5,sources:[source]});}});
  const r=await run(p,request(undefined,{role}));assert.equal(r.status,200);assert.equal(r.headers.get('Cache-Control'),'no-store');assert.deepEqual(await r.json(),{schema:1,membershipRevision:5,sources:[source]});
 }
});
test('source selectors, manager role, session and current identity fail closed before source RPC',async()=>{
 for(const [cfg,opts,status] of [[{}, {query:'scheduleSources=1&membershipRevision=4'},409],[{},{query:'scheduleSources=1&membershipRevision=05'},400],[{},{query:'scheduleSources=1&membershipRevision=5&extra=1'},400],[{},{query:'scheduleSources=1&scheduleSources=1&membershipRevision=5'},400],[{role:'staff'},{role:'staff'},403],[{active:false},{},403],[{session:false},{},401],[{},{cookie:false},401],[{},{actor:id(99)},409],[{},{role:'owner'},409]]){
  const p=fixture(cfg),r=await run(p,request(undefined,opts));assert.equal(r.status,status);assert.equal(rpcCalls(p).length,0);
 }
});
test('invalid provenance, duplicate identity, membership drift and malformed/oversized source streams reveal no data',async()=>{
 const valid={schema:1,membershipRevision:5,sources:[source]};
 for(const value of [{...valid,membershipRevision:6},{...valid,sources:[source,source]},{...valid,sources:[{...source,sourceToken:'unverified'}]},{...valid,sources:[{...source,inquiryId:id(7)}]},{...valid,private:'private-marker'}]){
  const p=fixture({respond:()=>Response.json(value)}),r=await run(p);assert.equal(r.status,503);assert.doesNotMatch(await r.text(),/private-marker|Fictional client/);
 }
 for(const respond of [()=>new Response('x'.repeat(100001),{headers:{'Content-Type':'application/json'}}),()=>new Response(new Uint8Array([0xff]),{headers:{'Content-Type':'application/json'}}),()=>{throw Error('private-marker');}]){
  const r=await run(fixture({respond}));assert.equal(r.status,503);assert.doesNotMatch(await r.text(),/private-marker/);
 }
});
test('draft actions preserve exact immutable request and validated receipts through existing RPC contract',async()=>{
 for(const [action,state] of [['reserve','pending'],['inspect','pending'],['cancel','cancelled'],['resolve','resolved']]){
  const p=fixture({respond:(path,body)=>{assert.ok(path.endsWith('ech_operations_creation_draft'));assert.deepEqual(body,{p_action:action,p_role:'manager',p_revision:5,p_envelope:creationDraftEnvelope(creation,'manager')});return Response.json({schema:1,draft:{envelope:body.p_envelope,state,result:state==='resolved'?result:null}});}});
  const r=await run(p,request(draft(action,creation)));assert.equal(r.status,200);assert.deepEqual(await r.json(),{schema:1,draft:{request:creation,reservedRole:'manager',state,result:state==='resolved'?result:null}});
 }
 assert.equal(sameCreationDraftRequest(creation,structuredClone(creation)),true);
});
test('recover and cancellation retain old exact membership and reserved-role pins after current reauthorization',async()=>{
 const old={...creation,membershipRevision:4};
 for(const action of ['recover','cancel']){
  const p=fixture({role:'owner',respond:(_,body)=>{assert.equal(body.p_role,'owner');assert.equal(body.p_revision,5);assert.deepEqual(body.p_envelope,action==='recover'?null:creationDraftEnvelope(old,'manager'));return Response.json({schema:1,draft:{envelope:creationDraftEnvelope(old,'manager'),state:action==='recover'?'pending':'cancelled',result:null}});}});
  const r=await run(p,request({...draft(action,action==='recover'?null:old),reservedRole:action==='recover'?null:'manager'},{role:'owner'}));assert.equal(r.status,200);assert.deepEqual((await r.json()).draft.request,old);
 }
 const p=fixture(),r=await run(p,request(draft('reserve',old)));assert.equal(r.status,409);assert.equal(rpcCalls(p).length,0);
});
test('hosted gates, role, origin, identity, malformed selectors and body bounds cannot be bypassed by local flags',async()=>{
 for(const [name,status] of [['ECH_HOSTED_OPERATIONS_READS',404],['ECH_HOSTED_OPERATIONS_WRITES',405],['ECH_HOSTED_SCHEDULE_COMMANDS',405]]){
  const p=fixture(),r=await run(p,request(draft()),{...env,[name]:undefined,ECH_LOCAL_SCHEDULE_COMMANDS:true});assert.equal(r.status,status);assert.equal(rpcCalls(p).length,0);
 }
 for(const [cfg,opts,status] of [[{role:'staff'},{role:'staff'},403],[{session:false},{},401],[{active:false},{},403],[{},{origin:'https://other.invalid'},403],[{},{actor:id(99)},409],[{},{query:'creationDraft=1&creationDraft=1'},400],[{},{query:'creationDraft=1&scheduling=1'},400]]){
  const p=fixture(cfg),r=await run(p,request(draft(),opts));assert.equal(r.status,status);assert.equal(rpcCalls(p).length,0);
 }
 assert.equal(operationsCommandLimit(request(draft())),16384);
 const p=fixture();assert.equal((await run(p,request({...draft(),extra:'x'.repeat(16384)}))).status,400);assert.equal(rpcCalls(p).length,0);
});
test('fresh planned reservations default off; exact planned recovery remains possible when new plans are disabled',async()=>{
 const planned={...creation,command:{...creation.command,taskPlanToken:'b'.repeat(64)}};
 const p=fixture();assert.equal((await run(p,request(draft('reserve',planned)))).status,409);assert.equal(rpcCalls(p).length,0);
 const recovery=fixture({respond:()=>Response.json({schema:1,draft:{envelope:creationDraftEnvelope(planned,'manager'),state:'pending',result:null}})});
 assert.equal((await run(recovery,request(draft()))).status,200);
});
test('altered draft identity, envelope extras, invalid state/receipt and unknown transport remain unconfirmed',async()=>{
 const good={schema:1,draft:{envelope:creationDraftEnvelope(creation,'manager'),state:'pending',result:null}};
 for(const value of [{...good,draft:{...good.draft,envelope:{...good.draft.envelope,extra:true}}},{...good,draft:{...good.draft,envelope:creationDraftEnvelope({...creation,operationId:id(88)},'manager')}},{...good,draft:{...good.draft,state:'committed',result:{...result,receipt:{...result.receipt,operationId:id(88)}}}},{...good,draft:{...good.draft,state:'unknown'}},{schema:1,draft:null}]){
  const r=await run(fixture({respond:()=>Response.json(value)}),request(draft('inspect',creation)));assert.equal(r.status,502);assert.equal((await r.json()).error.code,'write_unconfirmed');
 }
 for(const respond of [()=>{throw Error('private-marker');},()=>new Response('x'.repeat(32769),{headers:{'Content-Type':'application/json'}}),()=>new Response(new Uint8Array([0xff]),{headers:{'Content-Type':'application/json'}})]){
  const r=await run(fixture({respond}),request(draft()));assert.equal(r.status,502);assert.doesNotMatch(await r.text(),/private-marker/);
 }
});
test('provider denials preserve status without trusting or exposing provider payload',async()=>{
 for(const status of [400,401,403,409]){
  const r=await run(fixture({respond:()=>Response.json({private:'private-marker'},{status})}),request(draft()));assert.equal(r.status,status);assert.doesNotMatch(await r.text(),/private-marker/);
 }
});
