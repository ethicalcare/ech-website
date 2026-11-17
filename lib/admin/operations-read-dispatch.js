import {AdminError} from './shared-commands.js';
import {requireOperational} from './permissions.js';
import {schedule} from './operations.js';
import {scheduleVisit} from './operations-schedule-visit.js';
import {visitDetail} from './operations-visit-detail.js';
import {scheduleCommandAvailability} from './operations-schedule-commands.js';
import {visitActionAvailability} from './operations-visit-actions.js';
import {productionOperationsEnvironment,hostedOperationsWritesEnabled} from './production-capabilities.js';
import {visitReport} from './operations-visit-report.js';

// Caller must authenticate each request using the canonical session verifier.
// Availability is informational only; writes still require their own admission and RPC authorization.
export async function readOperations(current, request, fetcher, env = {}) {
  if(request.method!=='GET')throw new AdminError(405,'invalid_request','Use a read request.');
  if(request.headers.get('x-ech-schedule-actor')!==current.principal.id
    || request.headers.get('x-ech-schedule-role')!==current.principal.operationalRole)
    throw new AdminError(409,'conflict','Account access changed. Reload the workspace.');
  requireOperational(current.member);
  const parameters=new URL(request.url).searchParams;
  if(parameters.has('commands')) {
    if(parameters.size!==1 || parameters.getAll('commands').length!==1 || parameters.get('commands')!=='1')
      throw new AdminError(400,'invalid_request','Choose current visit commands.');
    const effective=productionOperationsEnvironment(env);
    if(!hostedOperationsWritesEnabled(env)) effective.ECH_LOCAL_VISIT_ACTIONS=false;
    return visitActionAvailability(current,effective);
  }
  if(parameters.has('scheduling')) {
    if(parameters.size!==1 || parameters.getAll('scheduling').length!==1 || parameters.get('scheduling')!=='1')
      throw new AdminError(400,'invalid_request','Choose current schedule commands.');
    const effective=productionOperationsEnvironment(env);
    if(!hostedOperationsWritesEnabled(env)) effective.ECH_LOCAL_SCHEDULE_COMMANDS=false;
    return scheduleCommandAvailability(current,effective);
  }
  if(parameters.has('scheduleVisit'))return scheduleVisit(current,parameters,fetcher);
  if(parameters.has('visit'))return visitDetail(current,parameters,fetcher);
  if(parameters.has('report'))return visitReport(current,parameters,fetcher);
  return schedule(current,parameters,fetcher);
}
