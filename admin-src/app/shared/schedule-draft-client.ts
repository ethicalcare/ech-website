import { SharedError,assertWire,uuid,type OperationalRole } from './live-model.ts';
import { readJson,requestOptions } from './session.ts';
import { isCreationDraftRequest,isCreationDraftResult,sameCreationDraftRequest } from '../../../lib/operations/schedule-draft-wire.js';
import type { ScheduleCreation } from './schedule-create-client.ts';
import type { ScheduleRecurrence } from './schedule-recurrence-client.ts';
export type CreationDraftRequest=ScheduleCreation|ScheduleRecurrence;
export type CreationDraft={request:CreationDraftRequest;result:any;reservedRole:'owner'|'manager';state:'pending'|'committed'|'cancelled'|'resolved'};
export type CreationTaskPlanOptions={allowTaskPlan?:boolean;taskPlanToken?:string;recoverTaskPlans?:boolean};
// Capture local intent once. A selected token cannot be inferred from a request
// or recovery response, changed through options, or silently omitted later.
// Recovery-only access never selects a token for new planned writes.
export function creationTaskPlanSelection(options?:CreationTaskPlanOptions) {
 const allowTaskPlan=options?.allowTaskPlan===true,taskPlanToken=options?.taskPlanToken,recoverTaskPlans=options?.recoverTaskPlans===true;
 const captured=Object.freeze({allowTaskPlan,taskPlanToken,recoverTaskPlans});
 return Object.freeze({options:captured,matches:(request:CreationDraftRequest)=>Object.hasOwn(request.command,'taskPlanToken')?
   !recoverTaskPlans&&allowTaskPlan&&typeof taskPlanToken==='string'&&/^[0-9a-f]{64}$/.test(taskPlanToken)&&request.command.taskPlanToken===taskPlanToken:taskPlanToken===undefined});
}
export function createScheduleDraftClient(fetcher:typeof fetch,actor:string,role:Exclude<OperationalRole,null>,planOptions?:CreationTaskPlanOptions) {
 const taskPlan=creationTaskPlanSelection(planOptions);
 const recoveryOnly=taskPlan.options.recoverTaskPlans;
 const recoveryOptions=Object.freeze({allowTaskPlan:recoveryOnly||taskPlan.options.allowTaskPlan});
 // This record is private to the current client instance and is populated only
 // by a validated recovery response. Reopening requires recovery again.
 const recoveredPlans=new Map<string,{request:CreationDraftRequest;reservedRole:'owner'|'manager';membershipRevision:number}>();
 let currentRevision:number|null=null;const reservedRoles=new Map<string,'owner'|'manager'>();
 async function send(action:'recover'|'reserve'|'cancel'|'resolve'|'inspect',membershipRevision:number,request:CreationDraftRequest|null,signal:AbortSignal):Promise<CreationDraft|null> {
  signal.throwIfAborted();assertWire(uuid(actor)&&['owner','manager'].includes(role)&&Number.isSafeInteger(membershipRevision)&&membershipRevision>0);
  const recovered=request?recoveredPlans.get(request.operationId):undefined;
  const planned=!!request?.command&&Object.hasOwn(request.command,'taskPlanToken');
  if(request&&(!isCreationDraftRequest(request,recoveryOptions)||(recoveryOnly&&(planned||recovered)?
    action==='reserve'||!recovered||recovered.membershipRevision!==membershipRevision||!sameCreationDraftRequest(recovered.request,request):!taskPlan.matches(request))))
    throw new SharedError('invalid_request','The exact creation request is invalid.');
  const frozen=request?structuredClone(request):null,options=requestOptions(),combined=options.signal?AbortSignal.any([signal,options.signal]):signal;
  const unknown=()=>new SharedError('write_unconfirmed','Creation recovery could not be confirmed. Reopen this form to recover the outstanding request before creating another.');
  let response:Response,value:any;
  try{response=await fetcher('/api/admin/operations?creationDraft=1',{...options,method:'POST',signal:combined,
   headers:{Accept:'application/json','Content-Type':'application/json','X-ECH-Schedule-Actor':actor,'X-ECH-Schedule-Role':role},body:JSON.stringify({action,membershipRevision,request:frozen,reservedRole:frozen?recovered?.reservedRole||reservedRoles.get(frozen.operationId)||null:null})});}
  catch{signal.throwIfAborted();throw unknown();}
  signal.throwIfAborted();if(combined.aborted)throw unknown();
  if(response.status===401)throw new SharedError('unauthenticated','Sign in again to recover this request.');
  try{value=await readJson(response,32768);}catch{throw unknown();}signal.throwIfAborted();if(combined.aborted)throw unknown();
  if(response.status!==200){
   if(['conflict','scope_changed'].includes(value?.error?.code))throw new SharedError('scope_changed','Account access changed. Reopen the workspace.');
   if(response.status===403)throw new SharedError('forbidden','Current manager scheduling access is unavailable.');
   if(response.status===405)throw new SharedError('disabled','Creation recovery is not enabled here.');
   if(response.status===409)throw new SharedError('schedule_conflict','Recover the outstanding request before creating another. A source or identity may have changed.');
   throw unknown();
  }
  if(!isCreationDraftResult(value,recoveryOptions))throw unknown();
  const saved=value.draft,plannedResult=!!saved&&Object.hasOwn(saved.request.command,'taskPlanToken');
  if(saved&&(plannedResult&&recoveryOnly?
    action!=='recover'&&(!recovered||saved.reservedRole!==recovered.reservedRole):!taskPlan.matches(saved.request)))throw unknown();
  if(recoveryOnly&&plannedResult&&(action==='recover'&&!['pending','committed'].includes(saved.state)
    ||action==='cancel'&&saved.state==='pending'||action==='resolve'&&saved.state!=='resolved'))throw unknown();
  if(frozen&&!sameCreationDraftRequest(value.draft?.request,frozen))throw unknown();
  if(recoveryOnly&&action==='recover'){
    if(saved){
      const previous=recoveredPlans.get(saved.request.operationId);
      if(previous&&(!sameCreationDraftRequest(previous.request,saved.request)||previous.reservedRole!==saved.reservedRole))throw unknown();
    }
    recoveredPlans.clear();
    if(plannedResult)recoveredPlans.set(saved.request.operationId,{request:structuredClone(saved.request),reservedRole:saved.reservedRole,membershipRevision});
  }
  currentRevision=membershipRevision;if(value.draft)reservedRoles.set(value.draft.request.operationId,value.draft.reservedRole);
  return value.draft;
 }
 return {
  recover:(revision:number,signal:AbortSignal)=>send('recover',revision,null,signal),
  async reserve(request:CreationDraftRequest,signal:AbortSignal){const result=await send('reserve',request.membershipRevision,request,signal);if(!result||!['pending','committed','resolved'].includes(result.state))throw new SharedError('schedule_conflict','This request was cancelled or resolved. Recover current creation state before continuing.');return result;},
  inspect:(request:CreationDraftRequest,revision:number,signal:AbortSignal)=>send('inspect',revision,request,signal),
  cancel:(request:CreationDraftRequest,signal:AbortSignal)=>send('cancel',currentRevision??request.membershipRevision,request,signal),
  resolve:(request:CreationDraftRequest,signal:AbortSignal)=>send('resolve',currentRevision??request.membershipRevision,request,signal),
 };
}
