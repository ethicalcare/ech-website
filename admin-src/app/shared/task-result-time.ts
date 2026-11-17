import { reportLocalTime, reportUtcTime } from './visit-time';

/** Preserve an unchanged saved instant, including precision and historical offset. */
export function taskResultActualTime(local: string, original?: string): string {
  return original && local === reportLocalTime(original) ? original : reportUtcTime(local);
}

/** Compare authorized timestamp values without losing sub-millisecond digits. */
export function sameTaskResultInstant(a: string, b: string): boolean {
  const remainder = (value: string) => (value.match(/\.(\d{1,6})(?:Z|[+-]\d\d:\d\d)$/)?.[1] ?? '').padEnd(6, '0').slice(3);
  return Date.parse(a) === Date.parse(b) && remainder(a) === remainder(b);
}
