import { isScheduleCreation, isScheduleCreationResult } from '../operations/schedule-create-wire.js';
import { AdminError } from './shared-commands.js';
import { requireOperational } from './permissions.js';
import { isScheduleCommand, isScheduleCommandResult } from '../operations/schedule-command-wire.js';

// A Boolean supplied by an in-process local adapter only. Strings from deployment
// configuration cannot enable this capability. No database execution is granted.
export const scheduleCommandsEnabled = env => env.ECH_LOCAL_SCHEDULE_COMMANDS === true;
export const scheduleTaskPlansEnabled = env => scheduleCommandsEnabled(env) && env.ECH_LOCAL_SCHEDULE_TASK_PLANS === true;
export function scheduleCommandAvailability(current, env) {
  requireOperational(current.member);
  if (!Number.isSafeInteger(current.member.revision) || current.member.revision < 1)
    throw new AdminError(503,'unavailable','Schedule command access could not be verified.');
  return {schema:1,enabled:scheduleCommandsEnabled(env),membershipRevision:current.member.revision};
}
const unknown = () => new AdminError(502,'write_unconfirmed','The result is unknown. Keep the draft and retry the exact request to check its receipt.');
export async function commitScheduleCommand(current, raw, env, fetcher) {
  requireOperational(current.member);
  if (!scheduleCommandsEnabled(env)) throw new AdminError(405,'disabled','Schedule changes are not enabled here.');
  const taskPlanOptions={allowTaskPlan:scheduleTaskPlansEnabled(env)};
  if (!isScheduleCommand(raw) && !isScheduleCreation(raw,taskPlanOptions)) throw new AdminError(400,'invalid_request','Check the schedule interval, selected worker and operational reason of 3–500 characters.');
  if (raw.membershipRevision!==current.member.revision) throw new AdminError(409,'scope_changed','Account access changed. Reopen the workspace.');
  if (raw.command.type!=='confirm' && !['owner','manager'].includes(current.member.operational_role))
    throw new AdminError(403,'forbidden','Schedule changes require a manager.');
  const envelope={schema:2,operationId:raw.operationId,expectedRevision:raw.visitRevision,
    expectedRole:current.member.operational_role,membershipRevision:raw.membershipRevision,
    command:{...raw.command,visitId:raw.visitId}};
  let response;
  try {
    response=await fetcher(current.config.base+'/rest/v1/rpc/ech_operations_visit_commit',{
      method:'POST',redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(10_000),
      headers:{apikey:current.config.key,Authorization:'Bearer '+current.token,'Content-Type':'application/json'},body:JSON.stringify({p_envelope:envelope}),
    });
  } catch {throw unknown();}
  const failures={400:['invalid_request','The request was rejected. Check the schedule fields.'],401:['unauthenticated','Sign in again to check the result.'],
    403:['forbidden','This request is not allowed. Managers change schedules; only the assigned worker can confirm.'],
    409:['schedule_conflict','The visit, access, readiness, qualification, availability or travel rules conflict. Keep the draft. Reload before preparing a new request.'],
    412:['stale_visit','The visit changed. Keep the draft and reload before preparing a new request.']};
  if (failures[response.status]) throw new AdminError(response.status,...failures[response.status]);
  if (response.status!==200 || response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json') throw unknown();
  let value;
  try {
    const reader=response.body?.getReader();if(!reader)throw unknown();
    let data='',size=0;const decoder=new TextDecoder('utf-8',{fatal:true});
    try {for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>16_384){await reader.cancel();throw unknown();}data+=decoder.decode(value,{stream:true});}}
    finally {reader.releaseLock();}
    value=JSON.parse(data+decoder.decode());
  } catch {throw unknown();}
  if(!(raw.command.type==='create'?isScheduleCreationResult(value,raw,taskPlanOptions):isScheduleCommandResult(value,raw)))throw unknown();
  return value;
}
