export type TimingBoundary={local:string;zone:'America/Vancouver';instant:string;offsetMinutes:number};
export type VisitTiming={visitId:string;visitRevision:number}&({state:'unknown';entries:null}|{state:'recorded';entries:{id:string;label:string;tasks:{id:string;text:string;timing:{kind:'flexible'}|{kind:'suggested';target:{kind:'point';at:TimingBoundary}|{kind:'window';start:TimingBoundary;end:TimingBoundary}}}[]}[]});
import {SharedError,uuid,type OperationalRole} from './live-model.ts';
import {requestOptions,readJson,statusError} from './session.ts';
import {isVisitTiming,VISIT_TIMING_MAX_BYTES} from '../../../lib/operations/visit-timing-wire.js';
// Read-only transport; deliberately not mounted or advertised before timing activation.
export function createVisitTimingClient(fetcher:typeof fetch,actor:string,role:Exclude<OperationalRole,null>){
 return async (visitId:string,revision:number,signal:AbortSignal)=>{
  if(!uuid(actor)||actor.length!==36||!uuid(visitId)||visitId.length!==36||!['owner','manager','staff'].includes(role)||!Number.isSafeInteger(revision)||revision<1)throw new SharedError('invalid_request','Choose a current visit.');
  signal.throwIfAborted();const options=requestOptions(),combined=options.signal?AbortSignal.any([signal,options.signal]):signal;
  let response:Response;try{response=await fetcher('/api/admin/operations?'+new URLSearchParams({visitTiming:visitId,revision:String(revision)}),{...options,method:'GET',signal:combined,headers:{Accept:'application/json','X-ECH-Schedule-Actor':actor,'X-ECH-Schedule-Role':role}});}catch{combined.throwIfAborted();throw new SharedError('unavailable','Visit timing could not be verified.');}
  combined.throwIfAborted();if(response.status!==200)throw statusError(response.status);
  let value:unknown;try{value=await readJson(response,VISIT_TIMING_MAX_BYTES);}catch{signal.throwIfAborted();throw new SharedError('unavailable','Visit timing could not be verified.');}combined.throwIfAborted();if(!isVisitTiming(value,visitId.toLowerCase(),revision))throw new SharedError('invalid_response','Visit timing could not be verified.');return value as VisitTiming;
 };
}
