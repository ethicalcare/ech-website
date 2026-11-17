import {uniqueInstant} from './schedule-recurrence-wire.js';
const shape=(v,keys)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const id=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
const text=(v,max)=>typeof v==='string'&&!!v.trim()&&[...v].length<=max&&!/[\x00-\x1f\x7f-\x9f]/u.test(v);
function boundary(v){
 if(!shape(v,['local','zone','instant','offsetMinutes'])||v.zone!=='America/Vancouver'||typeof v.instant!=='string'||!Number.isInteger(v.offsetMinutes))return false;
 try{return uniqueInstant(v.local)===v.instant&&(Date.parse(v.local+'Z')-Date.parse(v.instant))/60000===v.offsetMinutes;}catch{return false;}
}
function timing(v){
 if(shape(v,['kind'])&&v.kind==='flexible')return true;
 if(!shape(v,['kind','target'])||v.kind!=='suggested')return false;
 const t=v.target;
 return shape(t,['kind','at'])&&t.kind==='point'?boundary(t.at):shape(t,['kind','start','end'])&&t.kind==='window'&&boundary(t.start)&&boundary(t.end)&&t.start.instant<t.end.instant;
}
export const VISIT_TIMING_MAX_BYTES=150000;
// Exact public envelope only; snapshots do not imply clinical deadlines or missed care.
export function isVisitTiming(v,visitId,revision){
 if(!shape(v,['visitId','visitRevision','state','entries'])||v.visitId!==visitId||v.visitRevision!==revision)return false;
 if(v.state==='unknown')return v.entries===null;
 if(v.state!=='recorded'||!Array.isArray(v.entries)||v.entries.length>20)return false;
 const categories=new Set(),tasks=new Set();let count=0;
 return v.entries.every(c=>{
  if(!shape(c,['id','label','tasks'])||!id(c.id)||categories.has(c.id)||!text(c.label,100)||!Array.isArray(c.tasks))return false;
  categories.add(c.id);return c.tasks.every(t=>{if(!shape(t,['id','text','timing'])||!id(t.id)||tasks.has(t.id)||!text(t.text,500)||++count>100||!timing(t.timing))return false;tasks.add(t.id);return true;});
 });
}
