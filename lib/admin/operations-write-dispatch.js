import {visitAttendance} from './operations-visit-attendance.js';
import {visitTasks} from './operations-visit-tasks.js';
import {AdminError} from './shared-commands.js';
import {requireOperational} from './permissions.js';
import {hostedOperationsWritesEnabled,productionOperationsEnvironment} from './production-capabilities.js';
import {commitScheduleCommand} from './operations-schedule-commands.js';
import {commitScheduleRecurrence} from './operations-schedule-recurrence.js';
import {creationDraft} from './operations-creation-draft.js';
import {commitVisitAction} from './operations-visit-actions.js';
function selector(request) {
  const p=new URL(request.url).searchParams;
  if(p.size===1 && p.get('attendance')==='1')return 'attendance';
  if(p.size===0)return 'visit';
  if(p.size===1 && p.get('scheduling')==='1')return 'schedule';
  if(p.size===1 && p.get('scheduleRecurrence')==='1')return 'recurrence';
  if(p.size===1 && p.get('creationDraft')==='1')return 'draft';
  if(p.size===1 && p.get('visitTasks')==='1')return 'tasks';
  throw new AdminError(400,'invalid_request','Choose one current Operations command.');
}
export function operationsCommandLimit(request) {
  const kind=selector(request);
  return kind==='attendance'?4096:kind==='schedule'?8192:['recurrence','draft','tasks'].includes(kind)?16384:150000;
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
  if(kind==='attendance') {
    if(env.ECH_FICTIONAL_VISIT_ATTENDANCE !== true) throw new AdminError(405,'disabled','Visit attendance is not enabled.');
    if(!body || Object.keys(body).length!==3 || !['check_in','check_out'].includes(body.action))
      throw new AdminError(400,'invalid_request','Choose check-in or check-out.');
    return visitAttendance(current,{visitId:body.visitId,revision:body.revision},body.action,fetcher);
  }
  if(kind==='tasks')return visitTasks(current,'POST',new URL(request.url).searchParams,body,effective,fetcher);
  if(kind==='draft')return creationDraft(current,body,effective,fetcher);
  if(kind==='schedule')return commitScheduleCommand(current,body,effective,fetcher);
  if(kind==='recurrence')return commitScheduleRecurrence(current,body,effective,fetcher);
  return commitVisitAction(current,body,effective,fetcher);
}
