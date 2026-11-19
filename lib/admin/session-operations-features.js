import {visitTasksEnabled} from './operations-visit-task-availability.js';
import {hostedOperationsReadsEnabled,hostedOperationsWritesEnabled,productionOperationsEnvironment} from './production-capabilities.js';
import {scheduleCommandsEnabled,scheduleTaskPlansEnabled} from './operations-schedule-commands.js';
import {scheduleRecurrenceEnabled} from './operations-schedule-recurrence.js';
import {visitActionsEnabled} from './operations-visit-actions.js';
// Config discovery only, not worker assignment, database readiness or authority.
export function sessionOperationsFeatures(member,env,{taskResults=false,taskPlans=false}={}) {
  const operational=member?.active===true && ['owner','manager','staff'].includes(member.operational_role);
  const reads=operational && hostedOperationsReadsEnabled(env);
  const writes=reads && hostedOperationsWritesEnabled(env);
  const effective=productionOperationsEnvironment(env);
  const managerSchedule=writes && ['owner','manager'].includes(member?.operational_role) && scheduleCommandsEnabled(effective);
  return {reads,
    scheduleCommands:writes && scheduleCommandsEnabled(effective),
    scheduleRecurrence:writes && ['owner','manager'].includes(member?.operational_role) && scheduleRecurrenceEnabled(effective),
    visitActions:writes && visitActionsEnabled(effective),
    ...(env.ECH_FICTIONAL_VISIT_ATTENDANCE===true?{visitAttendance:writes}:{}),
    ...(taskPlans?{scheduleTaskPlanPick:managerSchedule && effective.ECH_TASK_PLAN_READ_ENABLED===true && scheduleTaskPlansEnabled(effective),
      scheduleTaskPlanRecover:managerSchedule}:{}),
    ...(taskResults?{taskResults:writes && visitTasksEnabled(effective)}:{})};
}
