// Strict request and receipt contracts shared by the local client and server.
const shape = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const integer = (value, minimum = 1) => Number.isSafeInteger(value) && value >= minimum;
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
const text = (value, min, max) => typeof value === 'string' && Array.from(value).length <= max
  && Array.from(value.trim()).length >= min && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(value);
const stamp = value => typeof value === 'string' && !value.startsWith('0000-')
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
export function isVisitAction(value, now = Date.now()) {
  if (!shape(value, ['schema','operationId','visitId','visitRevision','reportRevision','membershipRevision','command'])
    || value.schema !== 1 || !uuid(value.operationId) || !uuid(value.visitId) || !integer(value.visitRevision)
    || !integer(value.membershipRevision) || value.visitRevision === Number.MAX_SAFE_INTEGER) return false;
  const c = value.command;
  if (shape(c, ['type']) && c.type === 'start') return value.reportRevision === null;
  if (!integer(value.reportRevision, 0) || value.reportRevision === Number.MAX_SAFE_INTEGER || !c) return false;
  if (c.type === 'review') return shape(c, ['type','version','decision','note']) && integer(c.version, 0)
    && value.reportRevision > 0 && ['accepted','returned'].includes(c.decision) && text(c.note, 3, 500);
  if (!['submit','correct'].includes(c.type) || (c.type === 'submit') !== (value.reportRevision === 0)
    || !(shape(c, ['type','summary','issue','actualStart','actualEnd','completedTasks','observations', c.type === 'submit' ? 'outcome' : 'reason'])
      || shape(c, ['type','summary','issue','actualStart','actualEnd','completedTasks','observations', c.type === 'submit' ? 'outcome' : 'reason','noteEventAt']))
    || Object.hasOwn(c, 'noteEventAt') && c.noteEventAt !== null && !stamp(c.noteEventAt)
    || !text(c.summary, 3, 2000) || !text(c.issue, 0, 1000) || !text(c.observations, 0, 3000)
    || !stamp(c.actualStart) || !stamp(c.actualEnd) || c.actualStart >= c.actualEnd
    || Date.parse(c.actualEnd) > now || Date.parse(c.actualEnd) - Date.parse(c.actualStart) >= 86_400_000
    || !Array.isArray(c.completedTasks) || c.completedTasks.length > 50 || !c.completedTasks.every(task => text(task, 1, 500))) return false;
  return c.type === 'submit' ? ['completed','follow-up','not-completed'].includes(c.outcome)
    && (c.outcome !== 'completed' || c.completedTasks.length > 0) : text(c.reason, 3, 500);
}
export function isVisitActionReceipt(value, request) {
  if (!shape(value, ['schema','operationId','visitId','visitRevision','reportRevision','reportVersion','action','recordedAt'])
    || value.schema !== 1 || value.operationId !== request.operationId || value.visitId !== request.visitId
    || value.action !== request.command.type) return false;
  if (value.action === 'start') return value.visitRevision === request.visitRevision + 1
    && value.reportRevision === null && value.reportVersion === null && value.recordedAt === null;
  return stamp(value.recordedAt) && value.visitRevision === request.visitRevision + (value.action === 'submit' ? 1 : 0)
    && value.reportRevision === request.reportRevision + 1 && integer(value.reportVersion, 0)
    && (value.action !== 'submit' || value.reportVersion === 0)
    && (value.action !== 'review' || value.reportVersion === request.command.version);
}
export function isStartResult(value, request) {
  if (!shape(value, ['visit','receipt']) || !shape(value.receipt, ['operationId','expectedRevision','revision'])
    || value.receipt.operationId !== request.operationId || value.receipt.expectedRevision !== request.visitRevision
    || value.receipt.revision !== request.visitRevision + 1) return false;
  const v = value.visit;
  return shape(v, ['id','clientId','workerId','service','start','end','status','revision'])
    && v.id === request.visitId && uuid(v.clientId) && uuid(v.workerId) && ['Home support','Nursing'].includes(v.service)
    && v.status === 'In progress' && v.revision === value.receipt.revision && stamp(v.start) && stamp(v.end) && v.start < v.end;
}
