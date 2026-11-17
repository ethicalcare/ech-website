import { AdminError, UUID } from './shared-commands.js';
import { requireOperational } from './permissions.js';

// Boolean in-process opt-in only; hosted string values require the canonical adapter.
export const visitTasksEnabled = env => env?.ECH_VISIT_TASKS_ENABLED===true;
export function visitTaskAccess(current) {
  requireOperational(current.member);
  const {operational_role:role,revision,user_id:actor}=current.member;
  if(current.member.active!==true || typeof actor!=='string' || actor.length!==36 || !UUID.test(actor)
    || current.principal?.id!==actor || current.principal?.operationalRole!==role)
    throw new AdminError(403,'forbidden','Visit task access is unavailable.');
  if(!Number.isSafeInteger(revision) || revision<1)
    throw new AdminError(503,'unavailable','Visit task access could not be verified.');
  return {role,revision,actor};
}
export function visitTaskAvailability(current, env, {timing=false}={}) {
  const {revision}=visitTaskAccess(current);
  return {schema:1,enabled:visitTasksEnabled(env),membershipRevision:revision,...(timing?{timing:visitTasksEnabled(env)&&env?.ECH_OPERATIONAL_TIMING_ENABLED===true}:{})};
}
