import { AdminError, UUID } from './shared-commands.js';
import { visitTasksEnabled, visitTaskAccess } from './operations-visit-task-availability.js';

const id = value => typeof value === 'string' && value.length === 36 && UUID.test(value);
const integer = (value, min = 1) => Number.isSafeInteger(value) && value >= min;
const shape = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const text = (value, max) => typeof value === 'string' && value.length <= max && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/u.test(value);
const stamp = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value));
const outcomes = ['done','declined','unable','not-required'];
const validResult = r => shape(r,['taskId','version','outcome','observation','actualAt','recordedAt','actorId','reason'])
  && id(r.taskId) && integer(r.version) && r.version<=1000 && outcomes.includes(r.outcome)
  && text(r.observation,3000) && stamp(r.actualAt) && stamp(r.recordedAt) && id(r.actorId)
  && (r.version===1 ? r.reason===null : text(r.reason,500) && r.reason.trim().length>=3);
function validRead(v, visit, revision, role, actor) {
  if (!shape(v,['visitId','visitRevision','plan','additions','results','resultVisibility']) || v.visitId!==visit || v.visitRevision!==revision
    || v.resultVisibility!==(role==='staff'?'limited':'complete')
    || !Array.isArray(v.additions) || v.additions.length>50 || !Array.isArray(v.results) || v.results.length>1000) return false;
  const ids=new Set(), categories=new Set(); let count=0;
  if (v.plan!==null && (!Array.isArray(v.plan) || v.plan.length>20 || !v.plan.every(c => {
    if (!shape(c,['id','label','tasks']) || !id(c.id) || categories.has(c.id) || !text(c.label,100) || !c.label.trim() || !Array.isArray(c.tasks)) return false;
    categories.add(c.id); return c.tasks.every(t => {
      if (!shape(t,['id','text']) || !id(t.id) || ids.has(t.id) || !text(t.text,500) || !t.text.trim() || ++count>100) return false;
      ids.add(t.id); return true;
    });
  }))) return false;
  if (!v.additions.every((a,i) => shape(a,['categoryId','taskId','text','ordinal']) && categories.has(a.categoryId)
    && id(a.taskId) && !ids.has(a.taskId) && text(a.text,500) && !!a.text.trim() && a.ordinal===i+1 && (ids.add(a.taskId),true))) return false;
  const last=new Map(); return v.results.every(r => validResult(r) && ids.has(r.taskId) && (role!=='staff' || r.actorId===actor)
    && r.version>(last.get(r.taskId)||0) && (last.set(r.taskId,r.version),true));
}
function validWrite(v, memberRevision) {
  return shape(v,['visitId','visitRevision','membershipRevision','taskId','expectedVersion','operationId','outcome','observation','actualAt','reason'])
    && id(v.visitId) && integer(v.visitRevision) && v.membershipRevision===memberRevision && id(v.taskId)
    && integer(v.expectedVersion,0) && v.expectedVersion<=999 && id(v.operationId) && outcomes.includes(v.outcome)
    && text(v.observation,3000) && stamp(v.actualAt) && (v.expectedVersion===0 ? v.reason===null : text(v.reason,500) && v.reason.trim().length>=3);
}
async function rpc(current,name,body,fetcher,writing) {
  const unknown=()=>new AdminError(writing?502:503,writing?'write_unconfirmed':'unavailable',writing?'Save outcome unknown. Keep the same request.':'Visit tasks could not be verified.');
  let r; try { r=await fetcher(current.config.base+'/rest/v1/rpc/'+name,{method:'POST',redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(10000),headers:{apikey:current.config.key,Authorization:'Bearer '+current.token,'Content-Type':'application/json'},body:JSON.stringify(body)}); } catch { throw unknown(); }
  if ([400,401,403,409,412,413].includes(r.status)) throw new AdminError(r.status,r.status===401?'unauthenticated':r.status===403?'forbidden':r.status===412?'stale_visit':r.status===409?'conflict':'invalid_request','Visit task access or data changed. Review the current visit.');
  if(r.redirected || r.status!==200 || r.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json' || !r.body) throw unknown();
  const reader=r.body.getReader(), decoder=new TextDecoder('utf-8',{fatal:true}); let data='',size=0;
  try { for(;;){const p=await reader.read();if(p.done)break;size+=p.value.byteLength;if(size>500000){await reader.cancel();throw unknown();}data+=decoder.decode(p.value,{stream:true});}return JSON.parse(data+decoder.decode()); }
  catch {throw unknown();} finally {reader.releaseLock();}
}
// Session and origin checks precede this adapter in handleAdmin. The existing
// RPC rechecks grants, assigned worker, membership and visit revision atomically;
// neither availability nor response validation grants that authority.
export async function visitTasks(current,method,params,raw,env,fetcher) {
  if(!visitTasksEnabled(env)) throw new AdminError(405,'disabled','Visit tasks are not enabled.');
  const {role,revision:m,actor}=visitTaskAccess(current);
  if(method==='GET') {
    if(params.size!==4 || params.get('visitTasks')!=='1' || [...params.keys()].some(k=>!['visitTasks','visitId','visitRevision','membershipRevision'].includes(k)||params.getAll(k).length!==1)) throw new AdminError(400,'invalid_request','Choose a current visit.');
    const visit=params.get('visitId'), rev=Number(params.get('visitRevision'));
    if(!id(visit)||!integer(rev)||String(rev)!==params.get('visitRevision')) throw new AdminError(400,'invalid_request','Choose a current visit.');
    if(String(m)!==params.get('membershipRevision'))throw new AdminError(409,'scope_changed','Account access changed. Reopen the workspace.');
    const v=await rpc(current,'ech_operations_visit_task_plan_read',{p_visit:visit,p_visit_revision:rev,p_role:role,p_membership_revision:m},fetcher,false);
    if(!validRead(v,visit,rev,role,actor)) throw new AdminError(503,'unavailable','Visit task data could not be verified.'); return v;
  }
  if(method!=='POST'||params.size!==1||params.get('visitTasks')!=='1')throw new AdminError(400,'invalid_request','Choose one task-result command.');
  if(role!=='staff')throw new AdminError(403,'forbidden','Only the current assigned worker can record task results.');
  if(raw?.membershipRevision!==m)throw new AdminError(409,'scope_changed','Account access changed. Reopen the workspace.');
  if(!validWrite(raw,m)) throw new AdminError(400,'invalid_request','Review the exact task result.');
  // Preserve the exact operation and expected version. Never manufacture a new
  // identity for retries; ambiguous responses remain write_unconfirmed.
  const r=await rpc(current,'ech_operations_visit_task_result_write',{p_visit:raw.visitId,p_visit_revision:raw.visitRevision,p_membership_revision:m,p_task:raw.taskId,p_expected_version:raw.expectedVersion,p_operation:raw.operationId,p_outcome:raw.outcome,p_observation:raw.observation,p_actual_at:raw.actualAt,p_reason:raw.reason},fetcher,true);
  if(!shape(r,['visitId','taskId','version','operationId','recordedAt'])||r.visitId!==raw.visitId||r.taskId!==raw.taskId||r.version!==raw.expectedVersion+1||r.operationId!==raw.operationId||!stamp(r.recordedAt)) throw new AdminError(502,'write_unconfirmed','Save outcome unknown. Keep the same request.');
  return r;
}
