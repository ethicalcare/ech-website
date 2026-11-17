import { reportLocalTime } from './visit-time';
import type { VisitTaskResult } from './visit-task-client';

// The authorized API accepts database timestamps with up to six fractional
// digits. Date.parse retains only three, so compare the remaining digits too.
const fraction = (instant: string) => (instant.match(/\.(\d{1,6})(?:Z|[+-]\d\d:\d\d)$/)?.[1] ?? '').padEnd(6, '0');
function compareInstants(a: string, b: string): number {
  return Date.parse(a) - Date.parse(b) || Number(fraction(a).slice(3)) - Number(fraction(b).slice(3));
}

export function orderedTaskEvents(results: readonly VisitTaskResult[]): VisitTaskResult[] {
  return [...results].sort((a, b) => compareInstants(a.actualAt, b.actualAt)
    || compareInstants(a.recordedAt, b.recordedAt)
    || a.taskId.localeCompare(b.taskId) || a.version - b.version);
}

export function taskEventLocalTime(instant: string): string {
  // Do not display distinct database event times as the same millisecond.
  const extra = instant.match(/\.\d{3}(\d{1,3})(?:Z|[+-]\d\d:\d\d)$/)?.[1] ?? '';
  return reportLocalTime(instant).replace('T', ' ') + extra;
}
