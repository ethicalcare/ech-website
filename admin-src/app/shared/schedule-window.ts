import {reportLocalTime,reportUtcTime} from './visit-time.ts';

// Calendar browsing follows the existing creation/report Vancouver conversion.
// This is a display window, not a clinical-day or worked-time approval rule.
export function scheduleWeek(day:string):{from:string;to:string}{
 if(!/^\d{4}-\d{2}-\d{2}$/.test(day))throw new RangeError('Choose a valid date.');
 const date=new Date(day+'T00:00:00.000Z');
 if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==day)throw new RangeError('Choose a valid date.');
 const end=new Date(date.getTime()+7*86400000).toISOString().slice(0,10);
 return {from:reportUtcTime(day+'T00:00'),to:reportUtcTime(end+'T00:00')};
}
export function scheduleDay(instant:string):string{return reportLocalTime(instant).slice(0,10);}
export function scheduleLabel(instant:string):string{return reportLocalTime(instant).slice(0,16).replace('T',' ')+' Vancouver';}
