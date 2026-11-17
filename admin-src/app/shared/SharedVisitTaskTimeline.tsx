import { activityDayGroups } from './activity-day-groups';
import { orderedTaskEvents, taskEventLocalTime } from './visit-task-timeline';
import type { VisitTaskOutcome, VisitTaskRead } from './visit-task-client';

const outcomes: Record<VisitTaskOutcome,string> = {
  done: 'Done', declined: 'Declined', unable: 'Unable', 'not-required': 'Not required',
};

/** Displays only task-result events already returned by the authorized visit read. */
export function SharedVisitTaskTimeline({snapshot}:{snapshot:VisitTaskRead}) {
  const labels = new Map<string,string>();
  for (const category of snapshot.plan ?? []) for (const task of category.tasks) labels.set(task.id,task.text);
  for (const addition of snapshot.additions) labels.set(addition.taskId,addition.text);
  const latestVisible=new Map<string,number>();
  for (const result of snapshot.results) latestVisible.set(result.taskId,Math.max(latestVisible.get(result.taskId) ?? 0,result.version));
  // Event time is the explicit chronology; recorded time is a stable tie-breaker.
  // Each original and correction remains an individual version.
  const events=orderedTaskEvents(snapshot.results);
  return <section aria-label="Visit task activity">
    <h3>Visit task activity</h3>
    <p>Ordered by actual event time. Recorded time is shown separately. Task activity does not approve worked time.</p>
    {snapshot.resultVisibility==='limited' && <p>Only results visible to this account are shown; this is not a complete visit history.</p>}
    {events.length===0 ? <p>No visible task-result events are available. This does not establish that care was missed.</p> :
      activityDayGroups(events,event=>event.actualAt).map(group=><section key={group.day} aria-label={`Task activity on ${group.day} Vancouver`}><h4>{group.day} · Vancouver</h4><ol>{group.events.map(event=><li key={`${event.taskId}:${event.version}`}>
        <h5>{labels.get(event.taskId) ?? 'Task unavailable'} · {outcomes[event.outcome]}</h5>
        <p>{event.version===latestVisible.get(event.taskId) ? 'Latest visible version' : 'Earlier visible version · superseded'}</p>
        <dl>
          <dt>Actual event time · Vancouver</dt><dd><time dateTime={event.actualAt}>{taskEventLocalTime(event.actualAt)}</time></dd>
          <dt>Recorded at · Vancouver</dt><dd><time dateTime={event.recordedAt}>{taskEventLocalTime(event.recordedAt)}</time></dd>
          <dt>Author identifier</dt><dd>{event.actorId}</dd>
          <dt>Version</dt><dd>{event.version===1 ? 'Original' : `Correction ${event.version-1}`}</dd>
          <dt>Observation</dt><dd>{event.observation || 'No observation recorded.'}</dd>
          {event.reason && <><dt>Correction reason</dt><dd>{event.reason}</dd></>}
        </dl>
      </li>)}</ol></section>)}
  </section>;
}
