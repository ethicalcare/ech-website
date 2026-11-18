import {visitTasksEnabled} from './operations-visit-task-availability.js';
import {hostedOperationsReadsEnabled,hostedOperationsWritesEnabled,productionOperationsEnvironment} from './production-capabilities.js';
import {scheduleCommandsEnabled} from './operations-schedule-commands.js';
import {scheduleRecurrenceEnabled} from './operations-schedule-recurrence.js';
import {visitActionsEnabled} from './operations-visit-actions.js';
// Config discovery only, not worker assignment, database readiness or authority.
export function sessionOperationsFeatures(member,env,{taskResults=false}={}) {
  const operational=member?.active===true && ['owner','manager','staff'].includes(member.operational_role);
  const reads=operational && hostedOperationsReadsEnabled(env);
  const writes=reads && hostedOperationsWritesEnabled(env);
  const effective=productionOperationsEnvironment(env);
  return {reads,
    scheduleCommands:writes && scheduleCommandsEnabled(effective),
    scheduleRecurrence:writes && ['owner','manager'].includes(member?.operational_role) && scheduleRecurrenceEnabled(effective),
    visitActions:writes && visitActionsEnabled(effective),
    ...(env.ECH_FICTIONAL_VISIT_ATTENDANCE===true?{visitAttendance:writes}:{}),
    ...(taskResults?{taskResults:writes && visitTasksEnabled(effective)}:{})};
}
