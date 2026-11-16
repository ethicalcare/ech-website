import test from 'node:test';
import assert from 'node:assert/strict';
import {handleAdmin} from '../lib/admin/handler.js';
import {onRequest} from '../functions/api/admin/operations.js';
import {hostedOperationsWritesEnabled} from '../lib/admin/production-capabilities.js';
import {recurrenceIntervals} from '../lib/operations/schedule-recurrence-wire.js';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const env={ADMIN_ORIGIN:'https://staff.example.invalid',SUPABASE_URL:'https://abcdefghijklmnopqrst.supabase.co',SUPABASE_PUBLISHABLE_KEY:'fictional-key',
 ECH_HOSTED_OPERATIONS_READS:'true',ECH_HOSTED_OPERATIONS_WRITES:'true',ECH_HOSTED_SCHEDULE_COMMANDS:'true',ECH_HOSTED_SCHEDULE_RECURRENCE:'true',ECH_HOSTED_VISIT_ACTIONS:'true'};
const base={schema:1,operationId:id(1),visitId:id(2),visitRevision:3,membershipRevision:5};
const assignment={...base,command:{type:'assign',workerId:id(4),reason:'Fictional assignment'}};
const start={...base,reportRevision:null,command:{type:'start'}};
const report={...base,reportRevision:0,command:{type:'submit',summary:'Fictional completed visit',issue:'',actualStart:'2026-11-01T17:00:00.000Z',actualEnd:'2026-11-01T18:00:00.000Z',completedTasks:['Fictional task'],observations:'',outcome:'completed'}};
const source={clientId:id(3),clientName:'Fictional client',service:'Home support',area:'Fictional area',instructionsVersion:1,instructionsSavedAt:'2026-11-01T00:00:00.000001Z',confirmedAt:'2026-11-01T00:01:00.000001Z',inquiryId:null,inquiryRevision:null,sourceToken:'a'.repeat(64)};
const series={schema:1,operationId:id(10),membershipRevision:5,command:{type:'createSeries',clientId:id(3),workerId:null,service:'Home support',source,timeZone:'America/Vancouver',localStart:'2026-11-20T10:00:00.000',localEnd:'2026-11-20T11:00:00.000',cadence:'daily',count:2,
 occurrences:recurrenceIntervals('2026-11-20T10:00:00.000','2026-11-20T11:00:00.000','daily',2).map((x,i)=>({...x,operationId:id(11+i),visitId:id(21+i)}))}};
function request(body=assignment,{query='scheduling=1',role='manager',actor=id(9),origin=env.ADMIN_ORIGIN,cookie=true,contentType='application/json',method='POST',raw}={}){
 return new Request(env.ADMIN_ORIGIN+'/api/admin/operations'+(query?'?'+query:''),{method,headers:{
  ...(cookie?{cookie:'__Host-ech-access=fictional-token'}:{}),'x-ech-schedule-actor':actor,'x-ech-schedule-role':role,origin,'Content-Type':contentType},
  ...(method==='POST'?{body:raw??JSON.stringify(body)}:{})});
}
function fixture({role='manager',active=true,session=true,status=200,lost=false}={}){
 const calls=[],writes=[];let drop=lost;
 return {calls,writes,fetcher:async(url,options)=>{
  const path=new URL(url).pathname;calls.push(path);
  if(path==='/auth/v1/user')return Response.json({id:id(9),email:'fictional@example.invalid'});
  if(path==='/rest/v1/ech_memberships')return Response.json([{user_id:id(9),active,operational_role:role,revision:5}]);
  if(path==='/rest/v1/rpc/ech_session_active')return Response.json(session);
  assert.ok(['/rest/v1/rpc/ech_operations_visit_commit','/rest/v1/rpc/ech_operations_visit_report_commit','/rest/v1/rpc/ech_operations_series_commit'].includes(path),'Unexpected provider path');
  assert.equal(options.cache,'no-store');assert.equal(options.redirect,'manual');
  const e=JSON.parse(options.body).p_envelope;writes.push(e);
  assert.equal(e.expectedRole??e.command.expectedRole,role);
  assert.equal(e.membershipRevision??e.command.membershipRevision,5);
  if(drop){drop=false;throw Error('Fictional lost response');}
  if(status!==200)return Response.json({private:'private-marker'},{status});
  if(e.command.type==='createSeries')return Response.json({visits:e.command.occurrences.map(o=>({id:o.visitId,clientId:id(3),workerId:null,service:'Home support',start:o.start,end:o.end,status:'Open',revision:1})),receipt:{operationId:e.operationId,count:2}});
  if(e.command.type==='submit')return Response.json({operationId:e.operationId,visitId:e.visitId,visitRevision:4,reportRevision:1,reportVersion:0,action:'submit',recordedAt:'2026-11-01T18:01:00.000Z'});
  return Response.json({visit:{id:e.command.visitId,clientId:id(3),workerId:id(4),service:'Home support',start:'2026-11-01T17:00:00.000Z',end:'2026-11-01T18:00:00.000Z',status:e.command.type==='start'?'In progress':'Assigned',revision:4},receipt:{operationId:e.operationId,expectedRevision:3,revision:4}});
 }};
}
const run=(p,req=request(),config=env)=>handleAdmin('operations',req,config,p.fetcher);
test('write admission requires own exact strings for both master gates',async t=>{
 let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;throw Error('Unexpected provider')});
 for(const name of ['ECH_HOSTED_OPERATIONS_READS','ECH_HOSTED_OPERATIONS_WRITES']){
  for(const value of [undefined,null,true,false,1,'TRUE',' true','true ',{},[]]){
   const config={...env,[name]:value};
   assert.equal(hostedOperationsWritesEnabled(config),false);
   const r=await onRequest({request:request(),env:config});assert.equal(r.status,name.endsWith('READS')?404:405);
  }
  const config={...env};delete config[name];Object.setPrototypeOf(config,{[name]:'true'});
  assert.equal(hostedOperationsWritesEnabled(config),false);
 }
 assert.equal(calls,0);
});
test('per-capability off cannot be bypassed by local booleans',async()=>{
 for(const [body,options,name,local] of [[assignment,{},'ECH_HOSTED_SCHEDULE_COMMANDS','ECH_LOCAL_SCHEDULE_COMMANDS'],[start,{query:'',role:'staff'},'ECH_HOSTED_VISIT_ACTIONS','ECH_LOCAL_VISIT_ACTIONS'],[series,{query:'scheduleRecurrence=1'},'ECH_HOSTED_SCHEDULE_RECURRENCE','ECH_LOCAL_SCHEDULE_RECURRENCE']]){
  const p=fixture({role:options.role??'manager'}),r=await run(p,request(body,options),{...env,[name]:undefined,[local]:true});
  assert.equal(r.status,405);assert.equal(p.writes.length,0);
 }
});
test('canonical origin/session/current actor and role checks run before write RPC',async()=>{
 for(const [config,options,expected] of [[{},{origin:'https://other.invalid'},403],[{},{cookie:false},401],[{active:false},{},403],[{session:false},{},401],[{},{actor:id(99)},409],[{role:'staff'},{},409]]){
  const p=fixture(config),r=await run(p,request(assignment,options));assert.equal(r.status,expected);assert.equal(p.writes.length,0);
 }
 const p=fixture(),r=await run(p,request({...assignment,membershipRevision:4}));assert.equal(r.status,409);assert.equal(p.writes.length,0);
 const staff=fixture({role:'staff'});assert.equal((await run(staff,request(assignment,{role:'staff'}))).status,403);assert.equal(staff.writes.length,0);
});
test('hosted route preserves scoped assignment/start/report/recurrence request and receipt',async t=>{
 for(const [body,options] of [[assignment,{}],[start,{role:'staff',query:''}],[report,{role:'staff',query:''}],[series,{query:'scheduleRecurrence=1'}]]){
  const p=fixture({role:options.role??'manager'});const restore=t.mock.method(globalThis,'fetch',p.fetcher);
  const r=await onRequest({request:request(body,options),env});restore.mock.restore();
  assert.equal(r.status,200);assert.equal(r.headers.get('Cache-Control'),'no-store');
  const data=await r.json();assert.equal(data.operationId??data.receipt.operationId,body.operationId);assert.equal(p.writes.length,1);
  if(body===start)assert.equal(data.recordedAt,null);
 }
});
test('lost-response retry retains operation identity; forbidden/stale outcomes stay errors',async()=>{
 const p=fixture({lost:true}),r=await run(p);assert.equal(r.status,502);assert.equal((await r.json()).operationId,assignment.operationId);
 assert.equal((await run(p)).status,200);assert.deepEqual(p.writes[0],p.writes[1]);
 for(const status of [400,401,403,409,412]){
  const p=fixture({status}),r=await run(p);assert.equal(r.status,status);const body=await r.json();
  assert.equal(body.operationId,assignment.operationId);assert.ok(!JSON.stringify(body).includes('private-marker'));
 }
});
test('unknown/ambiguous selectors, unsafe fields, malformed or excessive bodies fail without write',async()=>{
 for(const options of [{query:'scheduling=1&scheduleRecurrence=1'},{query:'scheduling=1&scheduling=1'},{query:'commands=1'},{query:'taskTiming=1'},{query:'scheduling=2'},{contentType:'text/plain'},{raw:'{'},{raw:' '.repeat(8193)}]){
  const p=fixture(),r=await run(p,request(assignment,options));assert.equal(r.status,400);assert.equal(p.writes.length,0);
 }
 const p=fixture();assert.equal((await run(p,request({...assignment,expectedRole:'owner'}))).status,400);assert.equal(p.writes.length,0);
 for(const method of ['PUT','DELETE'])assert.equal((await run(p,request(assignment,{method}))).status,405);
});
