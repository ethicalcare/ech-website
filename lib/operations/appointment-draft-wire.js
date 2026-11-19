import { isScheduleCreation } from './schedule-create-wire.js';

// Draft-shape foundation only. Not an RPC, authorization decision, dispatch
// check, stored appointment, attendance record or payroll/care-hours input.
// Existing care requests keep their exact source/readiness/task-plan contract.
export const appointmentKinds = Object.freeze(['Care visit','Assessment','Referral partner meeting','Staff meeting']);
const shape=(v,keys)=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const id=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
const instant=v=>typeof v==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v)&&!v.startsWith('0000-')&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const text=(v,max,empty=false)=>typeof v==='string'&&v.trim()===v&&(empty||v.length>0)&&v.length<=max&&!/[\x00-\x1f\x7f]/.test(v);
const common=['kind','workerId','start','end','notes'];

/** Canonical UTC input, converted by the existing Vancouver entry helpers.
 * Non-care limits bound draft payloads, not service duration or clinical policy.
 * A valid assessment still requires separate qualification/permission checks.
 * No non-care kind can be sent to the existing care creation/report endpoints.
 */
export function isAppointmentDraft(value,careOptions) {
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  if(value.kind==='Care visit')return shape(value,['kind','request'])&&Boolean(isScheduleCreation(value.request,careOptions));
  if(value.kind==='Assessment') {
    if(!shape(value,[...common,'clientId','purpose'])||!id(value.clientId)||!['Clinical assessment','Management introduction'].includes(value.purpose))return false;
  } else if(value.kind==='Referral partner meeting') {
    if(!shape(value,[...common,'organization','location'])||!text(value.organization,160)||!text(value.location,500))return false;
  } else if(value.kind==='Staff meeting') {
    if(!shape(value,[...common,'title','location'])||!text(value.title,160)||!text(value.location,500))return false;
  } else return false;
  return (value.workerId===null||id(value.workerId))&&instant(value.start)&&instant(value.end)&&value.start<value.end&&text(value.notes,2000,true);
}
