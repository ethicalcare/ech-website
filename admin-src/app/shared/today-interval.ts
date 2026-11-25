import {reportLocalTime} from './visit-time';
import type {ScheduleVisit} from './schedule-client';
export function todayPhase(visit:Pick<ScheduleVisit,'start'|'end'>,instant:string):string{
 return instant<visit.start?'Later':instant<visit.end?'Active now':'Elapsed';
}
export function todayGroupKey(visit:Pick<ScheduleVisit,'service'|'start'|'end'|'status'>):string{
 return JSON.stringify([visit.service,visit.start,visit.end,visit.status]);
}
export function todayInstantLabel(instant:string):string{
 const local=reportLocalTime(instant);const offset=Math.round((Date.parse(local+'Z')-Date.parse(instant))/60000);
 const sign=offset<0?'-':'+';const minutes=Math.abs(offset);
 return local.slice(0,16).replace('T',' ')+' Vancouver (UTC'+sign+String(Math.floor(minutes/60)).padStart(2,'0')+':'+String(minutes%60).padStart(2,'0')+')';
}
