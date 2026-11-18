import test from 'node:test';
import assert from 'node:assert/strict';
import {productionOperationsEnvironment as hosted} from '../lib/admin/production-capabilities.js';
import {scheduleTaskPlansEnabled,commitScheduleCommand} from '../lib/admin/operations-schedule-commands.js';
import {writeOperations} from '../lib/admin/operations-write-dispatch.js';
const enabled={ECH_HOSTED_SCHEDULE_COMMANDS:'true',ECH_HOSTED_SCHEDULE_TASK_PLANS:'true'};
const on=env=>scheduleTaskPlansEnabled(hosted(env));
test('planned creation requires both explicit hosted switches; local injection is overwritten',()=>{
 for(const value of [undefined,null,false,true,1,'1','TRUE',' true','true ',{},[]]){
  assert.equal(on({...enabled,ECH_HOSTED_SCHEDULE_TASK_PLANS:value,ECH_LOCAL_SCHEDULE_TASK_PLANS:true}),false);
  assert.equal(on({...enabled,ECH_HOSTED_SCHEDULE_COMMANDS:value}),false);
 }
 assert.equal(on({ECH_LOCAL_SCHEDULE_TASK_PLANS:true,ECH_HOSTED_SCHEDULE_COMMANDS:'true'}),false);
 assert.equal(on({ECH_HOSTED_TASK_PLAN_READ:'true',ECH_HOSTED_SCHEDULE_COMMANDS:'true'}),false);
 assert.equal(on(enabled),true);
});
test('inherited/accessor flags do not opt in and configuration is not mutated',()=>{
 assert.equal(on(Object.create(enabled)),false);
 const accessor={ECH_HOSTED_SCHEDULE_COMMANDS:'true'};
 Object.defineProperty(accessor,'ECH_HOSTED_SCHEDULE_TASK_PLANS',{enumerable:true,get:()=> 'true'});
 assert.equal(on(accessor),false);
 const frozen=Object.freeze({...enabled,unrelated:'retained'});const effective=hosted(frozen);
 assert.equal(effective.unrelated,'retained');assert.equal(effective.ECH_LOCAL_SCHEDULE_TASK_PLANS,true);
 assert.equal(Object.hasOwn(frozen,'ECH_LOCAL_SCHEDULE_TASK_PLANS'),false);
});
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const current={member:{active:true,operational_role:'manager',revision:5},principal:{id:id(9),operationalRole:'manager'},config:{base:'https://abcdefghijklmnopqrst.supabase.co',key:'fictional'},token:'fictional'};
const source={clientId:id(3),clientName:'Fictional client',service:'Home support',area:'Fictional area',instructionsVersion:1,instructionsSavedAt:'2026-11-01T00:00:00.000001Z',confirmedAt:'2026-11-01T00:01:00.000001Z',inquiryId:null,inquiryRevision:null,sourceToken:'a'.repeat(64)};
const planned={schema:1,operationId:id(1),visitId:id(2),visitRevision:0,membershipRevision:5,command:{type:'create',clientId:id(3),workerId:null,service:'Home support',start:'2026-11-20T18:00:00.000Z',end:'2026-11-20T19:00:00.000Z',source,taskPlanToken:'b'.repeat(64)}};
const request=()=>new Request('https://example.invalid/api/admin/operations?scheduling=1',{method:'POST',headers:{'x-ech-schedule-actor':id(9),'x-ech-schedule-role':'manager'}});
test('mapping does not bypass independent hosted read/write admission',async()=>{
 let calls=0;const fetcher=()=>{calls++;throw Error('unexpected provider');};
 for(const env of [enabled,{...enabled,ECH_HOSTED_OPERATIONS_READS:'true'},{...enabled,ECH_HOSTED_OPERATIONS_WRITES:'true'}])
  await assert.rejects(writeOperations(current,request(),planned,env,fetcher),{status:405,code:'disabled'});
 assert.equal(calls,0);
});
test('disabled plans never dispatch; enabled mapping retains exact token and canonical envelope',async()=>{
 let calls=0;
 const fetcher=async(url,options)=>{
  calls++;assert.ok(url.endsWith('/rpc/ech_operations_visit_commit'));
  const payload=JSON.parse(options.body).p_envelope;assert.equal(payload.command.taskPlanToken,planned.command.taskPlanToken);
  assert.equal(payload.expectedRole,'manager');assert.equal(payload.membershipRevision,5);
  return Response.json({visit:{id:id(2),clientId:id(3),workerId:null,service:'Home support',start:planned.command.start,end:planned.command.end,status:'Open',revision:1},receipt:{operationId:id(1),expectedRevision:0,revision:1}});
 };
 await assert.rejects(commitScheduleCommand(current,planned,hosted({ECH_HOSTED_SCHEDULE_COMMANDS:'true'}),fetcher),{status:400,code:'invalid_request'});
 assert.equal(calls,0);await commitScheduleCommand(current,planned,hosted(enabled),fetcher);assert.equal(calls,1);
});
test('enabled flag does not bypass stale membership or manager-only creation rules',async()=>{
 let calls=0;const fetcher=()=>{calls++;throw Error('unexpected provider');};
 await assert.rejects(commitScheduleCommand(current,{...planned,membershipRevision:4},hosted(enabled),fetcher),{status:409,code:'scope_changed'});
 await assert.rejects(commitScheduleCommand({...current,member:{...current.member,operational_role:'staff'}},planned,hosted(enabled),fetcher),{status:403,code:'forbidden'});
 assert.equal(calls,0);
});
// Mock-only transport evidence. No database grant, fixture seed or runtime activation.

test('fully enabled hosted scheduling route admits planned creation and returns its verified receipt',async()=>{
 let calls=0;
 const expected={visit:{id:id(2),clientId:id(3),workerId:null,service:'Home support',start:planned.command.start,end:planned.command.end,status:'Open',revision:1},receipt:{operationId:id(1),expectedRevision:0,revision:1}};
 const fetcher=async(url,options)=>{
  calls++;assert.ok(url.endsWith('/rpc/ech_operations_visit_commit'));
  const envelope=JSON.parse(options.body).p_envelope;
  assert.equal(envelope.command.taskPlanToken,planned.command.taskPlanToken);
  assert.equal(envelope.expectedRole,'manager');assert.equal(envelope.membershipRevision,5);
  return Response.json(expected);
 };
 const result=await writeOperations(current,request(),planned,{...enabled,ECH_HOSTED_OPERATIONS_READS:'true',ECH_HOSTED_OPERATIONS_WRITES:'true'},fetcher);
 assert.equal(calls,1);assert.deepEqual(result,expected);
});
