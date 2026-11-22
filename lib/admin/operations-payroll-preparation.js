// Internal preparation only. Inputs must be assembled from trusted, scoped
// records before calling; this pure function does not authenticate receipts,
// authorize payroll access, persist state, or determine wages or eligibility. Do not manufacture an
// approved input from the current report or the existing status-only API.
const MINUTE_MS = 60_000;
const PINS = ['visitId', 'visitRevision', 'reportRevision', 'contentRevision'];
const uuid = value => typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
const revision = value => Number.isSafeInteger(value) && value > 0;
const hold = reason => ({ status: 'hold', reason });

function time(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)) return NaN;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && new Date(ms).toISOString() === value ? ms : NaN;
}

// Shared structural validation for one rate record; this does not determine
// applicability, schedule completeness, authorization or wages.
export function isValidPayrollRate(rate, staffId) {
  const startsAt = time(rate?.startsAt);
  const endsAt = rate?.endsAt === null ? Infinity : time(rate?.endsAt);
  return uuid(staffId) && startsAt < endsAt && rate.staffId === staffId && uuid(rate.rateId) &&
    revision(rate.rateRevision) && rate.currency === 'CAD' &&
    Number.isSafeInteger(rate.hourlyRateCents) && rate.hourlyRateCents > 0;
}

function window(start, end) {
  const from = time(start), to = time(end);
  return from < to ? [from, to] : null;
}

// A period and rate window are half-open UTC intervals. The caller must
// supply the business-approved boundaries (including local-time conversion).
// A visit crossing either boundary is held, not split or assigned by guess.
export function preparePayrollInput(input) {
  const { currentReport, approval, approvedWork, period, effectiveRates } = input ?? {};
  if (!currentReport || currentReport.schema !== 1 || !uuid(currentReport.visitId) ||
      !['visitRevision', 'reportRevision', 'contentRevision'].every(key => revision(currentReport[key])) ||
      currentReport.contentRevision > currentReport.reportRevision ||
      !uuid(currentReport.staffId)) return hold('report_unverified');
  if (approval?.schema !== 1 || approval.decision !== 'approve' || !uuid(approval.operationId) ||
      !revision(approval.membershipRevision) || !Number.isFinite(time(approval.recordedAt))) {
    return hold('approval_missing');
  }
  if (!PINS.every(key => currentReport[key] === approval[key])) return hold('approval_revision_changed');

  // The report is only a cross-check. The exact work interval and quantity
  // must be bound to this decision by a trusted approval handoff, not inferred.
  if (!approvedWork || approvedWork.schema !== 1 || approvedWork.operationId !== approval.operationId ||
      !PINS.every(key => approvedWork[key] === currentReport[key])) return hold('approved_work_unverified');
  if (approvedWork.actualStart !== currentReport.actualStart || approvedWork.actualEnd !== currentReport.actualEnd) {
    return hold('approved_interval_mismatch');
  }
  const worked = window(approvedWork.actualStart, approvedWork.actualEnd);
  if (!worked || worked[1] - worked[0] >= 24 * 60 * MINUTE_MS) return hold('time_unverified');
  if (time(approval.recordedAt) < worked[1]) return hold('approval_precedes_work_end');
  if (!revision(approvedWork.approvedMinutes)) return hold('approved_work_unverified');
  const durationMs = worked[1] - worked[0];
  if (durationMs % MINUTE_MS !== 0) return hold('fractional_minute');
  if (approvedWork.approvedMinutes !== durationMs / MINUTE_MS) return hold('approved_quantity_mismatch');
  const periodBounds = window(period?.startsAt, period?.endsAt);
  if (!periodBounds) return hold('period_unverified');
  if (worked[0] < periodBounds[0] || worked[1] > periodBounds[1]) return hold('outside_or_crossing_period');

  // The caller supplies the full applicable schedule for this staff member.
  // Reject overlapping/piecewise windows; never choose an arbitrary rate.
  if (!Array.isArray(effectiveRates) || effectiveRates.length === 0) return hold('rate_missing');
  const overlapping = [];
  const identity = new Map();
  for (const rate of effectiveRates) {
    const startsAt = time(rate?.startsAt);
    const endsAt = rate?.endsAt === null ? Infinity : time(rate?.endsAt);
    if (!isValidPayrollRate(rate, currentReport.staffId)) return hold('rate_unverified');
    const key = rate.rateId + ':' + rate.rateRevision;
    const metadata = JSON.stringify([rate.staffId, rate.startsAt, rate.endsAt, rate.currency, rate.hourlyRateCents]);
    if (identity.has(key) && identity.get(key) !== metadata) return hold('rate_identity_conflict');
    identity.set(key, metadata);
    if (startsAt < worked[1] && endsAt > worked[0]) overlapping.push({ rate, startsAt, endsAt });
  }
  if (overlapping.length !== 1 || overlapping[0].startsAt > worked[0] || overlapping[0].endsAt < worked[1]) {
    return hold(overlapping.length === 0 ? 'rate_missing' : 'rate_ambiguous_or_crossing');
  }

  const { rate } = overlapping[0];
  const { approvedMinutes } = approvedWork;
  const centsNumerator = BigInt(approvedMinutes) * BigInt(rate.hourlyRateCents);
  if (centsNumerator % 60n !== 0n) return hold('fractional_cent');
  const exactCents = centsNumerator / 60n;
  if (exactCents > BigInt(Number.MAX_SAFE_INTEGER)) return hold('amount_out_of_range');

  return {
    status: 'internal_non_postable_reference',
    scope: 'single_care_visit_only',
    nonVisitWorkCoverage: 'unverified', // e.g. travel between worksites; not presumed zero
    approvedInterval: { startsAt: approvedWork.actualStart, endsAt: approvedWork.actualEnd },
    source: Object.fromEntries(PINS.map(key => [key, currentReport[key]])),
    approvalOperationId: approval.operationId,
    staffId: currentReport.staffId,
    period: { startsAt: period.startsAt, endsAt: period.endsAt },
    rate: { id: rate.rateId, revision: rate.rateRevision, hourlyRateCents: rate.hourlyRateCents, currency: rate.currency },
    approvedMinutes,
    // Exact straight arithmetic only, not gross, payable, net, or legal wages.
    unadjustedReferenceCents: Number(exactCents),
  };
}
