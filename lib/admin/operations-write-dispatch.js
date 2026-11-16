import {AdminError} from './shared-commands.js';
import {requireOperational} from './permissions.js';
import {hostedOperationsWritesEnabled,productionOperationsEnvironment} from './production-capabilities.js';
import {commitScheduleCommand} from './operations-schedule-commands.js';
import {commitScheduleRecurrence} from './operations-schedule-recurrence.js';
import {commitVisitAction} from './operations-visit-actions.js';
function selector(request) {
  const p=new URL(request.url).searchParams;
  if(p.size===0)return 'visit';
  if(p.size===1 && p.get('scheduling')==='1')return 'schedule';
  if(p.size===1 && p.get('scheduleRecurrence')==='1')return 'recurrence';
  throw new AdminError(400,'invalid_request','Choose one current Operations command.');
}
export function operationsCommandLimit(request) {
  const kind=selector(request);
  return kind==='schedule'?8192:kind==='recurrence'?16384:150000;
}
// Canonical session and origin verification occur in handleAdmin. No authority is
// inferred from role alone: RPC must still verify worker assignment/independence.
export async function writeOperations(current,request,body,env,fetcher) {
  if(request.method!=='POST' || !hostedOperationsWritesEnabled(env))
    throw new AdminError(405,'disabled','Operations commands are not enabled.');
  if(request.headers.get('x-ech-schedule-actor')!==current.principal.id
    || request.headers.get('x-ech-schedule-role')!==current.principal.operationalRole)
    throw new AdminError(409,'conflict','Account access changed. Reload the workspace.');
  requireOperational(current.member);
  const kind=selector(request),effective=productionOperationsEnvironment(env);
  if(kind==='schedule')return commitScheduleCommand(current,body,effective,fetcher);
  if(kind==='recurrence')return commitScheduleRecurrence(current,body,effective,fetcher);
  return commitVisitAction(current,body,effective,fetcher);
}
