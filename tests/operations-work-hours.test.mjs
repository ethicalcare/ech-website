import assert from 'node:assert/strict';
import test from 'node:test';
import {workHours,createWorkHoursFixturePort} from '../lib/admin/operations-work-hours.js';
const id=n=>'10000000-0000-4000-8000-'+String(n).padStart(12,'0');
const actor=id(10),visitId=id(11);
const manager={principal:{id:actor,operationalRole:'manager'},member:{user_id:actor,operational_role:'manager',active:true,revision:8}};
const staff={principal:{id:actor,operationalRole:'staff'},member:{user_id:actor,operational_role:'staff',active:true,revision:8}};
const request=(role,method='GET',query=method==='GET'?'workHours=1&visit='+visitId+'&visitRevision=5&reportRevision=4':'workHours=1')=>
 new Request('https://ech-fiction.invalid/api/admin/operations?'+query,{method,headers:{'x-ech-schedule-actor':actor,'x-ech-schedule-role':role}});
const at='2026-11-20T12:00:00.000Z';
const binding={visitId,visitRevision:5,reportRevision:4,membershipRevision:8};
const body={schema:1,...binding,contentRevision:3,operationId:id(12),decision:'approve'};
test('disabled or unauthorized route does not call its private port',async()=>{
 const trip=()=>assert.fail('port touched');
 const port={read:trip,decide:trip};
 await assert.rejects(workHours(manager,request('manager'),null,undefined),{status:404});
 await assert.rejects(workHours(staff,request('staff','POST'),body,port),{status:403});
 await assert.rejects(workHours(manager,request('staff'),null,port),{status:409});
 await assert.rejects(workHours(manager,request('manager','POST'),{...body,membershipRevision:7},port),{status:409});
 await assert.rejects(workHours(manager,request('manager','POST'),{...body,decision:'return'},port),{status:400});
 await assert.rejects(workHours(manager,request('manager','POST','workHours=1&workHours=1'),body,port),{status:400});
});
test('pins current grant and report separately; staff only get decision',async()=>{
 const managerPort={read:async(current,input)=>{
   assert.equal(current,manager);assert.deepEqual(input,binding);
   return {schema:1,...binding,enabled:true,contentRevision:3,canDecide:false,receipt:{decision:'approve',recordedAt:at,actorId:id(30)}};
 }};
 const get=await workHours(manager,request('manager'),null,managerPort);
 assert.deepEqual(get.receipt,{decision:'approve',recordedAt:at});
 const staffPort={read:async()=>({...get,receipt:{decision:'approve'}})};
 assert.deepEqual((await workHours(staff,request('staff'),null,staffPort)).receipt,{decision:'approve'});
 await assert.rejects(workHours(staff,request('staff'),null,{read:async()=>({...get,canDecide:true})}),{status:503});
 await assert.rejects(workHours(manager,request('manager'),null,{read:async()=>({...get,reportRevision:2})}),{status:503});
});
test('save retains exact operation and content, strips reason from receipt and rejects mismatched response',async()=>{
 const port={decide:async(current,input)=>{
   assert.equal(current,manager);assert.deepEqual(input,{...binding,contentRevision:3,operationId:body.operationId,decision:'return',reason:'Recheck'});
   return {...body,decision:'return',recordedAt:at,reason:'must not leave server'};
 }};
 const cmd={...body,decision:'return',reason:'  Recheck  '};
 assert.deepEqual(await workHours(manager,request('manager','POST'),cmd,port),{...body,decision:'return',recordedAt:at});
 await assert.rejects(workHours(manager,request('manager','POST'),cmd,{decide:async()=>({...body,decision:'return',contentRevision:2,recordedAt:at})}),{status:503});
});

test('fixture database port binds server session and SQL arguments without escaping to care review',async()=>{
 let requestCount=0;
 const port=createWorkHoursFixturePort(async(current,dispatch)=>{
  assert.equal(current,manager);
  return dispatch({query:async(sql,args)=>{
    requestCount++;
    if(requestCount===1){
      assert.match(sql,/ech_fixture_hours\.read_current/);
      assert.deepEqual(args,[visitId,5,4,'manager',8]);
      return {rows:[{value:{schema:1,...binding,enabled:true,contentRevision:3,canDecide:true,receipt:null}}]};
    }
    assert.match(sql,/ech_fixture_hours\.decide/);
    assert.deepEqual(args,[visitId,5,4,3,'manager',8,body.operationId,'approve',null]);
    if(requestCount===3)throw Object.assign(Error('no database details in HTTP'),{code:'PT412'});
    return {rows:[{value:{...body,recordedAt:at}}]};
  }});
 });
 await workHours(manager,request('manager'),null,port);
 await workHours(manager,request('manager','POST'),body,port);
 await assert.rejects(workHours(manager,request('manager','POST'),body,port),{status:412});
});
