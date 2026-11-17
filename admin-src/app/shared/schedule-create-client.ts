import { createScheduleDraftClient,creationTaskPlanSelection,type CreationTaskPlanOptions } from './schedule-draft-client.ts';
import { readCreationReview, requireUnchangedCreation } from './schedule-creation-review.ts';
import { createScheduleRecurrenceClient } from './schedule-recurrence-client.ts';
import { SharedError, assertWire, uuid, type OperationalRole } from './live-model.ts';
import { readJson, requestOptions } from './session.ts';
import { createScheduleClient, type ScheduleVisit } from './schedule-client.ts';
import { createScheduleCommandClient } from './schedule-command-client.ts';
import { isScheduleCreation, isScheduleCreationResult, isScheduleSources } from '../../../lib/operations/schedule-create-wire.js';
export type ScheduleSource={clientId:string;clientName:string;service:'Home support'|'Nursing';area:string;instructionsVersion:number;
  instructionsSavedAt:string;confirmedAt:string;inquiryId:string|null;inquiryRevision:number|null;sourceToken:string};
export type ScheduleCreation={schema:1;operationId:string;visitId:string;visitRevision:0;membershipRevision:number;
  command:{type:'create';clientId:string;workerId:string|null;service:'Home support'|'Nursing';start:string;end:string;source:ScheduleSource;taskPlanToken?:string}};
export type ScheduleCreateClient=ReturnType<typeof createScheduleCreateClient>;
const unknown=()=>new SharedError('write_unconfirmed','The new visit could not be confirmed. Your draft and exact request are retained. Retry the exact request to check its receipt.');
export function createScheduleCreateClient(fetcher:typeof fetch,actor:string,role:Exclude<OperationalRole,null>,planOptions?:CreationTaskPlanOptions) {
  const taskPlan=creationTaskPlanSelection(planOptions);
  const drafts=createScheduleDraftClient(fetcher,actor,role,taskPlan.options);
  const scheduling=createScheduleCommandClient(fetcher,actor,role),schedule=createScheduleClient(fetcher,role,actor);
  async function send(path:string,signal:AbortSignal,command?:ScheduleCreation) {
    signal.throwIfAborted();assertWire(uuid(actor) && actor.length===36 && ['owner','manager'].includes(role));
    const unverified=()=>command?unknown():new SharedError('unavailable','Reviewed scheduling sources could not be verified. Reload before creating a visit.');
    const options=requestOptions(),combined=options.signal?AbortSignal.any([signal,options.signal]):signal;
    const check=()=>{signal.throwIfAborted();if(combined.aborted)throw unverified();};
    let response:Response;
    try {response=await fetcher(path,{...options,method:command?'POST':'GET',signal:combined,
      headers:{Accept:'application/json','X-ECH-Schedule-Actor':actor,'X-ECH-Schedule-Role':role,...(command?{'Content-Type':'application/json'}:{})},
      ...(command?{body:JSON.stringify(command)}:{})});}catch{check();throw unverified();}
    check();
    if(response.status===401)throw new SharedError('unauthenticated','Sign in again before checking this request.');
    let result:any;try{result=await readJson(response,command?16_384:100_000);}catch{check();throw unverified();}check();
    if(response.status!==200){
      if(['scope_changed','conflict'].includes(result?.error?.code))throw new SharedError('scope_changed','Account access changed. Reopen the workspace.');
      const failures:Record<number,[string,string]>={400:['invalid_request','Review the selected source and Vancouver visit times.'],
        403:['forbidden','Current manager scheduling access is unavailable.'],405:['disabled','New visits are not enabled here.'],
        409:['schedule_conflict','The source, access, visit or current dispatch rules changed or conflict. Your draft is retained. Reload sources before preparing a new request.']};
      if(failures[response.status])throw new SharedError(...failures[response.status]);throw unverified();
    }
    return result;
  }
  return {
    drafts,
    availability:scheduling.availability.bind(scheduling),
    recurrence:createScheduleRecurrenceClient(fetcher,actor,role,drafts,taskPlan.options),
    async sources(membershipRevision:number,signal:AbortSignal):Promise<ScheduleSource[]> {
      assertWire(Number.isSafeInteger(membershipRevision) && membershipRevision>0);
      const value=await send(`/api/admin/operations?scheduleSources=1&membershipRevision=${membershipRevision}`,signal);
      assertWire(isScheduleSources(value,membershipRevision));return value.sources;
    },
    async reconcile(command:ScheduleCreation,signal:AbortSignal,currentRevision=command.membershipRevision) {
      if(!isScheduleCreation(command,taskPlan.options)||!taskPlan.matches(command))throw new SharedError('invalid_request','The retained creation request is invalid.');
      const frozen=structuredClone(command),saved=await drafts.inspect(frozen,currentRevision,signal),result=saved?.result;
      if(!isScheduleCreationResult(result,frozen,taskPlan.options))throw unknown();
      return readCreationReview(result.receipt.operationId,[result.visit],
        id=>schedule.loadVisit(id,currentRevision,signal),signal);
    },
    async commit(command:ScheduleCreation,signal:AbortSignal):Promise<{visit:ScheduleVisit;operationId:string}> {
      if(!isScheduleCreation(command,taskPlan.options)||!taskPlan.matches(command))throw new SharedError('invalid_request','Choose a current reviewed source and valid visit times.');
      const frozen=JSON.parse(JSON.stringify(command)) as ScheduleCreation;
      await drafts.reserve(frozen,signal);
      const result=await send('/api/admin/operations?scheduling=1',signal,frozen);
      if(!isScheduleCreationResult(result,frozen,taskPlan.options))throw unknown();
      const review=await readCreationReview(result.receipt.operationId,[result.visit],
        id=>schedule.loadVisit(id,frozen.membershipRevision,signal),signal);
      requireUnchangedCreation(review);
      return {visit:review.visits[0].current,operationId:review.operationId};
    },
  };
}
