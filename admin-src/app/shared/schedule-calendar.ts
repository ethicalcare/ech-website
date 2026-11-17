import {reportUtcTime} from './visit-time.ts';
import type {ScheduleVisit} from './schedule-client';
export type CalendarView='day'|'week'|'month';
export function addCalendarDays(day:string,count:number):string{
 const date=new Date(day+'T00:00:00.000Z');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==day)throw new RangeError('Choose a valid date.');
 return new Date(date.getTime()+count*86400000).toISOString().slice(0,10);
}
export function calendarDays(day:string,view:CalendarView):string[]{
 addCalendarDays(day,0);const first=view==='month'?day.slice(0,7)+'-01':day;
 const count=view==='day'?1:view==='week'?7:new Date(Date.UTC(Number(day.slice(0,4)),Number(day.slice(5,7)),0)).getUTCDate();
 return Array.from({length:count},(_,index)=>addCalendarDays(first,index));
}
// One bounded authorized read covers all three views without replacing a dirty
// selected visit merely because the display mode changes. Maximum 42 civil days.
export function calendarReadWindow(day:string){addCalendarDays(day,0);const first=day.slice(0,7)+'-01';return {from:reportUtcTime(first+'T00:00'),to:reportUtcTime(addCalendarDays(first,42)+'T00:00')};}
export function visitsOnDay(visits:readonly ScheduleVisit[],day:string):ScheduleVisit[]{
 const from=reportUtcTime(day+'T00:00'),to=reportUtcTime(addCalendarDays(day,1)+'T00:00');
 return visits.filter(visit=>visit.start<to&&visit.end>from).sort((a,b)=>a.start.localeCompare(b.start)||a.end.localeCompare(b.end)||a.id.localeCompare(b.id));
}

export const calendarWeekdays=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'] as const;
export function calendarWeekday(day:string):number{addCalendarDays(day,0);return new Date(day+'T00:00:00.000Z').getUTCDay();}

export type CalendarCoverage='full'|'day'|'week';
export function focusedCalendarWindow(day:string,coverage:CalendarCoverage){if(coverage==='full')return calendarReadWindow(day);return {from:reportUtcTime(addCalendarDays(day,0)+'T00:00'),to:reportUtcTime(addCalendarDays(day,coverage==='day'?1:7)+'T00:00')};}
