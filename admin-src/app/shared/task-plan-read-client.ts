import {SharedError,uuid,type OperationalRole} from './live-model.ts';
import {requestOptions,readJson,statusError} from './session.ts';
import {isTaskPlanRead,TASK_PLAN_READ_MAX_BYTES} from '../../../lib/operations/task-plan-read-wire.js';
// Private read transport only. Not mounted, and does not enable planned creation.
export function createTaskPlanReadClient(fetcher:typeof fetch,actor:string,role:Exclude<OperationalRole,null>){
 return async(clientId:string,instructionsVersion:number,membershipRevision:number,signal:AbortSignal)=>{
  if(!uuid(actor)||actor.length!==36||!uuid(clientId)||clientId.length!==36||!['owner','manager'].includes(role)||![instructionsVersion,membershipRevision].every(v=>Number.isSafeInteger(v)&&v>0))throw new SharedError('invalid_request','Choose an exact current instruction version.');
  signal.throwIfAborted();const options=requestOptions(),combined=options.signal?AbortSignal.any([signal,options.signal]):signal;
  let response:Response;try{response=await fetcher('/api/admin/operations?'+new URLSearchParams({taskPlan:clientId,instructionsVersion:String(instructionsVersion),membershipRevision:String(membershipRevision)}),{...options,method:'GET',signal:combined,headers:{Accept:'application/json','X-ECH-Schedule-Actor':actor,'X-ECH-Schedule-Role':role}});}catch{combined.throwIfAborted();throw new SharedError('unavailable','Task-plan review could not be verified.');}
  combined.throwIfAborted();if(response.status!==200)throw statusError(response.status);
  let value:unknown;try{value=await readJson(response,TASK_PLAN_READ_MAX_BYTES);}catch{signal.throwIfAborted();throw new SharedError('unavailable','Task-plan review could not be verified.');}
  combined.throwIfAborted();if(!isTaskPlanRead(value,clientId.toLowerCase(),instructionsVersion,membershipRevision))throw new SharedError('invalid_response','Task-plan review could not be verified.');return value;
 };
}
