// A bounded read contract shared by the server and browser. No write capability.
export const VISIT_REPORT_MAX_BYTES = 1_500_000;
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
const shape = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const integer = (value, minimum = 1) => Number.isSafeInteger(value) && value >= minimum;
// PostgreSQL length(text) counts Unicode code points, not UTF-16 code units.
const text = (value, minimum, maximum) => typeof value === 'string' && Array.from(value).length <= maximum
  && Array.from(value.trim()).length >= minimum && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(value);
const timestamp = value => typeof value === 'string' && !value.startsWith('0000-')
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const commonKeys = ['revision', 'version', 'sourceRevision', 'actorId', 'actorRole', 'recordedAt'];
const versionKeys = [...commonKeys, 'outcome', 'summary', 'issue', 'actualStart', 'actualEnd', 'completedTasks', 'observations', 'reason'];
const reviewKeys = [...commonKeys, 'decision', 'note'];
const common = row => integer(row.revision) && integer(row.version, 0) && uuid(row.actorId)
  && ['owner', 'manager', 'staff'].includes(row.actorRole) && timestamp(row.recordedAt)
  && (row.sourceRevision === null || integer(row.sourceRevision));

export function isVisitReport(value, visitId, visitRevision, expectedReportRevision = null) {
  if (!(shape(value, ['schema', 'visitId', 'visitRevision', 'reportRevision', 'versions', 'reviews',...(Object.hasOwn(value??{},'authorLabels')?['authorLabels']:[]),...(Object.hasOwn(value??{},'completedTaskHistoryEnabled')?['completedTaskHistoryEnabled']:[])]))
    || value.schema !== 1 || !uuid(value.visitId) || value.visitId !== visitId || value.visitRevision !== visitRevision
    || !integer(value.visitRevision) || !integer(value.reportRevision, 0)
    || expectedReportRevision !== null && value.reportRevision !== expectedReportRevision
    || !Array.isArray(value.versions) || !Array.isArray(value.reviews)
    || value.versions.length + value.reviews.length > 1000) return false;
  if (Object.hasOwn(value,'completedTaskHistoryEnabled') && typeof value.completedTaskHistoryEnabled!=='boolean') return false;
  if (Object.hasOwn(value,'authorLabels') && !validReportAuthorLabels(value.authorLabels,value)) return false;
  for (const [index, row] of value.versions.entries()) {
    if (!(shape(row, versionKeys) || shape(row, [...versionKeys, 'noteEventAt']))
      || Object.hasOwn(row, 'noteEventAt') && row.noteEventAt !== null && !timestamp(row.noteEventAt)
      || !common(row) || row.version !== index
      || !['completed', 'follow-up', 'not-completed'].includes(row.outcome)
      || !text(row.summary, 3, 2000) || !text(row.issue, 0, 1000) || !text(row.observations, 0, 3000)
      || !timestamp(row.actualStart) || !timestamp(row.actualEnd) || row.actualStart >= row.actualEnd
      || row.actualEnd > row.recordedAt || Date.parse(row.actualEnd) - Date.parse(row.actualStart) >= 86_400_000
      || !Array.isArray(row.completedTasks) || row.completedTasks.length > 50
      || !row.completedTasks.every(task => text(task, 1, 500))
      || row.outcome === 'completed' && !row.completedTasks.length
      || (index === 0 ? row.reason !== null || row.sourceRevision !== null || row.revision !== 1
        : !text(row.reason, 3, 500) || row.outcome !== value.versions[0].outcome)
      || index > 0 && row.revision <= value.versions[index - 1].revision) return false;
  }
  for (const [index, row] of value.reviews.entries()) {
    if (!shape(row, reviewKeys) || !common(row) || !['owner', 'manager'].includes(row.actorRole)
      || !['accepted', 'returned'].includes(row.decision) || !text(row.note, 3, 500)
      || index > 0 && row.revision <= value.reviews[index - 1].revision) return false;
  }
  const events = [...value.versions.map(row => ({ row, content: true })), ...value.reviews.map(row => ({ row, content: false }))]
    .sort((a, b) => a.row.revision - b.row.revision);
  if (events.length !== value.reportRevision) return false;
  let content;
  for (const [index, event] of events.entries()) {
    const row = event.row;
    if (row.revision !== index + 1 || index > 0 && row.sourceRevision !== content?.revision) return false;
    if (event.content) content = row;
    else if (!content || row.version !== content.version || row.actorId === content.actorId
      || row.actorId === value.versions[0].actorId) return false;
  }
  return true;
}

// Labels are current membership names, not historical names or a staff directory.
export function validReportAuthorLabels(labels,report) {
  const actors=new Set([...report.versions,...report.reviews].map(row=>row?.actorId));
  if(!Array.isArray(labels)||labels.length!==actors.size||labels.length>1000)return false;
  const seen=new Set();
  return labels.every(row=>shape(row,['actorId','currentLabel'])&&uuid(row.actorId)&&actors.has(row.actorId)&&!seen.has(row.actorId)
    &&(row.currentLabel===null||text(row.currentLabel,1,160))&&(seen.add(row.actorId),true));
}
export function isReportAuthorLabels(value,report) {
 return shape(value,['visitId','visitRevision','reportRevision','labels'])&&value.visitId===report.visitId
  &&value.visitRevision===report.visitRevision&&value.reportRevision===report.reportRevision&&validReportAuthorLabels(value.labels,report);
}
