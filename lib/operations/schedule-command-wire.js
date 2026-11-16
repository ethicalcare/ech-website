const shape = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value,key));
const id = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
const revision = value => Number.isSafeInteger(value) && value > 0 && value < Number.MAX_SAFE_INTEGER;
const stamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  && !value.startsWith('0000-') && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const reason = value => typeof value === 'string' && value.trim().length >= 3 && value.length <= 500 && !/[\x00-\x1f\x7f]/.test(value);
const fields = {assign:['type','workerId','reason'],unassign:['type','reason'],reschedule:['type','start','end','reason'],cancel:['type','reason'],confirm:['type']};
export function isScheduleCommand(value) {
  if (!shape(value,['schema','operationId','visitId','visitRevision','membershipRevision','command']) || value.schema !== 1
    || !id(value.operationId) || !id(value.visitId) || !revision(value.visitRevision) || !revision(value.membershipRevision)) return false;
  const c=value.command;
  if (!c || !Object.hasOwn(fields,c.type) || !shape(c,fields[c.type])) return false;
  if (c.type!=='confirm' && !reason(c.reason)) return false;
  return (c.type!=='assign' || id(c.workerId)) && (c.type!=='reschedule' || stamp(c.start) && stamp(c.end) && c.start<c.end);
}
export function isScheduleVisit(value) {
  return shape(value,['id','clientId','workerId','service','start','end','status','revision']) && id(value.id) && id(value.clientId)
    && (value.workerId===null || id(value.workerId)) && ['Home support','Nursing'].includes(value.service)
    && ['Open','Assigned','Confirmed','In progress','Completed','Cancelled'].includes(value.status)
    && (value.status==='Cancelled' || (value.status==='Open')===(value.workerId===null))
    && stamp(value.start) && stamp(value.end) && value.start<value.end && revision(value.revision);
}
export function isScheduleCommandResult(value, request) {
  if (!shape(value,['visit','receipt']) || !isScheduleVisit(value.visit) || value.visit.id!==request.visitId
    || value.visit.revision!==request.visitRevision+1 || !shape(value.receipt,['operationId','expectedRevision','revision'])
    || value.receipt.operationId!==request.operationId || value.receipt.expectedRevision!==request.visitRevision || value.receipt.revision!==value.visit.revision) return false;
  const c=request.command,v=value.visit;
  return c.type==='assign' ? v.workerId===c.workerId && v.status==='Assigned'
    : c.type==='unassign' ? v.workerId===null && v.status==='Open'
      : c.type==='cancel' ? v.status==='Cancelled'
        : c.type==='confirm' ? v.status==='Confirmed' : v.start===c.start && v.end===c.end && ['Open','Assigned'].includes(v.status);
}
