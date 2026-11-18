// Attendance describes what staff recorded, not where they were or what is payable.
const asTime = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)) return NaN;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value ? timestamp : NaN;
};

export function visitAttendanceStatus(visit, actual, observedAt) {
  const start = asTime(visit?.start), end = asTime(visit?.end), now = asTime(observedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(now) || start >= end)
    return 'unavailable';
  const arrival = actual?.checkInAt == null ? null : asTime(actual.checkInAt);
  const departure = actual?.checkOutAt == null ? null : asTime(actual.checkOutAt);
  if ((arrival !== null && (!Number.isFinite(arrival) || arrival > now)) ||
      (departure !== null && (!Number.isFinite(departure) || arrival === null || departure < arrival || departure > now)))
    return 'unavailable';
  if (departure !== null) return 'checked_out';
  if (arrival !== null) return 'checked_in';
  if (!visit.workerId || !['Assigned', 'Confirmed', 'In progress'].includes(visit.status))
    return 'not_expected';
  if (now >= end) return 'scheduled_end_passed_without_check_in';
  if (now > start) return 'scheduled_start_passed_without_check_in';
  return 'awaiting_check_in';
}

// A trusted server-side recording time, not a client-editable clock or visit status.
export function nextVisitAttendance(actual, action, recordedAt) {
  const recorded = asTime(recordedAt);
  const arrival = actual?.checkInAt ?? null;
  const departure = actual?.checkOutAt ?? null;
  if (!Number.isFinite(recorded)) return null;
  if (action === 'check_in' && arrival === null && departure === null)
    return {checkInAt:recordedAt, checkOutAt:null};
  if (action === 'check_out' && arrival !== null && departure === null &&
      Number.isFinite(asTime(arrival)) && asTime(arrival) <= recorded)
    return {checkInAt:arrival, checkOutAt:recordedAt};
  return null;
}

export function isVisitAttendance(value, visitId, revision) {
  if (!value || Object.keys(value).length !== 5 || value.visitId !== visitId ||
      value.revision !== revision || !Number.isFinite(asTime(value.observedAt))) return false;
  const arrival = value.checkInAt, departure = value.checkOutAt;
  if (arrival === null) return departure === null;
  const start = asTime(arrival), now = asTime(value.observedAt);
  return Number.isFinite(start) && start <= now && (departure === null ||
    (Number.isFinite(asTime(departure)) && asTime(departure) >= start && asTime(departure) <= now));
}
