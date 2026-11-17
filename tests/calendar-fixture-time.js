// Place synthetic appointments in the current displayed week, not at the start
// of the larger calendar cache window (which may be earlier in the month).
import {scheduleDay} from '../admin-src/app/shared/schedule-window.ts';
import {reportUtcTime} from '../admin-src/app/shared/visit-time.ts';
export function fixtureVisitStart(url){const q=new URL(url,'https://fixture.invalid').searchParams;const from=Date.parse(q.get('from')),to=Date.parse(q.get('to'));const today=Date.parse(reportUtcTime(scheduleDay(new Date().toISOString())+'T00:00'));return new Date(Math.max(from,Math.min(today,to-3600000))).toISOString();}
