import assert from 'node:assert/strict';
import { test } from 'node:test';
import { preparePayrollInput } from '../lib/admin/operations-payroll-preparation.js';

const visitId = '10000000-0000-4000-8000-000000000001';
const staffId = '20000000-0000-4000-8000-000000000002';
const rateId = '30000000-0000-4000-8000-000000000003';
const operationId = '40000000-0000-4000-8000-000000000004';
const t = (day, time = '00:00:00.000') => '2026-01-' + day + 'T' + time + 'Z';
function fixture() {
  const pins = { visitId, visitRevision: 5, reportRevision: 9, contentRevision: 7 };
  return {
    currentReport: { schema: 1, ...pins, staffId, actualStart: t('07', '08:00:00.000'),
      actualEnd: t('07', '09:30:00.000'), unusedSensitiveField: 'fictional never return' },
    approval: { schema: 1, ...pins, membershipRevision: 3, operationId, decision: 'approve',
      recordedAt: t('08'), unusedSensitiveField: 'fictional never return' },
    approvedWork: { schema: 1, ...pins, operationId, actualStart: t('07', '08:00:00.000'),
      actualEnd: t('07', '09:30:00.000'), approvedMinutes: 90 },
    period: { startsAt: t('07'), endsAt: t('21') },
    effectiveRates: [{ rateId, staffId, rateRevision: 2, startsAt: t('03'), endsAt: null,
      hourlyRateCents: 2800, currency: 'CAD', unusedSensitiveField: 'fictional never return' }],
  };
}
function holds(input, reason) {
  assert.deepEqual(preparePayrollInput(input), { status: 'hold', reason });
}
test('prepares an exact cents arithmetic reference, carrying only pinned inputs', () => {
  const input = fixture();
  Object.values(input).forEach(Object.freeze);
  assert.deepEqual(preparePayrollInput(input), {
    status: 'internal_non_postable_reference',
    scope: 'single_care_visit_only', nonVisitWorkCoverage: 'unverified',
    approvedInterval: { startsAt: t('07','08:00:00.000'), endsAt: t('07','09:30:00.000') },
    source: { visitId, visitRevision: 5, reportRevision: 9, contentRevision: 7 },
    approvalOperationId: operationId, staffId, period: { startsAt: t('07'), endsAt: t('21') },
    rate: { id: rateId, revision: 2, hourlyRateCents: 2800, currency: 'CAD' },
    approvedMinutes: 90, unadjustedReferenceCents: 4200,
  });
});
test('requires verified report and approval decision, and holds every corrected pin', () => {
  holds(null, 'report_unverified');
  const missing = fixture();
  delete missing.approval;
  holds(missing, 'approval_missing');
  const returned = fixture();
  returned.approval.decision = 'return';
  holds(returned, 'approval_missing');
  for (const key of ['visitId', 'visitRevision', 'reportRevision', 'contentRevision']) {
    const input = fixture();
    input.currentReport[key] = key === 'visitId' ? rateId : input.currentReport[key] + 1;
    holds(input, 'approval_revision_changed');
  }
});
test('requires explicit normalized period boundaries and does not split', () => {
  const input = fixture();
  input.period.startsAt = '2026-01-07';
  holds(input, 'period_unverified');
  input.period.startsAt = t('07','09:01:00.000');
  holds(input, 'outside_or_crossing_period');
  input.period.startsAt = input.currentReport.actualStart;
  input.period.endsAt = input.currentReport.actualEnd;
  assert.equal(preparePayrollInput(input).status, 'internal_non_postable_reference');
});
test('does not guess which rate applies or bridge a rate change', () => {
  const input = fixture();
  const rate = input.effectiveRates[0];
  input.effectiveRates = [];
  holds(input, 'rate_missing');
  input.effectiveRates = [rate, { ...rate, rateId: visitId }];
  holds(input, 'rate_ambiguous_or_crossing');
  input.effectiveRates = [{ ...rate, endsAt: t('07','09:00:00.000'), rateRevision: 1 },
    { ...rate, startsAt: t('07','09:00:00.000') }];
  holds(input, 'rate_ambiguous_or_crossing');
  input.effectiveRates = [{ ...rate, endsAt: input.currentReport.actualStart, rateRevision: 1 }, rate];
  assert.equal(preparePayrollInput(input).status, 'internal_non_postable_reference');
  input.effectiveRates = [{ ...rate, staffId: visitId }];
  holds(input, 'rate_unverified');
  input.effectiveRates = [{ ...rate, currency: 'USD' }];
  holds(input, 'rate_unverified');
});
test('holds sub-minute input, fractional cents and unsafe numeric output', () => {
  const input = fixture();
  input.approvedWork.actualEnd = input.currentReport.actualEnd = t('07','09:00:01.000');
  holds(input, 'fractional_minute');
  input.approvedWork.actualEnd = input.currentReport.actualEnd = t('07','09:01:00.000');
  input.approvedWork.approvedMinutes = 61;
  holds(input, 'fractional_cent');
  input.approvedWork.actualEnd = input.currentReport.actualEnd = t('07','09:30:00.000');
  input.approvedWork.approvedMinutes = 90;
  input.effectiveRates[0].hourlyRateCents = Number.MAX_SAFE_INTEGER - 1;
  holds(input, 'amount_out_of_range');
});

test('does not infer an approved interval or minutes from an approval receipt or report', () => {
  const input = fixture();
  const work = input.approvedWork;
  delete input.approvedWork;
  holds(input, 'approved_work_unverified');
  input.approvedWork = { ...work, operationId: rateId };
  holds(input, 'approved_work_unverified');
  input.approvedWork = { ...work, contentRevision: 6 };
  holds(input, 'approved_work_unverified');
  input.approvedWork = { ...work, actualEnd: t('07','09:00:00.000'), approvedMinutes: 60 };
  holds(input, 'approved_interval_mismatch');
  input.approvedWork = { ...work, approvedMinutes: -90 };
  holds(input, 'approved_work_unverified');
  input.approvedWork = { ...work, approvedMinutes: 89 };
  holds(input, 'approved_quantity_mismatch');
});
test('cannot use approval before work ends or normalize work at or above a full day', () => {
  const input = fixture();
  input.approval.recordedAt = t('07','09:29:59.999');
  holds(input, 'approval_precedes_work_end');
  input.approval.recordedAt = t('07','09:30:00.000');
  assert.equal(preparePayrollInput(input).status, 'internal_non_postable_reference');
  input.approval.recordedAt = t('09');
  input.approvedWork.actualEnd = input.currentReport.actualEnd = t('08','08:00:00.000');
  input.approvedWork.approvedMinutes = 1440;
  holds(input, 'time_unverified');
  input.approvedWork.actualEnd = input.currentReport.actualEnd = t('08','08:01:00.000');
  input.approvedWork.approvedMinutes = 1441;
  holds(input, 'time_unverified');
});
test('a rate identity cannot carry conflicting windows or values anywhere in its schedule', () => {
  const input = fixture();
  const rate = input.effectiveRates[0];
  input.effectiveRates = [{ ...rate, startsAt: t('01'), endsAt: t('02') }, rate];
  holds(input, 'rate_identity_conflict');
  input.effectiveRates = [
    { ...rate, rateRevision: 1, startsAt: t('01'), endsAt: t('02') },
    { ...rate, rateRevision: 1, startsAt: t('01'), endsAt: t('02'), hourlyRateCents: 2900 }, rate,
  ];
  holds(input, 'rate_identity_conflict');
});

test('two visit references preserve their exact intervals and never treat travel or the gap as zero', () => {
  const first = fixture();
  const second = fixture();
  const pin = '50000000-0000-4000-8000-000000000005';
  const secondOperation = '60000000-0000-4000-8000-000000000006';
  for (const record of [second.currentReport, second.approval, second.approvedWork]) record.visitId = pin;
  second.approval.operationId = second.approvedWork.operationId = secondOperation;
  second.currentReport.actualStart = second.approvedWork.actualStart = t('07','10:00:00.000');
  second.currentReport.actualEnd = second.approvedWork.actualEnd = t('07','11:30:00.000');
  // No trusted records for work between the two locations were supplied.
  const references = [first, second].map(preparePayrollInput);
  assert.deepEqual(references.map(row => row.approvedInterval), [
    { startsAt: t('07','08:00:00.000'), endsAt: t('07','09:30:00.000') },
    { startsAt: t('07','10:00:00.000'), endsAt: t('07','11:30:00.000') },
  ]);
  for (const reference of references) {
    assert.equal(reference.scope, 'single_care_visit_only');
    assert.equal(reference.nonVisitWorkCoverage, 'unverified');
    assert.equal(reference.status, 'internal_non_postable_reference');
  }
});
