import test from 'node:test';
import assert from 'node:assert/strict';
import {readOperations} from '../lib/admin/operations-read-dispatch.js';
import {handleAdmin} from '../lib/admin/handler.js';
const actor='10000000-0000-4000-8000-000000000001';
const flags={ECH_HOSTED_OPERATIONS_READS:'true',ECH_HOSTED_OPERATIONS_WRITES:'true',ECH_HOSTED_SCHEDULE_COMMANDS:'true',ECH_HOSTED_SCHEDULE_RECURRENCE:'true'};
const current=(role='owner')=>({principal:{id:actor,operationalRole:role},member:{active:true,operational_role:role,revision:5}});
const request=(query='scheduleRecurrence=1',role='owner',id=actor,method='GET')=>new Request('https://example.invalid/api/admin/operations?'+query,{method,headers:{'x-ech-schedule-actor':id,'x-ech-schedule-role':role,cookie:'__Host-ech-access=fictional'}});
const noProvider=()=>assert.fail('Availability must not invoke provider or write RPC');
test('recurrence availability requires exact own hosted master and recurrence flags, never local override',async()=>{
 for(const role of ['manager','owner'])assert.deepEqual(await readOperations(current(role),request('scheduleRecurrence=1',role),noProvider,flags),{schema:1,enabled:true,membershipRevision:5});
 for(const key of Object.keys(flags)){
  for(const value of [undefined,null,false,true,1,'TRUE',' true','true ','false'])assert.equal((await readOperations(current(),request(),noProvider,{...flags,[key]:value,ECH_LOCAL_SCHEDULE_COMMANDS:true})).enabled,false);
  const inherited={...flags};delete inherited[key];Object.setPrototypeOf(inherited,{[key]:'true'});
  assert.equal((await readOperations(current(),request(),noProvider,inherited)).enabled,false);
 }
 assert.equal((await readOperations(current(),request(),noProvider,{})).enabled,false);
});
test('recurrence selector and current actor/role/membership are validated without dispatch',async()=>{
 for(const query of ['scheduleRecurrence=0','scheduleRecurrence=','scheduleRecurrence=1&scheduleRecurrence=1','scheduleRecurrence=1&commands=1','scheduleRecurrence=1&report=x','scheduleRecurrence=1&from=x'])await assert.rejects(readOperations(current(),request(query),noProvider,flags),e=>e.status===400);
 await assert.rejects(readOperations(current(),request('scheduleRecurrence=1','staff'),noProvider,flags),e=>e.status===409);
 await assert.rejects(readOperations(current(),request('scheduleRecurrence=1','owner','other'),noProvider,flags),e=>e.status===409);
 await assert.rejects(readOperations(current(),request('scheduleRecurrence=1','owner',actor,'POST'),noProvider,flags),e=>e.status===405);
 for(const revision of [undefined,0,-1,1.5,Number.MAX_SAFE_INTEGER+1])await assert.rejects(readOperations({...current(),member:{...current().member,revision}},request(),noProvider,flags),e=>e.status===503);
 await assert.rejects(readOperations(current('staff'),request('scheduleRecurrence=1','staff'),noProvider,flags),e=>e.status===403);
 await assert.rejects(readOperations({...current(),member:{...current().member,active:false}},request(),noProvider,flags),e=>e.status===403);
});
test('canonical HTTP authentication precedes availability; only three auth hops and no operations RPC',async()=>{
 const env={...flags,ADMIN_ORIGIN:'https://example.invalid',SUPABASE_URL:'https://abcdefghijklmnopqrst.supabase.co',SUPABASE_PUBLISHABLE_KEY:'fictional'};
 for(const enabled of [true,false]){
  const paths=[];
  const provider=async url=>{
   const p=new URL(url).pathname;paths.push(p);
   if(p==='/auth/v1/user')return Response.json({id:actor,email:'fixture@example.invalid'});
   if(p==='/rest/v1/ech_memberships')return Response.json([{user_id:actor,active:true,operational_role:'owner',revision:5}]);
   if(p==='/rest/v1/rpc/ech_session_active')return Response.json(true);
   assert.fail('Unexpected provider access');
  };
  const response=await handleAdmin('operations',request(),{...env,ECH_HOSTED_SCHEDULE_COMMANDS:enabled?'true':'false'},provider);
  assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');
  assert.deepEqual(await response.json(),{schema:1,enabled,membershipRevision:5});
  assert.deepEqual(paths,['/auth/v1/user','/rest/v1/ech_memberships','/rest/v1/rpc/ech_session_active']);
 }
 assert.equal((await handleAdmin('operations',request(),{...env,ECH_HOSTED_OPERATIONS_READS:undefined},noProvider)).status,404);
 const anonymous=new Request('https://example.invalid/api/admin/operations?scheduleRecurrence=1');
 assert.equal((await handleAdmin('operations',anonymous,env,noProvider)).status,401);
});

test('recurrence contract bounds daily/weekly series and rejects occurrence identity/time tampering',async()=>{
 const {recurrenceIntervals,isScheduleRecurrence}=await import('../lib/operations/schedule-recurrence-wire.js');
 const source={clientId:actor,clientName:'Fixture source',service:'Home support',area:'Fixture area',instructionsVersion:1,instructionsSavedAt:'2026-11-01T17:00:00.000000Z',confirmedAt:'2026-11-01T17:00:00.000000Z',inquiryId:null,inquiryRevision:null,sourceToken:'a'.repeat(64)};
 for(const cadence of ['daily','weekly']){
  const times=recurrenceIntervals('2026-11-20T10:00:00.000','2026-11-20T11:00:00.000',cadence,12);
  const request={schema:1,operationId:actor,membershipRevision:5,command:{type:'createSeries',clientId:actor,workerId:null,service:'Home support',source,timeZone:'America/Vancouver',localStart:'2026-11-20T10:00:00.000',localEnd:'2026-11-20T11:00:00.000',cadence,count:12,occurrences:times.map((t,i)=>({...t,operationId:`20000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,visitId:`30000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`}))}};
  assert.equal(isScheduleRecurrence(request),true);
  for(const mutate of [v=>v.command.count=1,v=>v.command.count=13,v=>v.command.timeZone='UTC',v=>v.command.cadence='monthly',v=>v.command.occurrences[1].visitId=v.command.occurrences[0].visitId,v=>v.command.occurrences[1].start=v.command.occurrences[0].start]){const bad=structuredClone(request);mutate(bad);assert.equal(isScheduleRecurrence(bad),false);}
 }
 for(const count of [0,1,13,1.5])assert.throws(()=>recurrenceIntervals('2026-11-20T10:00:00.000','2026-11-20T11:00:00.000','daily',count));
});
