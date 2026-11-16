import { AdminError } from './shared-commands.js';
import { requireOperational } from './permissions.js';
import { scheduleCommandsEnabled,scheduleTaskPlansEnabled } from './operations-schedule-commands.js';
import { isScheduleRecurrence, isScheduleRecurrenceResult } from '../operations/schedule-recurrence-wire.js';
export const scheduleRecurrenceEnabled=env=>scheduleCommandsEnabled(env)&&env.ECH_LOCAL_SCHEDULE_RECURRENCE===true;
export function recurrenceAvailability(current,env) {
  requireOperational(current.member);
  if(!['owner','manager'].includes(current.member.operational_role))throw new AdminError(403,'forbidden','Recurring visits require a manager.');
  if(!Number.isSafeInteger(current.member.revision)||current.member.revision<1)throw new AdminError(503,'unavailable','Current scheduling access is unavailable.');
  return {schema:1,enabled:scheduleRecurrenceEnabled(env),membershipRevision:current.member.revision};
}
const unknown=()=>new AdminError(502,'write_unconfirmed','The series result is unknown. Keep and retry the exact request to check its receipt.');
export async function commitScheduleRecurrence(current,raw,env,fetcher) {
  recurrenceAvailability(current,env);
  if(!scheduleRecurrenceEnabled(env))throw new AdminError(405,'disabled','Recurring visits are not enabled here.');
  const taskPlanOptions={allowTaskPlan:scheduleTaskPlansEnabled(env)};
  if(!isScheduleRecurrence(raw,taskPlanOptions))throw new AdminError(400,'invalid_request','Review the source and 2–12 daily or weekly Vancouver occurrences.');
  if(raw.membershipRevision!==current.member.revision)throw new AdminError(409,'scope_changed','Account access changed. Reopen the workspace.');
  let response;
  try{response=await fetcher(current.config.base+'/rest/v1/rpc/ech_operations_series_commit',{
    method:'POST',redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(10_000),
    headers:{apikey:current.config.key,Authorization:'Bearer '+current.token,'Content-Type':'application/json'},
    body:JSON.stringify({p_envelope:{...raw,expectedRole:current.member.operational_role}}),
  });}catch{throw unknown();}
  const failures={400:['invalid_request','Review the Vancouver recurrence fields.'],401:['unauthenticated','Sign in again to check the series result.'],
    403:['forbidden','Current manager scheduling access is unavailable.'],409:['schedule_conflict','The source, access, occurrence identity or dispatch rules conflict. No new series is confirmed. Keep the exact request and reconcile current sources.']};
  if(failures[response.status])throw new AdminError(response.status,...failures[response.status]);
  if(response.status!==200||response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')throw unknown();
  let value;
  try{
    const reader=response.body?.getReader();if(!reader)throw unknown();let data='',size=0;const decoder=new TextDecoder('utf-8',{fatal:true});
    try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>32768){await reader.cancel();throw unknown();}data+=decoder.decode(value,{stream:true});}}
    finally{reader.releaseLock();}value=JSON.parse(data+decoder.decode());
  }catch{throw unknown();}
  if(!isScheduleRecurrenceResult(value,raw,taskPlanOptions))throw unknown();return value;
}
