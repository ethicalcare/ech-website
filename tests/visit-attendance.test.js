import test from 'node:test';
import assert from 'node:assert/strict';
import { nextVisitAttendance, visitAttendanceStatus as status } from '../lib/operations/visit-attendance.js';

const at = (h,m='00') => `2026-11-18T${h}:${m}:00.000Z`;
const visit = {start:at('17'), end:at('18'), workerId:'worker', status:'Assigned'};

test('management can distinguish upcoming, started, and ended scheduled windows without a recorded check-in', () => {
  assert.equal(status(visit, null, at('17')), 'awaiting_check_in');
  assert.equal(status(visit, null, at('17','05')), 'scheduled_start_passed_without_check_in');
  assert.equal(status(visit, null, at('18')), 'scheduled_end_passed_without_check_in');
  assert.equal(status({...visit,status:'Cancelled'}, null, at('18')), 'not_expected');
});

test('recorded actual times remain distinct from schedule and invalid records are not presented as facts', () => {
  assert.equal(status(visit,{checkInAt:at('17','10')},at('17','20')), 'checked_in');
  assert.equal(status(visit,{checkInAt:at('17','10'),checkOutAt:at('18','15')},at('18','15')), 'checked_out');
  assert.equal(status(visit,{checkOutAt:at('18')},at('18')), 'unavailable');
});

test('check-in and check-out capture actual times in order, without replacing prior records', () => {
  assert.equal(nextVisitAttendance(null, 'check_out', at('17')), null);
  const arrived = nextVisitAttendance(null, 'check_in', at('17','10'));
  assert.deepEqual(arrived, {checkInAt:at('17','10'), checkOutAt:null});
  assert.equal(nextVisitAttendance(arrived, 'check_in', at('17','20')), null);
  assert.equal(nextVisitAttendance(arrived, 'check_out', at('17','00')), null);
  assert.deepEqual(nextVisitAttendance(arrived, 'check_out', at('18','15')), {
    checkInAt:at('17','10'), checkOutAt:at('18','15'),
  });
});

test('wire response accepts separately recorded time only for the exact visit and revision', async () => {
  const {isVisitAttendance}=await import('../lib/operations/visit-attendance.js');
  const actual={visitId:'visit',revision:2,observedAt:at('18'),checkInAt:at('17','10'),checkOutAt:at('18')};
  assert.equal(isVisitAttendance(actual,'visit',2),true);
  assert.equal(isVisitAttendance(actual,'other',2),false);
  assert.equal(isVisitAttendance(actual,'visit',1),false);
  assert.equal(isVisitAttendance({...actual,checkInAt:null},'visit',2),false);
  assert.equal(isVisitAttendance({...actual,checkOutAt:at('18','10')},'visit',2),false);
});

test('attendance dispatch is inert by default; fictional staff write and manager read share the authorized visit contract', async () => {
  const {readOperations}=await import('../lib/admin/operations-read-dispatch.js');
  const {writeOperations}=await import('../lib/admin/operations-write-dispatch.js');
  const visitId='20000000-0000-4000-8000-000000000001';
  const identity=role=>({principal:{id:'fictional actor',operationalRole:role},
    member:{active:true,operational_role:role,revision:4},config:{base:'https://fixture.invalid',key:'fictional'},token:'fictional'});
  const request=(query,role,method)=>new Request('https://fixture.invalid/?'+query,{method,
    headers:{'x-ech-schedule-actor':'fictional actor','x-ech-schedule-role':role}});
  const env={ECH_HOSTED_OPERATIONS_READS:'true',ECH_HOSTED_OPERATIONS_WRITES:'true',ECH_FICTIONAL_VISIT_ATTENDANCE:true};
  const read=request('attendance='+visitId+'&revision=3','manager','GET');
  const write=request('attendance=1','staff','POST');
  const body={visitId,revision:3,action:'check_in'};
  const noFetch=()=>assert.fail('unexpected backend access');
  await assert.rejects(readOperations(identity('manager'),read,noFetch),e=>e.status===405);
  await assert.rejects(writeOperations(identity('staff'),write,body,{...env,ECH_FICTIONAL_VISIT_ATTENDANCE:'true'},noFetch),e=>e.status===405);
  await assert.rejects(writeOperations(identity('manager'),request('attendance=1','manager','POST'),body,env,noFetch),e=>e.status===403);
  const data={visitId,revision:3,observedAt:at('18'),checkInAt:at('18'),checkOutAt:null};
  for (const [role,action] of [['staff','check_in'],['manager','read']]) {
    const fixture=async(url,options)=>{
      assert.match(url,/ech_operations_visit_attendance$/u);
      assert.deepEqual(JSON.parse(options.body),{p_visit_id:visitId,p_revision:3,p_role:role,p_membership_revision:4,p_action:action});
      return Response.json(data);
    };
    assert.deepEqual(role==='staff'?await writeOperations(identity(role),write,body,env,fixture)
      :await readOperations(identity(role),read,fixture,env),data);
  }
});
