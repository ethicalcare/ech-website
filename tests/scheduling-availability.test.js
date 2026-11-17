import test from 'node:test';
import assert from 'node:assert/strict';
import {readOperations} from '../lib/admin/operations-read-dispatch.js';
import {handleAdmin} from '../lib/admin/handler.js';
const actor='10000000-0000-4000-8000-000000000001';
const flags={ECH_HOSTED_OPERATIONS_READS:'true',ECH_HOSTED_OPERATIONS_WRITES:'true',ECH_HOSTED_SCHEDULE_COMMANDS:'true'};
const current=(role='staff')=>({principal:{id:actor,operationalRole:role},member:{active:true,operational_role:role,revision:5}});
const request=(query='scheduling=1',role='staff',id=actor,method='GET')=>new Request('https://example.invalid/api/admin/operations?'+query,{method,headers:{'x-ech-schedule-actor':id,'x-ech-schedule-role':role,cookie:'__Host-ech-access=fictional'}});
const noProvider=()=>assert.fail('Availability must not invoke provider or write RPC');
test('scheduling availability requires exact own hosted master and scheduling flags, never local override',async()=>{
 for(const role of ['staff','manager','owner'])assert.deepEqual(await readOperations(current(role),request('scheduling=1',role),noProvider,flags),{schema:1,enabled:true,membershipRevision:5});
 for(const key of Object.keys(flags)){
  for(const value of [undefined,null,false,true,1,'TRUE',' true','true ','false'])assert.equal((await readOperations(current(),request(),noProvider,{...flags,[key]:value,ECH_LOCAL_SCHEDULE_COMMANDS:true})).enabled,false);
  const inherited={...flags};delete inherited[key];Object.setPrototypeOf(inherited,{[key]:'true'});
  assert.equal((await readOperations(current(),request(),noProvider,inherited)).enabled,false);
 }
 assert.equal((await readOperations(current(),request(),noProvider,{})).enabled,false);
});
test('scheduling selector and current actor/role/membership are validated without dispatch',async()=>{
 for(const query of ['scheduling=0','scheduling=','scheduling=1&scheduling=1','scheduling=1&commands=1','scheduling=1&report=x','scheduling=1&from=x'])await assert.rejects(readOperations(current(),request(query),noProvider,flags),e=>e.status===400);
 await assert.rejects(readOperations(current(),request('scheduling=1','owner'),noProvider,flags),e=>e.status===409);
 await assert.rejects(readOperations(current(),request('scheduling=1','staff','other'),noProvider,flags),e=>e.status===409);
 await assert.rejects(readOperations(current(),request('scheduling=1','staff',actor,'POST'),noProvider,flags),e=>e.status===405);
 for(const revision of [undefined,0,-1,1.5,Number.MAX_SAFE_INTEGER+1])await assert.rejects(readOperations({...current(),member:{...current().member,revision}},request(),noProvider,flags),e=>e.status===503);
 await assert.rejects(readOperations({...current(),member:{...current().member,active:false}},request(),noProvider,flags),e=>e.status===403);
});
test('canonical HTTP authentication precedes availability; only three auth hops and no operations RPC',async()=>{
 const env={...flags,ADMIN_ORIGIN:'https://example.invalid',SUPABASE_URL:'https://abcdefghijklmnopqrst.supabase.co',SUPABASE_PUBLISHABLE_KEY:'fictional'};
 for(const enabled of [true,false]){
  const paths=[];
  const provider=async url=>{
   const p=new URL(url).pathname;paths.push(p);
   if(p==='/auth/v1/user')return Response.json({id:actor,email:'fixture@example.invalid'});
   if(p==='/rest/v1/ech_memberships')return Response.json([{user_id:actor,active:true,operational_role:'staff',revision:5}]);
   if(p==='/rest/v1/rpc/ech_session_active')return Response.json(true);
   assert.fail('Unexpected provider access');
  };
  const response=await handleAdmin('operations',request(),{...env,ECH_HOSTED_SCHEDULE_COMMANDS:enabled?'true':'false'},provider);
  assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');
  assert.deepEqual(await response.json(),{schema:1,enabled,membershipRevision:5});
  assert.deepEqual(paths,['/auth/v1/user','/rest/v1/ech_memberships','/rest/v1/rpc/ech_session_active']);
 }
 assert.equal((await handleAdmin('operations',request(),{...env,ECH_HOSTED_OPERATIONS_READS:undefined},noProvider)).status,404);
 const anonymous=new Request('https://example.invalid/api/admin/operations?scheduling=1');
 assert.equal((await handleAdmin('operations',anonymous,env,noProvider)).status,401);
});
