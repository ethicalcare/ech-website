const shape=(v,keys)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const id=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
const text=(v,max)=>typeof v==='string'&&[...v].length<=max&&!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/u.test(v);
const stamp=v=>typeof v==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(v)&&Number.isFinite(Date.parse(v));
export const COMPLETED_TASK_HISTORY_MAX_BYTES=500000;
export function isCompletedTaskHistory(v,visit,revision,reportRevision,role,actor){
 if(!shape(v,['visitId','visitRevision','reportRevision','resultVisibility','results'])||v.visitId!==visit||v.visitRevision!==revision||v.reportRevision!==reportRevision||v.resultVisibility!==(role==='staff'?'limited':'complete')||!Array.isArray(v.results)||v.results.length>1000)return false;
 const versions=new Map();
 return v.results.every(r=>{
  if(!shape(r,['taskId','taskLabel','version','outcome','observation','actualAt','recordedAt','actorId','reason'])||!id(r.taskId)||!text(r.taskLabel,500)||!r.taskLabel.trim()||!Number.isSafeInteger(r.version)||r.version<1||r.version>1000||r.version<=(versions.get(r.taskId)||0)||!['done','declined','unable','not-required'].includes(r.outcome)||!text(r.observation,3000)||!stamp(r.actualAt)||!stamp(r.recordedAt)||!id(r.actorId)||(role==='staff'&&r.actorId!==actor)||(r.version===1?r.reason!==null:!text(r.reason,500)||r.reason.trim().length<3))return false;
  versions.set(r.taskId,r.version);return true;
 });
}
