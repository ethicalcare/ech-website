import { isScheduleCreation, isScheduleCreationResult } from './schedule-create-wire.js';
const shape=(v,keys)=>v && typeof v==='object' && !Array.isArray(v) && Object.keys(v).length===keys.length && keys.every(k=>Object.hasOwn(v,k));
const id=v=>typeof v==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
const transition=Date.parse('2026-03-08T10:00:00.000Z');
const formatter=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Vancouver',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
function civil(instant) {
  const date=new Date(instant);
  return instant>=transition?new Date(instant-7*3600000).toISOString().slice(0,-1):formatter.format(date).replace(' ','T')+'.'+String(date.getUTCMilliseconds()).padStart(3,'0');
}
function anchor(local) {
  if(typeof local!=='string'||!/^20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}$/.test(local))throw new RangeError('Use a Vancouver time between 2000 and 2099.');
  const value=Date.parse(local+'Z');
  if(!Number.isFinite(value)||new Date(value).toISOString().slice(0,-1)!==local)throw new RangeError('Enter a valid Vancouver date and time.');
  return value;
}
export function uniqueInstant(local) {
  const value=anchor(local),candidates=[7,8].map(h=>value+h*3600000).filter(t=>civil(t)===local);
  if(candidates.length!==1)throw new RangeError(candidates.length?'This Vancouver time occurs twice. Choose a time outside the repeated hour.':'This Vancouver time does not exist. Check the clock change.');
  return new Date(candidates[0]).toISOString();
}
// Bounded calendar-day recurrence, independent of device timezone or fixed UTC duration.
export function recurrenceIntervals(localStart,localEnd,cadence,count) {
  if(!['daily','weekly'].includes(cadence)||!Number.isInteger(count)||count<2||count>12)throw new RangeError('Choose daily or weekly recurrence with 2–12 visits.');
  const start=anchor(localStart),end=anchor(localEnd);
  if(start>=end)throw new RangeError('The visit end must be after its start.');
  return Array.from({length:count},(_,i)=>{
    const shift=i*(cadence==='daily'?1:7)*86400000;
    const a=new Date(start+shift).toISOString().slice(0,-1),b=new Date(end+shift).toISOString().slice(0,-1);
    const result={start:uniqueInstant(a),end:uniqueInstant(b)};
    if(result.start>=result.end)throw new RangeError('The visit end must be after its start.');
    return result;
  });
}
export function occurrenceCreation(request,occurrence) {
  const c=request.command;
  return {schema:1,operationId:occurrence.operationId,visitId:occurrence.visitId,visitRevision:0,membershipRevision:request.membershipRevision,
    command:{type:'create',clientId:c.clientId,workerId:c.workerId,service:c.service,start:occurrence.start,end:occurrence.end,source:c.source,
      ...(Object.hasOwn(c,'taskPlanToken')?{taskPlanToken:c.taskPlanToken}:{})}};
}
export function isScheduleRecurrence(v,options) {
  if(!shape(v,['schema','operationId','membershipRevision','command'])||v.schema!==1||!id(v.operationId)||!Number.isSafeInteger(v.membershipRevision)||v.membershipRevision<1)return false;
  const c=v.command;
  const planned=!!c && Object.hasOwn(c,'taskPlanToken');
  if(planned && (options?.allowTaskPlan!==true || c.service!=='Home support' || typeof c.taskPlanToken!=='string' || !/^[0-9a-f]{64}$/.test(c.taskPlanToken)))return false;
  if(!shape(c,['type','clientId','workerId','service','source','timeZone','localStart','localEnd','cadence','count','occurrences',...(planned?['taskPlanToken']:[])])||c.type!=='createSeries'||c.timeZone!=='America/Vancouver'||!Array.isArray(c.occurrences)||c.occurrences.length!==c.count)return false;
  let intervals;try{intervals=recurrenceIntervals(c.localStart,c.localEnd,c.cadence,c.count);}catch{return false;}
  return new Set([v.operationId,...c.occurrences.map(o=>o?.operationId)]).size===c.count+1 && new Set(c.occurrences.map(o=>o?.visitId)).size===c.count
    && c.occurrences.every((o,i)=>shape(o,['operationId','visitId','start','end'])&&id(o.operationId)&&id(o.visitId)&&o.start===intervals[i].start&&o.end===intervals[i].end&&isScheduleCreation(occurrenceCreation(v,o),options));
}
export function isScheduleRecurrenceResult(v,request,options) {
  if(!isScheduleRecurrence(request,options))return false;
  return shape(v,['visits','receipt'])&&Array.isArray(v.visits)&&v.visits.length===request.command.count
    && shape(v.receipt,['operationId','count'])&&v.receipt.operationId===request.operationId&&v.receipt.count===request.command.count
    && v.visits.every((visit,i)=>isScheduleCreationResult({visit,receipt:{operationId:request.command.occurrences[i].operationId,expectedRevision:0,revision:1}},occurrenceCreation(request,request.command.occurrences[i]),options));
}
