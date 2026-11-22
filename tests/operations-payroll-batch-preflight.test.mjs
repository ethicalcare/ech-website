import test from 'node:test';
import assert from 'node:assert/strict';
import {preflightPayrollReferences} from '../lib/admin/operations-payroll-batch-preflight.js';

const id = n => '10000000-0000-4000-8000-' + String(n).padStart(12,'0');
const instant = hour => '2026-01-08T' + String(hour).padStart(2,'0') + ':00:00.000Z';
const period = {startsAt:'2026-01-01T00:00:00.000Z',endsAt:'2026-01-15T00:00:00.000Z'};
function entry(n, from, to, staffId=id(500)) {
  const pins={visitId:id(n),visitRevision:1,reportRevision:1,contentRevision:1};
  const operationId=id(n+100);
  const interval={actualStart:instant(from),actualEnd:instant(to)};
  return {
    currentReport:{schema:1,...pins,...interval,staffId},
    approval:{schema:1,...pins,operationId,membershipRevision:1,decision:'approve',recordedAt:instant(23)},
    approvedWork:{schema:1,...pins,...interval,operationId,approvedMinutes:(to-from)*60},
    effectiveRates:[{rateId:id(900),staffId,rateRevision:1,startsAt:period.startsAt,endsAt:null,currency:'CAD',hourlyRateCents:2800}],
  };
}
const preflight = entries => preflightPayrollReferences({period,entries});
test('adjacent care visits and simultaneous time for different staff are not treated as overlaps',()=>{
  const result=preflight([entry(1,8,9),entry(2,9,10),entry(3,8,10,id(501))]);
  assert.deepEqual(result,{
    status:'internal_non_postable_preflight',scope:'supplied_care_visits_only',
    nonVisitWorkCoverage:'unverified',completeness:'unverified',
    rows:[0,1,2].map(index=>({index,status:'no_flag_for_supplied_reference',reasons:[]})),
  });
});
test('preserves individual holds and marks same-staff overlaps even when a rate is missing',()=>{
  const rateMissing=entry(1,8,12);
  rateMissing.effectiveRates=[];
  const result=preflight([entry(3,11,12),rateMissing,entry(2,9,10),entry(4,12,13)]);
  assert.deepEqual(result.rows.map(row=>row.reasons),[
    ['overlapping_staff_time'],['rate_missing','overlapping_staff_time'],['overlapping_staff_time'],[],
  ]);
});
test('flags every duplicate visit and approval operation without dropping rows',()=>{
  const a=entry(1,8,9), b=entry(2,10,11), c=entry(1,12,13);
  c.currentReport.visitRevision=c.approval.visitRevision=c.approvedWork.visitRevision=2;
  b.approvedWork.operationId=b.approval.operationId=a.approval.operationId;
  assert.deepEqual(preflight([a,b,c]).rows.map(row=>row.reasons),[
    ['duplicate_visit','duplicate_approval_operation'],['duplicate_approval_operation'],['duplicate_visit','duplicate_approval_operation'],
  ]);
});
test('unverified interval does not turn into overlap evidence, nor disappear',()=>{
  const unverifiable=entry(2,8,10);
  unverifiable.approvedWork.contentRevision=2;
  assert.deepEqual(preflight([entry(1,8,9),unverifiable,null]).rows.map(row=>row.reasons),
    [[],['approved_work_unverified'],['report_unverified']]);
});
test('requires a supplied period and a bounded nonempty list',()=>{
  assert.equal(preflight([]).reason,'entries_unverified');
  assert.equal(preflight(Array(501)).reason,'entries_unverified');
  assert.equal(preflightPayrollReferences({entries:[entry(1,8,9)]}).reason,'period_unverified');
});

test('invalid over-day interval cannot flag its neighbor; exact care day can',()=>{
  const around=entry(1,8,9);
  around.currentReport.actualEnd=around.approvedWork.actualEnd='2026-01-09T08:01:00.000Z';
  around.approvedWork.approvedMinutes=1441;
  around.approval.recordedAt='2026-01-09T09:00:00.000Z';
  const neighbor=entry(2,12,13);
  assert.deepEqual(preflight([around,neighbor]).rows.map(row=>row.reasons),[
    ['time_unverified'],[],
  ]);
  around.currentReport.actualEnd=around.approvedWork.actualEnd='2026-01-09T08:00:00.000Z';
  around.approvedWork.approvedMinutes=1440;
  assert.deepEqual(preflight([around,neighbor]).rows.map(row=>row.reasons),[
    ['time_unverified','overlapping_staff_time'],['overlapping_staff_time'],
  ]);
});
test('an inconsistent explicit quantity cannot invalidate a neighboring valid interval',()=>{
  const uncertain=entry(2,8,10);
  uncertain.approvedWork.approvedMinutes=90;
  assert.deepEqual(preflight([entry(1,8,9),uncertain]).rows.map(row=>row.reasons),
    [[],['approved_quantity_mismatch']]);
});

test('contradictory selected versions of the same staff rate hold all references using it',()=>{
  const a=entry(1,8,9), b=entry(2,9,10), c=entry(3,10,11), other=entry(4,8,9,id(501));
  b.effectiveRates[0].hourlyRateCents=2950;
  other.effectiveRates[0].hourlyRateCents=3800;
  const result=preflight([a,b,c,other]);
  assert.deepEqual(result.rows.map(row=>row.reasons),[
    ['inconsistent_rate_revision'],['inconsistent_rate_revision'],['inconsistent_rate_revision'],[],
  ]);
  assert.doesNotMatch(JSON.stringify(result),/2800|2950|3800/);
});

test('one rate identity cannot change its effective dates between entries, but distinct revisions can',()=>{
  const a=entry(1,8,9), b=entry(2,9,10);
  a.effectiveRates[0].endsAt=instant(9);
  b.effectiveRates[0].startsAt=instant(9);
  assert.deepEqual(preflight([a,b]).rows.map(row=>row.reasons),[
    ['inconsistent_rate_revision'],['inconsistent_rate_revision'],
  ]);
  b.effectiveRates[0].rateRevision=2;
  assert.deepEqual(preflight([a,b]).rows.map(row=>row.reasons),[[],[]]);
});
