import {addCalendarDays,type CalendarView} from './schedule-calendar';
// Civil-date navigation only; this does not change visits or their instants.
export function adjacentCalendarDate(day:string,view:CalendarView,direction:-1|1):string{
 addCalendarDays(day,0);
 if(direction!==-1&&direction!==1)throw new RangeError('Choose a calendar direction.');
 if(view==='day'||view==='week'){const next=addCalendarDays(day,direction*(view==='day'?1:7));if(!/^\d{4}-\d{2}-\d{2}$/.test(next)||next.startsWith('0000-'))throw new RangeError('Calendar date is outside the supported range.');addCalendarDays(next,0);return next;}
 if(view!=='month')throw new RangeError('Choose a calendar view.');
 const original=Number(day.slice(8,10)),date=new Date(day+'T00:00:00.000Z');
 date.setUTCDate(1);date.setUTCMonth(date.getUTCMonth()+direction);
 if(date.getUTCFullYear()<1||date.getUTCFullYear()>9999)throw new RangeError('Calendar date is outside the supported range.');
 const last=new Date(date);last.setUTCMonth(last.getUTCMonth()+1);last.setUTCDate(0);
 date.setUTCDate(Math.min(original,last.getUTCDate()));
 return date.toISOString().slice(0,10);
}
