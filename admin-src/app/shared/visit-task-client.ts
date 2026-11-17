import { SharedError, uuid, type OperationalRole } from './live-model.ts';
import { readJson, requestOptions, statusError } from './session.ts';

// The caller retains the exact write request until its outcome is confirmed.
// A missing result is not evidence that care was missed.
export type VisitTaskOutcome = 'done' | 'declined' | 'unable' | 'not-required';
export type VisitTask = { id: string; text: string };
export type VisitTaskCategory = { id: string; label: string; tasks: VisitTask[] };
export type VisitTaskAddition = { categoryId: string; taskId: string; text: string; ordinal: number };
export type VisitTaskResult = {
  taskId: string; version: number; outcome: VisitTaskOutcome; observation: string;
  actualAt: string; recordedAt: string; actorId: string; reason: string | null;
};
export type VisitTaskRead = {
  visitId: string; visitRevision: number; plan: VisitTaskCategory[] | null;
  additions: VisitTaskAddition[]; results: VisitTaskResult[]; resultVisibility: 'limited' | 'complete';
};
export type VisitTaskWrite = {
  visitId: string; visitRevision: number; membershipRevision: number; taskId: string;
  expectedVersion: number; operationId: string; outcome: VisitTaskOutcome;
  observation: string; actualAt: string; reason: string | null;
};
export type VisitTaskReceipt = {
  visitId: string; taskId: string; version: number; operationId: string; recordedAt: string;
};

const id = (v: unknown): v is string => typeof v==='string' && v.length===36 && uuid(v);
const num = (v: unknown, min=1): v is number => Number.isSafeInteger(v) && (v as number)>=min;
const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v==='object' && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length===keys.length && keys.every(k=>Object.hasOwn(v,k));
const txt = (v: unknown, max: number): v is string => typeof v==='string' && v.length<=max && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/u.test(v);
const timestamp = (v: unknown): v is string => typeof v==='string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(Date.parse(v));
const outcomes = ['done','declined','unable','not-required'];
function readValid(v: unknown, visitId: string, revision: number, role: Exclude<OperationalRole,null>, actor: string): v is VisitTaskRead {
  if(!obj(v)||!exact(v,['visitId','visitRevision','plan','additions','results','resultVisibility'])||v.visitId!==visitId||v.visitRevision!==revision
    ||v.resultVisibility!==(role==='staff'?'limited':'complete')
    ||!Array.isArray(v.additions)||v.additions.length>50||!Array.isArray(v.results)||v.results.length>1000) return false;
  const ids=new Set<string>(),categories=new Set<string>(); let count=0;
  if(v.plan!==null && (!Array.isArray(v.plan)||v.plan.length>20||!v.plan.every(c=>{
    if(!obj(c)||!exact(c,['id','label','tasks'])||!id(c.id)||categories.has(c.id)||!txt(c.label,100)||!c.label.trim()||!Array.isArray(c.tasks))return false;
    categories.add(c.id);return c.tasks.every(t=>{if(!obj(t)||!exact(t,['id','text'])||!id(t.id)||ids.has(t.id)||!txt(t.text,500)||!t.text.trim()||++count>100)return false;ids.add(t.id);return true;});
  })))return false;
  if(!v.additions.every((a,i)=>obj(a)&&exact(a,['categoryId','taskId','text','ordinal'])&&id(a.categoryId)&&categories.has(a.categoryId)
    &&id(a.taskId)&&!ids.has(a.taskId)&&txt(a.text,500)&&!!a.text.trim()&&a.ordinal===i+1&&(ids.add(a.taskId),true)))return false;
  const last=new Map<string,number>();return v.results.every(r=>obj(r)&&exact(r,['taskId','version','outcome','observation','actualAt','recordedAt','actorId','reason'])
    &&id(r.taskId)&&ids.has(r.taskId)&&num(r.version)&&r.version<=1000&&r.version>(last.get(r.taskId)||0)
    &&typeof r.outcome==='string'&&outcomes.includes(r.outcome)&&txt(r.observation,3000)&&timestamp(r.actualAt)&&timestamp(r.recordedAt)
    &&id(r.actorId)&&(role!=='staff'||r.actorId.toLowerCase()===actor.toLowerCase())
    &&(r.version===1?r.reason===null:txt(r.reason,500)&&r.reason.trim().length>=3)&&(last.set(r.taskId,r.version),true));
}
export function createVisitTaskClient(fetcher: typeof fetch, actor: string, role: Exclude<OperationalRole,null>) {
  async function request(visitId: string, visitRevision: number, membershipRevision: number, signal: AbortSignal, write?: VisitTaskWrite): Promise<VisitTaskRead|VisitTaskReceipt> {
    if(!id(actor)||!['owner','manager','staff'].includes(role)||!id(visitId)||!num(visitRevision)||!num(membershipRevision))throw new SharedError('invalid_request','Choose a current visit.');
    if(write && (!obj(write)||!exact(write,['visitId','visitRevision','membershipRevision','taskId','expectedVersion','operationId','outcome','observation','actualAt','reason'])||role!=='staff'||write.visitId!==visitId||write.visitRevision!==visitRevision||write.membershipRevision!==membershipRevision
      ||!id(write.taskId)||!id(write.operationId)||!num(write.expectedVersion,0)||write.expectedVersion>999||!outcomes.includes(write.outcome)
      ||!txt(write.observation,3000)||!timestamp(write.actualAt)||(write.expectedVersion===0?write.reason!==null:!txt(write.reason,500)||write.reason.trim().length<3)))
      throw new SharedError('invalid_local_request','Review the exact task result. No request was sent.');
    signal.throwIfAborted();const options=requestOptions(),combined=options.signal?AbortSignal.any([options.signal,signal]):signal;
    const query=write?'visitTasks=1':new URLSearchParams({visitTasks:'1',visitId,visitRevision:String(visitRevision),membershipRevision:String(membershipRevision)}).toString();
    let response: Response;try {response=await fetcher(`/api/admin/operations?${query}`,{...options,signal:combined,method:write?'POST':'GET',headers:{Accept:'application/json','X-ECH-Schedule-Actor':actor,'X-ECH-Schedule-Role':role,...(write?{'Content-Type':'application/json'}:{})},...(write?{body:JSON.stringify(write)}:{})});}
    catch {signal.throwIfAborted();throw new SharedError(write?'write_unconfirmed':'unavailable',write?'Keep the same request; its result is unknown.':'Visit tasks could not be verified.');}
    combined.throwIfAborted();
    if(!write && response.status===409)throw new SharedError('scope_changed','Account access changed. Reopen the workspace to verify current access.');
    if(!write && response.status===412)throw new SharedError('stale_visit','The visit changed. Reload the current visit before reading its task records. Your draft and exact request are retained.');
    if(response.status!==200)throw statusError(response.status,!!write);
    let value: unknown;try {value=await readJson(response,500000);} catch {throw new SharedError(write?'write_unconfirmed':'unavailable',write?'Keep the same request; its result is unknown.':'Visit tasks could not be verified.');}
    combined.throwIfAborted();
    if(!write){if(!readValid(value,visitId,visitRevision,role,actor))throw new SharedError('unavailable','Visit tasks could not be verified.');return value;}
    if(!obj(value)||!exact(value,['visitId','taskId','version','operationId','recordedAt'])||value.visitId!==visitId||value.taskId!==write.taskId
      ||value.version!==write.expectedVersion+1||value.operationId!==write.operationId||!timestamp(value.recordedAt))throw new SharedError('write_unconfirmed','Keep the same request; its result is unknown.');
    return value as VisitTaskReceipt;
  }
  return {load:(visitId:string,revision:number,membershipRevision:number,signal:AbortSignal)=>request(visitId,revision,membershipRevision,signal) as Promise<VisitTaskRead>,
    save:(value:VisitTaskWrite,signal:AbortSignal)=>request(value.visitId,value.visitRevision,value.membershipRevision,signal,value) as Promise<VisitTaskReceipt>};
}
