import assert from 'node:assert/strict';
import test from 'node:test';
import {createWorkHoursClient} from '../admin-src/app/shared/work-hours-client.ts';
const visitId='10000000-0000-4000-8000-000000000001';
const actor='10000000-0000-4000-8000-000000000002';
const operationId='10000000-0000-4000-8000-000000000003';
const binding={visitId,visitRevision:5,reportRevision:3,contentRevision:2};
const state={schema:1,...binding,enabled:true,membershipRevision:8,canDecide:true,receipt:null};
const reply=(data,status=200)=>Response.json(data,{status});
const signal=()=>new AbortController().signal;
test('hours read requires exact visit, report stream, content and server decision capability',async()=>{
 const client=createWorkHoursClient(async(path,request)=>{
  const q=new URL(path,'https://fixture.invalid').searchParams;
  assert.deepEqual(Object.fromEntries(q),{workHours:'1',visit:visitId,visitRevision:'5',reportRevision:'3'});
  assert.equal(request.method,'GET');
  assert.equal(request.headers['X-ECH-Schedule-Actor'],actor);
  return reply(state);
 },actor,'manager');
 assert.deepEqual(await client.read(binding,signal()),{...binding,enabled:true,membershipRevision:8,canDecide:true,receipt:null});
 await assert.rejects(createWorkHoursClient(async()=>reply({...state,contentRevision:1}),actor,'manager').read(binding,signal()));
 await assert.rejects(createWorkHoursClient(async()=>reply({...state,canDecide:undefined}),actor,'manager').read(binding,signal()));
 assert.equal(await createWorkHoursClient(async()=>reply({},404),actor,'manager').read(binding,signal()),null);
});
test('assigned staff receipt is status only, never a writable client',async()=>{
 let count=0;
 const staff=createWorkHoursClient(async()=>{count++;return reply({...state,canDecide:false,receipt:{decision:'return'}});},actor,'staff');
 assert.deepEqual((await staff.read(binding,signal())).receipt,{decision:'return'});
 await assert.rejects(staff.write({schema:1,...binding,membershipRevision:8,operationId,decision:'approve'},signal()));
 assert.equal(count,1);
 await assert.rejects(createWorkHoursClient(async()=>reply({...state,canDecide:true}),actor,'staff').read(binding,signal()));
});
test('hours decision requires the exact POST receipt and never accepts a stale binding',async()=>{
 const command={schema:1,...binding,membershipRevision:8,operationId,decision:'return',reason:'Verify actual time.'};
 const recordedAt='2026-11-20T14:00:00.000Z';
 const {reason:_,...echo}=command;
 const manager=createWorkHoursClient(async(path,request)=>{
  assert.equal(path,'/api/admin/operations?workHours=1');
  assert.equal(request.method,'POST');
  assert.deepEqual(JSON.parse(request.body),command);
  return reply({...echo,recordedAt});
 },actor,'manager');
 assert.deepEqual(await manager.write(command,signal()),{decision:'return',recordedAt});
 await assert.rejects(createWorkHoursClient(async()=>reply({...echo,operationId:actor,recordedAt}),actor,'manager').write(command,signal()));
 await assert.rejects(createWorkHoursClient(async()=>reply({...echo,membershipRevision:9,recordedAt}),actor,'manager').write(command,signal()));
});
