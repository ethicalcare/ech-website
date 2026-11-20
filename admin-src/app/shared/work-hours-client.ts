import {SharedError} from './live-model.ts';
import {readJson,requestOptions,statusError} from './session.ts';

export type HoursBinding={visitId:string;visitRevision:number;reportRevision:number;contentRevision:number};
export type HoursDecision='approve'|'return';
export type HoursReceipt={decision:HoursDecision;recordedAt:string};
export type HoursState=HoursBinding&{enabled:boolean;canDecide:boolean;membershipRevision:number;receipt:{decision:HoursDecision;recordedAt?:string}|null};
export type HoursCommand=HoursBinding&{schema:1;membershipRevision:number;operationId:string;decision:HoursDecision;reason?:string};
export type HoursClient=ReturnType<typeof createWorkHoursClient>;
const revision=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>0;
const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u.test(value);
const decision=(value:unknown):value is HoursDecision=>value==='approve'||value==='return';
const date=(value:unknown):value is string=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const object=(value:unknown):Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const invalid=()=>new SharedError('invalid_response','Worked hours could not be verified.');
const matches=(data:Record<string,unknown>,binding:HoursBinding)=>data.schema===1&&
  data.visitId===binding.visitId&&data.visitRevision===binding.visitRevision&&data.reportRevision===binding.reportRevision&&data.contentRevision===binding.contentRevision;

export function createWorkHoursClient(fetcher:typeof fetch,actor:string,role:'owner'|'manager'|'staff'){
 async function request(path:string,signal:AbortSignal,command?:HoursCommand){
  signal.throwIfAborted();
  const options=requestOptions();
  const combined=options.signal?AbortSignal.any([options.signal,signal]):signal;
  const response=await fetcher(path,{...options,signal:combined,method:command?'POST':'GET',
   headers:{Accept:'application/json','X-ECH-Schedule-Actor':actor,'X-ECH-Schedule-Role':role,
    ...(command?{'Content-Type':'application/json'}:{})},...(command?{body:JSON.stringify(command)}:{})});
  combined.throwIfAborted();
  if(!command&&response.status===404)return {schema:1,enabled:false};
  if(response.status!==200)throw statusError(response.status,!!command);
  const data=object(await readJson(response,12000));
  combined.throwIfAborted();
  return data;
 }
 return {
  async read(binding:HoursBinding,signal:AbortSignal):Promise<HoursState|null>{
   const q=new URLSearchParams({workHours:'1',visit:binding.visitId,visitRevision:String(binding.visitRevision),
    reportRevision:String(binding.reportRevision)});
   const data=await request('/api/admin/operations?'+q,signal);
   if(data.schema===1&&data.enabled===false)return null;
   if(!matches(data,binding)||data.enabled!==true||typeof data.canDecide!=='boolean'||!revision(data.membershipRevision))throw invalid();
   const received=object(data.receipt);
   const receipt=data.receipt===null?null:decision(received.decision)&&role==='staff'&&
    Object.keys(received).length===1?{decision:received.decision}:
    decision(received.decision)&&role!=='staff'&&date(received.recordedAt)
     ?{decision:received.decision,recordedAt:received.recordedAt}:undefined;
   if(receipt===undefined||((role==='staff'||receipt!==null)&&data.canDecide))throw invalid();
   return {...binding,enabled:true,canDecide:data.canDecide,membershipRevision:data.membershipRevision,receipt};
  },
  async write(command:HoursCommand,signal:AbortSignal):Promise<HoursReceipt>{
   if(role==='staff'||!uuid(command.operationId)||!revision(command.membershipRevision))throw invalid();
   const data=await request('/api/admin/operations?workHours=1',signal,command);
   if(!matches(data,command)||data.membershipRevision!==command.membershipRevision||data.operationId!==command.operationId||data.decision!==command.decision||!date(data.recordedAt))throw invalid();
   return {decision:command.decision,recordedAt:data.recordedAt};
  },
 };
}
