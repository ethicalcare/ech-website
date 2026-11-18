// Hosted configuration adapter only. These switches do not establish database
// readiness or grant identity, role, membership, or database permissions.
// Local review callers continue to call handleAdmin directly with their own
// in-process flags; hosted operations and session entry points use this adapter.
const explicitlyEnabled = (env, name) => {
  const descriptor = Object.getOwnPropertyDescriptor(env, name);
  return descriptor && Object.hasOwn(descriptor, 'value') && descriptor.value === 'true';
};

export function productionOperationsEnvironment(env = {}) {
  const source = env && typeof env === 'object' ? env : {};
  const schedule = !!explicitlyEnabled(source, 'ECH_HOSTED_SCHEDULE_COMMANDS');
  return {
    ...source,
    ECH_LOCAL_SCHEDULE_COMMANDS: schedule,
    // Admission only: the SQL planned-create contract must be verified before activation.
    ECH_LOCAL_SCHEDULE_TASK_PLANS: schedule && !!explicitlyEnabled(source, 'ECH_HOSTED_SCHEDULE_TASK_PLANS'),
    ECH_LOCAL_SCHEDULE_RECURRENCE: schedule && !!explicitlyEnabled(source, 'ECH_HOSTED_SCHEDULE_RECURRENCE'),
    ECH_LOCAL_VISIT_ACTIONS: !!explicitlyEnabled(source, 'ECH_HOSTED_VISIT_ACTIONS'),
    ECH_REPORT_AUTHOR_LABELS: explicitlyEnabled(source, 'ECH_HOSTED_REPORT_AUTHOR_LABELS') ? 'true' : 'false',
    ECH_REPORT_NOTE_EVENT_TIME: !!explicitlyEnabled(source, 'ECH_HOSTED_REPORT_NOTE_EVENT_TIME'),
    ECH_VISIT_TASKS_ENABLED: !!explicitlyEnabled(source, 'ECH_HOSTED_VISIT_TASKS'),
    ECH_COMPLETED_TASK_HISTORY_ENABLED: !!explicitlyEnabled(source, 'ECH_HOSTED_COMPLETED_TASK_HISTORY'),
    ECH_TASK_PLAN_READ_ENABLED: !!explicitlyEnabled(source, 'ECH_HOSTED_TASK_PLAN_READ'),
    ECH_OPERATIONAL_TIMING_ENABLED: !!explicitlyEnabled(source, 'ECH_HOSTED_OPERATIONAL_TIMING'),
  };
}

// Independent read admission; does not grant database or application access.
export const hostedOperationsReadsEnabled = env => !!(env && typeof env === 'object'
  && explicitlyEnabled(env, 'ECH_HOSTED_OPERATIONS_READS'));

// Writes require independent explicit admission as well as the read prerequisite.
export const hostedOperationsWritesEnabled = env => hostedOperationsReadsEnabled(env)
  && !!explicitlyEnabled(env, 'ECH_HOSTED_OPERATIONS_WRITES');
