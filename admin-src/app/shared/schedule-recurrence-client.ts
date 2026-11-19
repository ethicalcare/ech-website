import { createScheduleDraftClient,creationTaskPlanSelection,type CreationTaskPlanOptions } from './schedule-draft-client.ts';
import { readCreationReview, requireUnchangedCreation } from './schedule-creation-review.ts';
import { SharedError, assertWire, uuid, type OperationalRole } from './live-model.ts';
import { readJson, requestOptions } from './session.ts';
import { createScheduleClient, type ScheduleVisit } from './schedule-client.ts';
import { isScheduleRecurrence, isScheduleRecurrenceResult } from '../../../lib/operations/schedule-recurrence-wire.js';
import { isCreationDraftResult,sameCreationDraftRequest } from '../../../lib/operations/schedule-draft-wire.js';
import type { ScheduleSource } from './schedule-create-client.ts';
export type ScheduleRecurrence={schema:1;operationId:string;membershipRevision:number;command:{type:'createSeries';clientId:string;workerId:string|null;
  service:'Home support'|'Nursing';source:ScheduleSource;taskPlanToken?:string;timeZone:'America/Vancouver';localStart:string;localEnd:string;cadence:'daily'|'weekly';count:number;
  occurrences:{operationId:string;visitId:string;start:string;end:string}[]}};
const unknown=()=>new SharedError('write_unconfirmed','The recurring visits could not be confirmed. Keep and retry the exact request to check its receipt.');
export function createScheduleRecurrenceClient(fetcher:typeof fetch,actor:string,role:Exclude<OperationalRole,null>,suppliedDrafts?:ReturnType<typeof createScheduleDraftClient>,planOptions?:CreationTaskPlanOptions) {
  const taskPlan=creationTaskPlanSelection(planOptions);
  const drafts=suppliedDrafts??createScheduleDraftClient(fetcher,actor,role,taskPlan.options);
  const schedule=createScheduleClient(fetcher,role,actor);
  async function send(signal:AbortSignal,command?:ScheduleRecurrence) {
    signal.throwIfAborted();assertWire(uuid(actor)&&['owner','manager'].includes(role));
    const options=requestOptions(),combined=options.signal?AbortSignal.any([signal,options.signal]):signal;
    const failure=()=>command?unknown():new SharedError('unavailable','Recurring scheduling access could not be verified.');
    const check=()=>{signal.throwIfAborted();if(combined.aborted)throw failure();};
    let response:Response;
    try{response=await fetcher('/api/admin/operations?scheduleRecurrence=1',{...options,method:command?'POST':'GET',signal:combined,
      headers:{Accept:'application/json','X-ECH-Schedule-Actor':actor,'X-ECH-Schedule-Role':role,...(command?{'Content-Type':'application/json'}:{})},
      ...(command?{body:JSON.stringify(command)}:{})});}catch{check();throw failure();}check();
    if(response.status===401)throw new SharedError('unauthenticated','Sign in again to check this request.');
    let value:any;try{value=await readJson(response,32768);}catch{check();throw failure();}check();
    if(response.status!==200){
      if(['scope_changed','conflict'].includes(value?.error?.code))throw new SharedError('scope_changed','Account access changed. Reopen the workspace.');
      const errors:Record<number,[string,string]>={400:['invalid_request','Review the Vancouver recurrence and current source.'],403:['forbidden','Current manager scheduling access is unavailable.'],
        405:['disabled','Recurring visits are not enabled here.'],409:['schedule_conflict','An occurrence, source, access or dispatch rule conflicts. Keep the exact request. Reload and review before preparing another series.']};
      if(errors[response.status])throw new SharedError(...errors[response.status]);throw failure();
    }
    return value;
  }
  return {
    drafts,
    async availability(signal:AbortSignal):Promise<{schema:1;enabled:boolean;membershipRevision:number}>{
      const value=await send(signal);assertWire(value&&Object.keys(value).sort().join(',')==='enabled,membershipRevision,schema'&&value.schema===1&&typeof value.enabled==='boolean'&&Number.isSafeInteger(value.membershipRevision)&&value.membershipRevision>0);return value;
    },
    async reconcile(request:ScheduleRecurrence,signal:AbortSignal,currentRevision=request.membershipRevision) {
      const recovery=taskPlan.options.recoverTaskPlans===true;
      const wire=recovery?{allowTaskPlan:true}:taskPlan.options;
      if(!isScheduleRecurrence(request,wire)||!recovery&&!taskPlan.matches(request))throw new SharedError('invalid_request','The retained recurring request is invalid.');
      const frozen=structuredClone(request),saved=await drafts.inspect(structuredClone(frozen),currentRevision,signal),result=saved?.result;
      if(!saved||!['committed','resolved'].includes(saved.state)||!isCreationDraftResult({schema:1,draft:saved},wire)
        ||!sameCreationDraftRequest(saved.request,frozen))throw unknown();
      return readCreationReview(result.receipt.operationId,result.visits,
        id=>schedule.loadVisit(id,currentRevision,signal),signal);
    },
    async commit(request:ScheduleRecurrence,signal:AbortSignal):Promise<{visits:ScheduleVisit[];operationId:string}>{
      if(!isScheduleRecurrence(request,taskPlan.options)||!taskPlan.matches(request))throw new SharedError('invalid_request','Choose a valid bounded Vancouver recurrence and reviewed source.');
      const frozen=structuredClone(request),reserved=await drafts.reserve(structuredClone(frozen),signal);
      if(!reserved||!['pending','committed','resolved'].includes(reserved.state)||!isCreationDraftResult({schema:1,draft:reserved},taskPlan.options)
        ||!sameCreationDraftRequest(reserved.request,frozen))throw unknown();
      const result=await send(signal,frozen);
      if(!isScheduleRecurrenceResult(result,frozen,taskPlan.options))throw unknown();
      const review=await readCreationReview(result.receipt.operationId,result.visits,
        id=>schedule.loadVisit(id,frozen.membershipRevision,signal),signal);
      requireUnchangedCreation(review);
      return {visits:review.visits.map(row=>row.current),operationId:review.operationId};
    },
  };
}
