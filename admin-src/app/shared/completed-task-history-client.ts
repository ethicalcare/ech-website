export type CompletedTaskHistory={visitId:string;visitRevision:number;reportRevision:number;resultVisibility:'limited'|'complete';results:{taskId:string;taskLabel:string;version:number;outcome:'done'|'declined'|'unable'|'not-required';observation:string;actualAt:string;recordedAt:string;actorId:string;reason:string|null}[]};
import {SharedError,uuid,type OperationalRole} from './live-model.ts';
import {requestOptions,readJson,statusError} from './session.ts';
import {isCompletedTaskHistory,COMPLETED_TASK_HISTORY_MAX_BYTES} from '../../../lib/operations/completed-task-history-wire.js';
// Read-only completed-history transport; activation requires separate migration and grant review.
export function createCompletedTaskHistoryClient(fetcher:typeof fetch,actor:string,role:Exclude<OperationalRole,null>){
 return async (visitId:string,revision:number,reportRevision:number,signal:AbortSignal)=>{
  if(!uuid(actor)||actor.length!==36||!uuid(visitId)||visitId.length!==36||!['owner','manager','staff'].includes(role)||!Number.isSafeInteger(revision)||revision<1||!Number.isSafeInteger(reportRevision)||reportRevision<1)throw new SharedError('invalid_request','Choose a current visit.');
  signal.throwIfAborted();const options=requestOptions(),combined=options.signal?AbortSignal.any([signal,options.signal]):signal;
  let response:Response;try{response=await fetcher('/api/admin/operations?'+new URLSearchParams({completedTaskHistory:visitId,revision:String(revision),reportRevision:String(reportRevision)}),{...options,method:'GET',signal:combined,headers:{Accept:'application/json','X-ECH-Schedule-Actor':actor,'X-ECH-Schedule-Role':role}});}catch{combined.throwIfAborted();throw new SharedError('unavailable','Completed task history could not be verified.');}
  combined.throwIfAborted();if(response.status!==200)throw statusError(response.status);
  let value:unknown;try{value=await readJson(response,COMPLETED_TASK_HISTORY_MAX_BYTES);}catch{signal.throwIfAborted();throw new SharedError('unavailable','Completed task history could not be verified.');}combined.throwIfAborted();if(!isCompletedTaskHistory(value,visitId.toLowerCase(),revision,reportRevision,role,actor))throw new SharedError('invalid_response','Completed task history could not be verified.');return value as CompletedTaskHistory;
 };
}
