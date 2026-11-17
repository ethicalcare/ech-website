import test from 'node:test';
import assert from 'node:assert/strict';
import {handleAdmin} from '../lib/admin/handler.js';
import {createVisitActionsClient} from '../admin-src/app/shared/visit-action-client.ts';
const actor='10000000-0000-4000-8000-000000000001';
const env={ADMIN_ORIGIN:'https://staff.example.invalid',SUPABASE_URL:'https://abcdefghijklmnopqrst.supabase.co',SUPABASE_PUBLISHABLE_KEY:'fictional',ECH_HOSTED_OPERATIONS_READS:'true',ECH_HOSTED_OPERATIONS_WRITES:'true',ECH_HOSTED_VISIT_ACTIONS:'true'};
function request(feature='1',id=actor){return new Request(env.ADMIN_ORIGIN+'/api/admin/operations?commands=1',{headers:{cookie:'__Host-ech-access=fictional','X-ECH-Schedule-Actor':id,'X-ECH-Schedule-Role':'staff',...(feature===null?{}:{'X-ECH-Visit-Features':feature})}});}
async function provider(url){const path=new URL(url).pathname;if(path==='/auth/v1/user')return Response.json({id:actor,email:'fictional@example.invalid'});if(path==='/rest/v1/ech_memberships')return Response.json([{user_id:actor,active:true,operational_role:'staff',revision:7}]);if(path==='/rest/v1/rpc/ech_session_active')return Response.json(true);assert.fail('Availability must not call a data/write RPC');}
test('note event capability is strictly advertised only with authenticated writes and visit actions',async()=>{
 for(const flag of [undefined,false,true,'TRUE',' true','true ', 'true']){
  const response=await handleAdmin('operations',request(),{...env,ECH_HOSTED_REPORT_NOTE_EVENT_TIME:flag},provider);assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{schema:1,enabled:true,membershipRevision:7,noteEventTime:flag==='true'});
 }
 for(const disabled of ['ECH_HOSTED_OPERATIONS_WRITES','ECH_HOSTED_VISIT_ACTIONS']){
  const response=await handleAdmin('operations',request(),{...env,ECH_HOSTED_REPORT_NOTE_EVENT_TIME:'true',[disabled]:'false'},provider);
  assert.deepEqual(await response.json(),{schema:1,enabled:false,membershipRevision:7,noteEventTime:false});
 }
 const inherited=Object.assign(Object.create({ECH_HOSTED_REPORT_NOTE_EVENT_TIME:'true'}),env);
 assert.equal((await (await handleAdmin('operations',request(),inherited,provider)).json()).noteEventTime,false);
 assert.equal((await handleAdmin('operations',request('1','10000000-0000-4000-8000-000000000002'),env,provider)).status,409);
 assert.equal((await handleAdmin('operations',request(),{...env,ECH_HOSTED_OPERATIONS_READS:'false'},provider)).status,404);
});
test('legacy/non-negotiated availability retains exact legacy response',async()=>{
 for(const feature of [null,'2','true']){
  const response=await handleAdmin('operations',request(feature),{...env,ECH_HOSTED_REPORT_NOTE_EVENT_TIME:'true'},provider);
  assert.deepEqual(await response.json(),{schema:1,enabled:true,membershipRevision:7});
 }
});
test('client negotiates capability and rejects malformed or contradictory flags',async()=>{
 const base={schema:1,enabled:true,membershipRevision:7};
 for(const value of [base,{...base,noteEventTime:false},{...base,noteEventTime:true}]){
  const client=createVisitActionsClient(async(url,options)=>{assert.equal(options.headers['X-ECH-Visit-Features'],'1');return Response.json(value);},actor,'staff');
  assert.deepEqual(await client.availability(new AbortController().signal),value);
 }
 for(const value of [{...base,noteEventTime:'true'},{...base,noteEventTime:null},{...base,noteEventTime:true,enabled:false},{...base,noteEventTime:true,extra:1}]){
  await assert.rejects(createVisitActionsClient(async()=>Response.json(value),actor,'staff').availability(new AbortController().signal));
 }
});
