import test from 'node:test';
import assert from 'node:assert/strict';
import {commitScheduleCommand,scheduleCommandsEnabled} from '../lib/admin/operations-schedule-commands.js';
import {commitScheduleRecurrence,scheduleRecurrenceEnabled} from '../lib/admin/operations-schedule-recurrence.js';
import {commitVisitAction,visitActionsEnabled} from '../lib/admin/operations-visit-actions.js';
import {productionOperationsEnvironment as hosted} from '../lib/admin/production-capabilities.js';
import {recurrenceIntervals} from '../lib/operations/schedule-recurrence-wire.js';
// Mock provider only. These tests do not activate routes or establish SQL authority.
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const current=(role='manager')=>({member:{active:true,operational_role:role,revision:5},config:{base:'https://abcdefghijklmnopqrst.supabase.co',key:'fictional-key'},token:'fictional-token'});
const flags={ECH_HOSTED_SCHEDULE_COMMANDS:'true',ECH_HOSTED_SCHEDULE_RECURRENCE:'true',ECH_HOSTED_VISIT_ACTIONS:'true'};
const enabled=hosted(flags);
const base={schema:1,operationId:id(1),visitId:id(2),visitRevision:3,membershipRevision:5};
const visit=(status='Assigned')=>({id:id(2),clientId:id(3),workerId:id(4),service:'Home support',start:'2026-11-01T17:00:00.000Z',end:'2026-11-01T18:00:00.000Z',status,revision:4});
const assignment={...base,command:{type:'assign',workerId:id(4),reason:'Fictional assignment'}};
const start={...base,reportRevision:null,command:{type:'start'}};
const review={...base,reportRevision:1,command:{type:'review',version:0,decision:'accepted',note:'Fictional independent review'}};
const source={clientId:id(3),clientName:'Fictional client',service:'Home support',area:'Fictional area',instructionsVersion:1,instructionsSavedAt:'2026-11-01T00:00:00.000001Z',confirmedAt:'2026-11-01T00:01:00.000001Z',inquiryId:null,inquiryRevision:null,sourceToken:'a'.repeat(64)};
const series={schema:1,operationId:id(10),membershipRevision:5,command:{type:'createSeries',clientId:id(3),workerId:null,service:'Home support',source,timeZone:'America/Vancouver',localStart:'2026-11-20T10:00:00.000',localEnd:'2026-11-20T11:00:00.000',cadence:'daily',count:2,
 occurrences:recurrenceIntervals('2026-11-20T10:00:00.000','2026-11-20T11:00:00.000','daily',2).map((x,i)=>({...x,operationId:id(11+i),visitId:id(21+i)}))}};
const scheduleResult=status=>({visit:visit(status),receipt:{operationId:id(1),expectedRevision:3,revision:4}});
const cases=[
 {name:'assignment',fn:commitScheduleCommand,request:assignment,role:'manager',rpc:'ech_operations_visit_commit',result:()=>scheduleResult('Assigned')},
 {name:'start',fn:commitVisitAction,request:start,role:'staff',rpc:'ech_operations_visit_commit',result:()=>scheduleResult('In progress')},
 {name:'review',fn:commitVisitAction,request:review,role:'manager',rpc:'ech_operations_visit_report_commit',result:()=>({operationId:id(1),visitId:id(2),visitRevision:3,reportRevision:2,reportVersion:0,action:'review',recordedAt:'2026-11-02T18:00:00.000Z'})},
 {name:'recurrence',fn:commitScheduleRecurrence,request:series,role:'manager',rpc:'ech_operations_series_commit',result:()=>({visits:series.command.occurrences.map(o=>({id:o.visitId,clientId:id(3),workerId:null,service:'Home support',start:o.start,end:o.end,status:'Open',revision:1})),receipt:{operationId:id(10),count:2}})},
];
test('hosted switches are exact, own, independent and default off',()=>{
 for(const value of [undefined,null,false,true,1,'1','TRUE',' true','true ',{},[]]){
  const env=hosted({...Object.fromEntries(Object.keys(flags).map(k=>[k,value])),ECH_LOCAL_SCHEDULE_COMMANDS:true,ECH_LOCAL_SCHEDULE_RECURRENCE:true,ECH_LOCAL_VISIT_ACTIONS:true});
  assert.equal(scheduleCommandsEnabled(env),false);assert.equal(scheduleRecurrenceEnabled(env),false);assert.equal(visitActionsEnabled(env),false);
 }
 assert.equal(scheduleRecurrenceEnabled(hosted({ECH_HOSTED_SCHEDULE_RECURRENCE:'true'})),false);
 assert.equal(scheduleCommandsEnabled(hosted(Object.create(flags))),false);
 assert.equal(scheduleCommandsEnabled(enabled),true);assert.equal(scheduleRecurrenceEnabled(enabled),true);assert.equal(visitActionsEnabled(enabled),true);
 const frozen=Object.freeze({...flags,other:'retained'});assert.equal(hosted(frozen).other,'retained');assert.equal(Object.hasOwn(frozen,'ECH_LOCAL_SCHEDULE_COMMANDS'),false);
});
for(const c of cases){
 const invoke=(provider,request=c.request,env=enabled,who=current(c.role))=>c.fn(who,request,env,provider);
 test(c.name+': disabled, inactive, invalid and stale inputs never dispatch',async()=>{
  let calls=0;const forbidden=()=>{calls++;throw Error('Unexpected provider')};
  await assert.rejects(invoke(forbidden,c.request,hosted({})),{status:405,code:'disabled'});
  await assert.rejects(invoke(forbidden,c.request,enabled,{...current(c.role),member:{active:false,operational_role:c.role,revision:5}}),{status:403});
  await assert.rejects(invoke(forbidden,{...c.request,extra:true}),{status:400});
  await assert.rejects(invoke(forbidden,{...c.request,membershipRevision:4}),{status:409});
  assert.equal(calls,0);
 });
 test(c.name+': exact request and identity survive retry without fabricated confirmation',async()=>{
  const bodies=[];let calls=0;
  const provider=async(url,options)=>{
   assert.equal(url,current().config.base+'/rest/v1/rpc/'+c.rpc);
   assert.equal(options.cache,'no-store');assert.equal(options.redirect,'manual');assert.equal(options.method,'POST');
   assert.equal(options.headers.Authorization,'Bearer fictional-token');assert.ok(options.signal instanceof AbortSignal);
   const body=JSON.parse(options.body);bodies.push(body);
   const e=body.p_envelope;assert.equal(e.operationId,c.request.operationId);
   assert.equal(e.expectedRole??e.command?.expectedRole,c.role);
   if(++calls===1)throw Error('Fictional lost response');
   return Response.json(c.result());
  };
  await assert.rejects(invoke(provider),{status:502,code:'write_unconfirmed'});
  const result=await invoke(provider);assert.deepEqual(bodies[0],bodies[1]);
  if(c.name==='start'){assert.equal(result.recordedAt,null);assert.equal(result.visitRevision,4);}
  else if(c.name==='review')assert.deepEqual(result,{schema:1,...c.result()});
  else assert.deepEqual(result,c.result());
 });
 test(c.name+': denied requests and malformed receipts never become success',async()=>{
  for(const status of [400,401,403,409]){
   await assert.rejects(invoke(async()=>Response.json({private:'private-marker'},{status})),e=>e.status===status&&!e.message.includes('private-marker'));
  }
  for(const response of [Response.json({...c.result(),private:'private-marker'}),new Response('{',{headers:{'Content-Type':'application/json'}}),new Response(null,{status:302}),new Response(' '.repeat(500_001),{headers:{'Content-Type':'application/json'}})]){
   await assert.rejects(invoke(async()=>response),{status:502,code:'write_unconfirmed'});
  }
 });
}
test('staff cannot assign or create recurrence even with enabled adapter',async()=>{
 let calls=0;const provider=()=>{calls++;};
 await assert.rejects(commitScheduleCommand(current('staff'),assignment,enabled,provider),{status:403});
 await assert.rejects(commitScheduleRecurrence(current('staff'),series,enabled,provider),{status:403});
 assert.equal(calls,0);
});
test('additional presentation gates require their own explicit hosted switches',()=>{
 for(const [external,internal,on,off] of [
  ['ECH_HOSTED_VISIT_TASKS','ECH_VISIT_TASKS_ENABLED',true,false],
  ['ECH_HOSTED_OPERATIONAL_TIMING','ECH_OPERATIONAL_TIMING_ENABLED',true,false],
  ['ECH_HOSTED_REPORT_AUTHOR_LABELS','ECH_REPORT_AUTHOR_LABELS','true','false'],
  ['ECH_HOSTED_REPORT_NOTE_EVENT_TIME','ECH_REPORT_NOTE_EVENT_TIME',true,false],
 ]){
  for(const value of [undefined,true,false,1,'TRUE',' true','true ']){
   assert.equal(hosted({[external]:value,[internal]:on})[internal],off);
  }
  assert.equal(hosted({[external]:'true'})[internal],on);
  assert.equal(hosted(Object.create({[external]:'true'}))[internal],off);
 }
});
test('valid-looking receipts for a different operation remain unconfirmed',async()=>{
 for(const c of cases){
  const result=c.result();
  if(result.receipt)result.receipt.operationId=id(99);else result.operationId=id(99);
  await assert.rejects(c.fn(current(c.role),c.request,enabled,async()=>Response.json(result)),{status:502,code:'write_unconfirmed'});
 }
});
