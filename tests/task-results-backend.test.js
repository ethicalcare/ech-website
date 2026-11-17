import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {handleAdmin} from '../lib/admin/handler.js';
import {onRequest} from '../functions/api/admin/operations.js';
import {operationsCommandLimit} from '../lib/admin/operations-write-dispatch.js';
import {sessionOperationsFeatures} from '../lib/admin/session-operations-features.js';
import {visitTasks} from '../lib/admin/operations-visit-tasks.js';
import {visitTaskAvailability} from '../lib/admin/operations-visit-task-availability.js';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const config={ADMIN_ORIGIN:'https://staff.example.invalid',SUPABASE_URL:'https://abcdefghijklmnopqrst.supabase.co',SUPABASE_PUBLISHABLE_KEY:'fictional-key'};
const flags={ECH_HOSTED_OPERATIONS_READS:'true',ECH_HOSTED_OPERATIONS_WRITES:'true',ECH_HOSTED_VISIT_TASKS:'true'};
const privateMarker='PRIVATE-FICTIONAL-PROVIDER-DATA';
const original=()=>({visitId:id(10),visitRevision:4,membershipRevision:5,taskId:id(20),expectedVersion:0,operationId:id(30),outcome:'done',observation:'Fictional household items prepared',actualAt:'2026-11-16T17:00:00.123456Z',reason:null});
const readQuery=(body=original())=>'visitTasks=1&'+new URLSearchParams({visitId:body.visitId,visitRevision:String(body.visitRevision),membershipRevision:String(body.membershipRevision)});
const snapshot=()=>({visitId:id(10),visitRevision:4,plan:[{id:id(15),label:'Fictional household support',tasks:[{id:id(20),text:'Prepare fictional household items'}]}],additions:[],results:[],resultVisibility:'limited'});
function request({method='GET',query=readQuery(),body=original(),actor=id(1),role='staff',origin=config.ADMIN_ORIGIN,cookie=true,raw,contentType='application/json'}={}){
 return new Request(config.ADMIN_ORIGIN+'/api/admin/operations?'+query,{method,headers:{...(cookie?{cookie:'__Host-ech-access=fictional-token'}:{}),'X-ECH-Schedule-Actor':actor,'X-ECH-Schedule-Role':role,Origin:origin,'Content-Type':contentType},...(method==='POST'?{body:raw??JSON.stringify(body)}:{})});
}
// Provider model exercises the real HTTP/session/dispatch/adapter code. It is not
// evidence of live SQL execution, locks, grants, atomicity or production readiness.
function fixture(overrides={}){
 const state={actor:id(1),role:'staff',active:true,session:true,grant:true,assigned:true,visitRevision:4,membershipRevision:5,status:'In progress',...overrides};
 const calls=[],operations=[],events=[],saved=new Map();let lose=false,mutateRead=null,mutateReceipt=null,beforeRPC=null,forcedStatus=null;
 const denial=status=>Response.json({private:privateMarker},{status});
 const fetcher=async(url,options)=>{
  const path=new URL(url).pathname;calls.push(path);
  if(path==='/auth/v1/user')return Response.json({id:state.actor,email:'fictional@example.invalid'});
  if(path==='/rest/v1/ech_memberships')return Response.json([{user_id:state.actor,active:state.active,operational_role:state.role,revision:state.membershipRevision}]);
  if(path==='/rest/v1/rpc/ech_session_active')return Response.json(state.session);
  assert.ok(['/rest/v1/rpc/ech_operations_visit_task_plan_read','/rest/v1/rpc/ech_operations_visit_task_result_write'].includes(path),'Unexpected RPC '+path);
  assert.equal(options.headers.Authorization,'Bearer fictional-token');assert.equal(options.cache,'no-store');assert.equal(options.redirect,'manual');
  const p=JSON.parse(options.body);operations.push({path,params:structuredClone(p)});beforeRPC?.();
  if(forcedStatus)return denial(forcedStatus);
  if(!state.session)return denial(401);
  if(!state.active||!state.grant||state.role==='staff'&&!state.assigned||['Completed','Cancelled'].includes(state.status))return denial(403);
  if(p.p_membership_revision!==state.membershipRevision)return denial(409);
  if(p.p_visit_revision!==state.visitRevision)return denial(412);
  if(path.endsWith('_read')){
   assert.equal(p.p_role,state.role);const result=snapshot();result.visitRevision=state.visitRevision;result.resultVisibility=state.role==='staff'?'limited':'complete';result.results=structuredClone(events.filter(e=>state.role!=='staff'||e.actorId===state.actor));mutateRead?.(result);return Response.json(result);
  }
  if(state.role!=='staff'||state.status!=='In progress')return denial(403);
  if(p.p_task!==id(20))return denial(409);
  const existing=saved.get(p.p_operation);
  if(existing){if(JSON.stringify(existing.params)!==JSON.stringify(p)||existing.actor!==state.actor)return denial(409);}
  else{
   const latest=events.filter(e=>e.taskId===p.p_task).at(-1);
   if((latest?.version??0)!==p.p_expected_version||latest&&latest.actorId!==state.actor)return denial(409);
   const receipt={visitId:p.p_visit,taskId:p.p_task,version:p.p_expected_version+1,operationId:p.p_operation,recordedAt:'2026-11-16T18:00:00.123456Z'};
   events.push({taskId:p.p_task,version:receipt.version,outcome:p.p_outcome,observation:p.p_observation,actualAt:p.p_actual_at,recordedAt:receipt.recordedAt,actorId:state.actor,reason:p.p_reason});saved.set(p.p_operation,{params:structuredClone(p),receipt,actor:state.actor});
  }
  if(lose){lose=false;throw Error('Fictional transport lost after commit');}
  const receipt=structuredClone(saved.get(p.p_operation).receipt);mutateReceipt?.(receipt);return Response.json(receipt);
 };
 return {state,calls,operations,events,fetcher,set lose(v){lose=v;},set mutateRead(v){mutateRead=v;},set mutateReceipt(v){mutateReceipt=v;},set beforeRPC(v){beforeRPC=v;},set forcedStatus(v){forcedStatus=v;}};
}
const run=(f,req=request(),env={...config,...flags})=>handleAdmin('operations',req,env,f.fetcher);
test('hosted task route is default-off; local booleans, inherited and malformed configuration cannot enable it',async t=>{
 let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;throw Error('Unexpected provider access');});
 assert.equal((await onRequest({request:request(),env:config})).status,404);assert.equal(calls,0);
 for(const value of [undefined,null,false,true,1,'TRUE',' true','true ',{},[]]){
  const f=fixture(),env={...config,...flags,ECH_HOSTED_VISIT_TASKS:value,ECH_VISIT_TASKS_ENABLED:true};
  assert.equal((await run(f,request(),env)).status,405);assert.equal(f.operations.length,0);
  assert.equal((await run(f,request({method:'POST',query:'visitTasks=1'}),env)).status,405);assert.equal(f.operations.length,0);
 }
 const env={...config,...flags};delete env.ECH_HOSTED_VISIT_TASKS;Object.setPrototypeOf(env,{ECH_HOSTED_VISIT_TASKS:'true'});const f=fixture();assert.equal((await run(f,request(),env)).status,405);assert.equal(f.operations.length,0);
});
test('authenticated availability is informational, master-gated and does not fetch protected task data',async()=>{
 for(const role of ['owner','manager','staff'])for(const writes of [false,true]){
  const f=fixture({role});const response=await run(f,request({query:'visitTaskAvailability=1',role}),{...config,...flags,ECH_HOSTED_OPERATIONS_WRITES:writes?'true':undefined});assert.equal(response.status,200);assert.deepEqual(await response.json(),{schema:1,enabled:writes,membershipRevision:5});assert.equal(f.operations.length,0);
 }
 for(const query of ['visitTaskAvailability=0','visitTaskAvailability=1&visitTaskAvailability=1','visitTaskAvailability=1&visitTasks=1']){const f=fixture();assert.equal((await run(f,request({query}))).status,400);assert.equal(f.operations.length,0);}
});
test('v1 envelope remains exact; explicit version2 adds default-off taskResults for current operational members only',async()=>{
 const f=fixture();
 const load=version=>handleAdmin('session',new Request(config.ADMIN_ORIGIN+'/api/admin/session',{headers:{cookie:'__Host-ech-access=fictional-token',...(version?{'X-ECH-Operations-Features':version}:{})}}),{...config,...flags},f.fetcher);
 assert.equal(Object.hasOwn(await (await load()).json(),'operationsFeatures'),false);
 const v1=(await (await load('1')).json()).operationsFeatures;assert.deepEqual(Object.keys(v1).sort(),['reads','scheduleCommands','scheduleRecurrence','visitActions']);
 const v2=(await (await load('2')).json()).operationsFeatures;assert.deepEqual(v2,{...v1,taskResults:true});assert.equal(Object.hasOwn(await (await load('3')).json(),'operationsFeatures'),false);
 for(const role of ['owner','manager','staff',null])for(const enabled of [false,true]){const member={active:true,operational_role:role};const env={...flags,ECH_HOSTED_VISIT_TASKS:enabled?'true':undefined};assert.equal(sessionOperationsFeatures(member,env,{taskResults:true}).taskResults,!!role&&enabled);assert.equal(Object.hasOwn(sessionOperationsFeatures(member,env),'taskResults'),false);}
 assert.equal(sessionOperationsFeatures({active:false,operational_role:'staff'},flags,{taskResults:true}).taskResults,false);
 assert.equal(sessionOperationsFeatures({active:true,operational_role:'staff'},{...flags,ECH_HOSTED_OPERATIONS_WRITES:undefined},{taskResults:true}).taskResults,false);
});
test('current origin/session/member/actor/role/membership checks reject before task RPC',async()=>{
 for(const [state,options,status] of [[{},{cookie:false},401],[{active:false},{},403],[{session:false},{},401],[{},{actor:id(99)},409],[{},{role:'owner'},409],[{role:'manager'},{role:'manager'},403],[{},{origin:'https://other.invalid'},403]]){
  const f=fixture(state);const response=await run(f,request({method:'POST',query:'visitTasks=1',...options}));assert.equal(response.status,status);assert.equal(f.operations.length,0);
 }
 for(const method of ['GET','POST']){const f=fixture();const body={...original(),membershipRevision:4};const response=await run(f,request({method,body,query:method==='GET'?readQuery(body):'visitTasks=1'}));assert.equal(response.status,409);assert.equal((await response.json()).error.code,'scope_changed');assert.equal(f.operations.length,0);}
 const current={member:{active:true,user_id:id(1),operational_role:'staff',revision:5},principal:{id:id(2),operationalRole:'staff'}};assert.throws(()=>visitTaskAvailability(current,{ECH_VISIT_TASKS_ENABLED:true}),{status:403});await assert.rejects(visitTasks(current,'GET',new URLSearchParams(readQuery()),null,{ECH_VISIT_TASKS_ENABLED:true},async()=>assert.fail('No RPC')),{status:403});
});
test('real HTTP entry maps current scoped read and exact write envelope, retry and correction history',async t=>{
 const f=fixture();t.mock.method(globalThis,'fetch',f.fetcher);
 const body=original();f.lose=true;let response=await onRequest({request:request({method:'POST',query:'visitTasks=1',body}),env:{...config,...flags}});assert.equal(response.status,502);assert.equal((await response.json()).operationId,body.operationId);assert.equal(f.events.length,1);
 response=await onRequest({request:request({method:'POST',query:'visitTasks=1',body}),env:{...config,...flags}});assert.equal(response.status,200);assert.equal((await response.json()).operationId,body.operationId);assert.deepEqual(f.operations[0].params,f.operations[1].params);assert.equal(f.events.length,1);
 const correction={...body,operationId:id(31),expectedVersion:1,observation:'Clarified fictional observation',reason:'Clarify factual wording'};assert.equal((await run(f,request({method:'POST',query:'visitTasks=1',body:correction}))).status,200);
 response=await run(f);assert.equal(response.status,200);const value=await response.json();assert.equal(value.results.length,2);assert.equal(value.results[0].reason,null);assert.equal(value.results[1].reason,correction.reason);assert.equal(value.results[1].actualAt,body.actualAt);
 assert.deepEqual(f.operations[0].params,{p_visit:body.visitId,p_visit_revision:4,p_membership_revision:5,p_task:body.taskId,p_expected_version:0,p_operation:body.operationId,p_outcome:'done',p_observation:body.observation,p_actual_at:body.actualAt,p_reason:null});
});
test('fresh assignment, grant, session, membership, visit revision and status failures stay errors with no protected upstream payload',async()=>{
 for(const [change,status] of [[{assigned:false},403],[{grant:false},403],[{session:false},401],[{membershipRevision:6},409],[{visitRevision:5},412],[{status:'Completed'},403],[{status:'Cancelled'},403]])for(const method of ['GET','POST']){
  const f=fixture();f.beforeRPC=()=>Object.assign(f.state,change);const response=await run(f,request({method,query:method==='GET'?readQuery():'visitTasks=1'}));assert.equal(response.status,status);const value=await response.text();assert.doesNotMatch(value,new RegExp(privateMarker));assert.equal(f.events.length,0);
 }
});
test('same operation changed payload/actor and outdated result version cannot create another event',async()=>{
 const f=fixture(),body=original();assert.equal((await run(f,request({method:'POST',query:'visitTasks=1',body}))).status,200);
 for(const changed of [{...body,observation:'Changed factual text'},{...body,expectedVersion:1,reason:'Correction but reused operation'},{...body,operationId:id(35)}])assert.equal((await run(f,request({method:'POST',query:'visitTasks=1',body:changed}))).status,409);
 f.state.actor=id(2);assert.equal((await run(f,request({method:'POST',query:'visitTasks=1',body,actor:id(2)}))).status,409);assert.equal(f.events.length,1);
});
test('task selectors, bounded body and exact input shapes reject before operation RPC',async()=>{
 assert.equal(operationsCommandLimit(request({method:'POST',query:'visitTasks=1'})),16384);
 for(const options of [{query:'visitTasks=1&visitTasks=1'},{query:'visitTasks=1&scheduling=1'},{query:'visitTasks=0'},{contentType:'text/plain'},{raw:'{'},{raw:' '.repeat(16385)},{body:{...original(),extra:'no'}},{body:{...original(),expectedVersion:1,reason:'x'}},{body:{...original(),observation:'\u0000'}},{body:{...original(),expectedVersion:1000}},{body:{...original(),actualAt:'invalid'}}]){
  const f=fixture();assert.equal((await run(f,request({method:'POST',query:'visitTasks=1',...options}))).status,400);assert.equal(f.operations.length,0);
 }
 for(const query of [readQuery()+'&unknown=1',readQuery()+'&visitId='+id(10),readQuery().replace('visitRevision=4','visitRevision=04'),readQuery().replace('visitRevision=4','visitRevision=9007199254740992')]){const f=fixture();assert.equal((await run(f,request({query}))).status,400);assert.equal(f.operations.length,0);}
});
test('malformed, cross-actor, unknown-task and oversized read payloads never escape the adapter',async()=>{
 for(const mutate of [v=>{v.extra=privateMarker;},v=>{v.visitRevision=99;},v=>{v.resultVisibility='complete';},v=>{v.results=[{taskId:id(20),version:1,outcome:'done',observation:privateMarker,actualAt:original().actualAt,recordedAt:original().actualAt,actorId:id(99),reason:null}];},v=>{v.additions=Array(51).fill({});},v=>{v.plan[0].tasks[0].text='x'.repeat(500001);},v=>{v.results=[{taskId:id(99),version:1,outcome:'done',observation:privateMarker,actualAt:original().actualAt,recordedAt:original().actualAt,actorId:id(1),reason:null}];}]){
  const f=fixture();f.mutateRead=mutate;const response=await run(f);assert.equal(response.status,503);assert.doesNotMatch(await response.text(),new RegExp(privateMarker));
 }
 for(const role of ['owner','manager']){const f=fixture({role}),response=await run(f,request({role}));assert.equal(response.status,200);assert.equal((await response.json()).resultVisibility,'complete');}
});
test('forged receipts and upstream unknown outcomes preserve operation identity without claiming save',async()=>{
 for(const mutate of [r=>{r.operationId=id(99);},r=>{r.taskId=id(99);},r=>{r.visitId=id(99);},r=>{r.version=99;},r=>{r.recordedAt='invalid';},r=>{r.private=privateMarker;}]){const f=fixture();f.mutateReceipt=mutate;const response=await run(f,request({method:'POST',query:'visitTasks=1'}));assert.equal(response.status,502);const body=await response.json();assert.equal(body.error.code,'write_unconfirmed');assert.equal(body.operationId,original().operationId);assert.doesNotMatch(JSON.stringify(body),new RegExp(privateMarker));}
 for(const status of [400,401,403,409,412,413,500]){const f=fixture();f.forcedStatus=status;const response=await run(f,request({method:'POST',query:'visitTasks=1'}));assert.equal(response.status,status===500?502:status);assert.doesNotMatch(await response.text(),new RegExp(privateMarker));}
});
test('inactive SQL contract keeps atomic assignment/session/revision/retry/correction and bounded history authority',async()=>{
 const task=await readFile(new URL('../migrations/20261114001600_operations_visit_task_results.sql',import.meta.url),'utf8');
 const detail=await readFile(new URL('../migrations/20261114000400_operations_visit_details.sql',import.meta.url),'utf8');
 assert.match(task,/perform public\.ech_operations_visit_detail\(p_visit,p_visit_revision,'staff',p_membership_revision\)/);assert.match(task,/v\.status is distinct from 'In progress'/);assert.match(task,/existing\.actor_id is distinct from auth\.uid\(\)/);assert.match(task,/latest\.actor_id<>auth\.uid\(\)/);assert.match(task,/existing\.visit_revision is distinct from p_visit_revision/);assert.match(task,/history_count>1000/);assert.match(task,/e\.actor_id=auth\.uid\(\)/);assert.match(task,/revoke all on function public\.ech_operations_visit_task_result_write/);
 assert.match(detail,/v\.worker_id = permission\.worker_id/);assert.match(detail,/member\.revision is distinct from p_membership_revision/);assert.match(detail,/visit\.revision <> p_expected_revision/);assert.match(detail,/public\.ech_session_active\(\) is not true/);
});
test('unexpected upstream redirects, MIME, malformed JSON/UTF8 and response limits fail closed',async()=>{
 for(const method of ['GET','POST'])for(const reply of [()=>new Response('',{status:302,headers:{Location:'https://other.invalid'}}),()=>new Response(privateMarker,{headers:{'Content-Type':'text/plain'}}),()=>new Response('{'+privateMarker,{headers:{'Content-Type':'application/json'}}),()=>new Response(new Uint8Array([0xff,0xfe]),{headers:{'Content-Type':'application/json'}}),()=>Response.json({private:privateMarker,text:'x'.repeat(500001)})]){
  const f=fixture(),provider=async(url,options)=>new URL(url).pathname.includes('/rest/v1/rpc/ech_operations_visit_task')?reply():f.fetcher(url,options);
  const response=await handleAdmin('operations',request({method,query:method==='GET'?readQuery():'visitTasks=1'}),{...config,...flags},provider);assert.equal(response.status,method==='GET'?503:502);const body=await response.text();assert.doesNotMatch(body,new RegExp(privateMarker));assert.match(body,new RegExp(method==='GET'?'unavailable':'write_unconfirmed'));
 }
});
