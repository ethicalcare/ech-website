import test from 'node:test';
import assert from 'node:assert/strict';
import {handleAdmin} from '../lib/admin/handler.js';
import {onRequest} from '../functions/api/admin/operations.js';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const env={ADMIN_ORIGIN:'https://staff.example.invalid',SUPABASE_URL:'https://abcdefghijklmnopqrst.supabase.co',SUPABASE_PUBLISHABLE_KEY:'fictional-key',ECH_HOSTED_OPERATIONS_READS:'true'};
const date={from:'2026-11-01T00:00:00.000Z',to:'2026-11-08T00:00:00.000Z'};
const visit={id:id(2),clientId:id(3),workerId:id(4),service:'Home support',start:'2026-11-02T17:00:00.000Z',end:'2026-11-02T18:00:00.000Z',status:'Assigned',revision:3};
const routes=[
 {query:date,rpc:'ech_operations_schedule',value:{visits:[visit],clients:[{id:id(3),name:'Fictional client'}],staff:[{id:id(4),name:'Fictional worker'}]}},
 {query:{scheduleVisit:id(2),membershipRevision:'5'},rpc:'ech_operations_schedule_visit',value:visit},
 {query:{visit:id(2),revision:'3'},rpc:'ech_operations_visit_detail',value:{visitId:id(2),revision:3,fields:{address:'Fictional address'},contactAuthority:'unknown',allergyStatus:'unknown'}},
 {query:{report:id(2),revision:'3',reportRevision:'0'},rpc:'ech_operations_visit_report',value:{schema:1,visitId:id(2),visitRevision:3,reportRevision:0,versions:[],reviews:[]}},
];
function request(query=date,{role='staff',actor=id(1),cookie=true,method='GET'}={}){
 return new Request(env.ADMIN_ORIGIN+'/api/admin/operations?'+new URLSearchParams(query),{method,headers:{
  ...(cookie?{cookie:'__Host-ech-access=fictional-token'}:{}),'x-ech-schedule-actor':actor,'x-ech-schedule-role':role,origin:env.ADMIN_ORIGIN}});
}
function provider({role='staff',active=true,session=true,status=200}={}){
 const calls=[];return {calls,fetcher:async(url,options)=>{
  const path=new URL(url).pathname;calls.push({path,options});
  if(path==='/auth/v1/user')return Response.json({id:id(1),email:'fictional@example.invalid'});
  if(path==='/rest/v1/ech_memberships')return Response.json([{user_id:id(1),active,operational_role:role,revision:5}]);
  if(path==='/rest/v1/rpc/ech_session_active')return Response.json(session);
  const route=routes.find(r=>path==='/rest/v1/rpc/'+r.rpc);assert.ok(route,'Unexpected RPC '+path);
  assert.equal(options.headers.Authorization,'Bearer fictional-token');
  const body=JSON.parse(options.body);assert.equal(body.p_expected_role,role);
  if(route!==routes[0])assert.equal(body.p_membership_revision,5);
  return Response.json(status===200?route.value:{private:'private-marker'},{status});
 }};
}
test('hosted HTTP entry is default-off with zero provider access, including local/write flags',async t=>{
 let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;throw Error('Unexpected access')});
 for(const value of [undefined,null,false,true,1,'TRUE',' true','true ',{},[]]){
  const r=await onRequest({request:request(),env:{...env,ECH_HOSTED_OPERATIONS_READS:value,ECH_LOCAL_OPERATIONS_READS:true,ECH_HOSTED_SCHEDULE_COMMANDS:'true',ECH_HOSTED_VISIT_ACTIONS:'true'}});
  assert.equal(r.status,404);assert.equal(r.headers.get('Cache-Control'),'no-store');
 }
 const inherited=Object.assign(Object.create({ECH_HOSTED_OPERATIONS_READS:'true'}),{ADMIN_ORIGIN:env.ADMIN_ORIGIN});
 assert.equal((await onRequest({request:request(),env:inherited})).status,404);
 assert.equal(calls,0);
});
test('enabled hosted HTTP entry performs canonical authentication and scoped read',async t=>{
 const p=provider();t.mock.method(globalThis,'fetch',p.fetcher);
 const r=await onRequest({request:request(),env});assert.equal(r.status,200);
 assert.deepEqual(await r.json(),{schema:1,mode:'shared',...routes[0].value});
 assert.deepEqual(p.calls.map(c=>c.path),['/auth/v1/user','/rest/v1/ech_memberships','/rest/v1/rpc/ech_session_active','/rest/v1/rpc/ech_operations_schedule']);
});
test('four read selectors preserve current owner/manager/staff role and exact response',async()=>{
 for(const role of ['owner','manager','staff'])for(const route of routes){
  const p=provider({role}),r=await handleAdmin('operations',request(route.query,{role}),env,p.fetcher);
  assert.equal(r.status,200);assert.equal(r.headers.get('Cache-Control'),'no-store');
  const expected=route===routes[0]?{schema:1,mode:'shared',...route.value}:route===routes[1]?{schema:1,visit:route.value}:route.value;
  assert.deepEqual(await r.json(),expected);
 }
});
test('revoked session, inactive membership, missing cookie and mismatched headers cannot dispatch',async()=>{
 for(const [config,options,status] of [
  [{},{cookie:false},401],[{active:false},{},403],[{session:false},{},401],
  [{},{role:'owner'},409],[{},{actor:id(99)},409],[{role:null},{role:'staff'},409],
 ]){
  const p=provider(config),r=await handleAdmin('operations',request(date,options),env,p.fetcher);
  assert.equal(r.status,status);assert.ok(!p.calls.some(c=>routes.some(x=>c.path.endsWith(x.rpc))));
 }
});
test('writes remain unavailable regardless of existing command flags; malformed read selectors fail',async()=>{
 const p=provider();
 for(const method of ['POST','PUT','DELETE']){
  assert.equal((await handleAdmin('operations',request({scheduling:'1'},{method}),{...env,ECH_HOSTED_SCHEDULE_COMMANDS:'true',ECH_LOCAL_SCHEDULE_COMMANDS:true},p.fetcher)).status,405);
 }
 assert.equal(p.calls.length,0);
 for(const query of [{visit:id(2),report:id(2),revision:'3'},{commands:'0'},{taskTiming:'1'},{clientRead:'1'},{...date,extra:'1'},{scheduleVisit:id(2),membershipRevision:'4'}]){
  const p=provider(),r=await handleAdmin('operations',request(query),env,p.fetcher);
  assert.ok([400,409].includes(r.status));assert.ok(!p.calls.some(c=>routes.some(x=>c.path.endsWith(x.rpc))));
 }
});
test('upstream denial/staleness is preserved without protected payload disclosure',async()=>{
 for(const status of [401,403,409,412]){
  const p=provider({status}),r=await handleAdmin('operations',request(routes[3].query),env,p.fetcher);
  assert.equal(r.status,status);assert.doesNotMatch(await r.text(),/private-marker/);
 }
});

test('authenticated command availability uses hosted admission and performs no command RPC',async()=>{
 for(const enabled of [false,true]) {
  const p=provider();const r=await handleAdmin('operations',request({commands:'1'}),{...env,ECH_HOSTED_VISIT_ACTIONS:'true',...(enabled?{ECH_HOSTED_OPERATIONS_WRITES:'true'}:{})},p.fetcher);
  assert.equal(r.status,200);assert.deepEqual(await r.json(),{schema:1,enabled,membershipRevision:5});
  assert.equal(p.calls.length,3);assert.ok(!p.calls.some(c=>routes.some(x=>c.path.endsWith(x.rpc))));
 }
});
