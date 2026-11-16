import {AdminError} from './shared-commands.js';
import {requireOperational} from './permissions.js';
import {schedule} from './operations.js';
import {scheduleVisit} from './operations-schedule-visit.js';
import {visitDetail} from './operations-visit-detail.js';
import {visitReport} from './operations-visit-report.js';

// Caller must authenticate each request using the canonical session verifier.
// This dispatcher deliberately has no command, client authoring or task routes.
export async function readOperations(current, request, fetcher) {
  if(request.method!=='GET')throw new AdminError(405,'invalid_request','Use a read request.');
  if(request.headers.get('x-ech-schedule-actor')!==current.principal.id
    || request.headers.get('x-ech-schedule-role')!==current.principal.operationalRole)
    throw new AdminError(409,'conflict','Account access changed. Reload the workspace.');
  requireOperational(current.member);
  const parameters=new URL(request.url).searchParams;
  if(parameters.has('scheduleVisit'))return scheduleVisit(current,parameters,fetcher);
  if(parameters.has('visit'))return visitDetail(current,parameters,fetcher);
  if(parameters.has('report'))return visitReport(current,parameters,fetcher);
  return schedule(current,parameters,fetcher);
}
