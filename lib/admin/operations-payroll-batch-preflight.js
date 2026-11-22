import {preparePayrollInput, isValidPayrollRate} from './operations-payroll-preparation.js';

const CARE_MAX_ELAPSED_MS = 86_400_000;
const MINUTE_MS = 60_000;
const MAX_ENTRIES = 500; // bounded diagnostic only, not a payroll batch rule
const PINS = ['visitId', 'visitRevision', 'reportRevision', 'contentRevision'];
const uuid = value => typeof value === 'string' &&
  /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value);
const time = value => {
  if (typeof value !== 'string' || value.startsWith('0000-') || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)) return NaN;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && new Date(ms).toISOString() === value ? ms : NaN;
};
const scope = {
  scope: 'supplied_care_visits_only',
  nonVisitWorkCoverage: 'unverified',
  completeness: 'unverified',
};

// No lock, batch identity, policy, authorization, persistence, or payroll
// output. Call only with data assembled by a trusted read boundary.
export function preflightPayrollReferences(input) {
  const {period, entries} = input ?? {};
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > MAX_ENTRIES) {
    return {...scope, status: 'internal_preflight_unavailable', reason: 'entries_unverified', rows: []};
  }
  if (!(time(period?.startsAt) < time(period?.endsAt))) {
    return {...scope, status: 'internal_preflight_unavailable', reason: 'period_unverified', rows: []};
  }

  const byVisit = new Map(), byOperation = new Map(), byStaff = new Map(), byRate = new Map();
  function group(map, key, value) {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(value);
  }
  const rows = Array.from(entries, (entry, index) => {
    const {currentReport, approval, approvedWork, effectiveRates} = entry ?? {};
    const result = preparePayrollInput({currentReport, approval, approvedWork, effectiveRates, period});
    const reasons = new Set(result.status === 'hold' ? [result.reason] : []);
    if (uuid(currentReport?.visitId)) group(byVisit, currentReport.visitId, reasons);
    if (uuid(approval?.operationId)) group(byOperation, approval.operationId, reasons);

    // Validate rate evidence independently of unrelated preparation holds.
    // Unvalidated records cannot poison other rows; no rate details leave here.
    if (Array.isArray(effectiveRates)) {
      for (const rate of effectiveRates) {
        if (!isValidPayrollRate(rate, currentReport?.staffId)) continue;
        const version = [currentReport.staffId, rate.rateId, rate.rateRevision].join(':');
        const metadata = JSON.stringify([rate.currency, rate.hourlyRateCents, rate.startsAt, rate.endsAt]);
        group(byRate, version, {metadata, reasons});
      }
    }

    // Diagnose only exact pinned approved intervals, even if a distinct
    // problem (such as a missing rate or a 24h hold) prevents preparation.
    const start = time(approvedWork?.actualStart), end = time(approvedWork?.actualEnd);
    const elapsed = end - start;
    if (elapsed > 0 && elapsed <= CARE_MAX_ELAPSED_MS &&
        Number.isSafeInteger(approvedWork.approvedMinutes) && approvedWork.approvedMinutes > 0 &&
        approvedWork.approvedMinutes * MINUTE_MS === elapsed && uuid(currentReport?.staffId) && uuid(currentReport.visitId) &&
        currentReport.schema === 1 && approval?.schema === 1 && approvedWork.schema === 1 &&
        approval.decision === 'approve' && uuid(approval.operationId) && Number.isSafeInteger(approval.membershipRevision) &&
        approval.membershipRevision > 0 && time(approval.recordedAt) >= end && approval.operationId === approvedWork.operationId &&
        PINS.every(key=>approval[key]===currentReport[key]&&approvedWork[key]===currentReport[key]) &&
        PINS.slice(1).every(key=>Number.isSafeInteger(currentReport[key])&&currentReport[key]>0) &&
        currentReport.contentRevision<=currentReport.reportRevision &&
        currentReport.actualStart === approvedWork.actualStart && currentReport.actualEnd === approvedWork.actualEnd) {
      group(byStaff, currentReport.staffId, {start, end, reasons});
    }
    return {index, reasons};
  });
  for (const [groups, reason] of [[byVisit, 'duplicate_visit'], [byOperation, 'duplicate_approval_operation']]) {
    for (const duplicates of groups.values()) {
      if (duplicates.length > 1) for (const row of duplicates) row.add(reason);
    }
  }
  for (const references of byRate.values()) {
    if (new Set(references.map(row => row.metadata)).size > 1) {
      for (const row of references) row.reasons.add('inconsistent_rate_revision');
    }
  }
  for (const intervals of byStaff.values()) {
    intervals.sort((a, b) => a.start - b.start || b.end - a.end);
    let through = null;
    for (const current of intervals) {
      if (through && current.start < through.end) {
        through.reasons.add('overlapping_staff_time');
        current.reasons.add('overlapping_staff_time');
      }
      if (!through || current.end > through.end) through = current;
    }
  }
  return {
    ...scope, status: 'internal_non_postable_preflight',
    rows: rows.map(({index,reasons}) => ({index, status:reasons.size?'hold':'no_flag_for_supplied_reference', reasons:[...reasons]})),
  };
}
