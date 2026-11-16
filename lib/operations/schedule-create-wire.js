import { isScheduleVisit } from './schedule-command-wire.js';
const shape=(v,keys)=>v && typeof v==='object' && !Array.isArray(v) && Object.keys(v).length===keys.length && keys.every(k=>Object.hasOwn(v,k));
const id=v=>typeof v==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
const revision=v=>Number.isSafeInteger(v) && v>0;
const text=(v,max)=>typeof v==='string' && v.trim()===v && v.length>0 && v.length<=max && !/[\x00-\x1f\x7f]/.test(v);
const stamp=v=>typeof v==='string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) && !v.startsWith('0000-') && Number.isFinite(Date.parse(v)) && new Date(v).toISOString()===v;
const micro=v=>typeof v==='string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/.test(v) && stamp(v.slice(0,23)+'Z');
export function isScheduleSource(v) {
  return shape(v,['clientId','clientName','service','area','instructionsVersion','instructionsSavedAt','confirmedAt','inquiryId','inquiryRevision','sourceToken'])
    && id(v.clientId) && typeof v.clientName==='string' && v.clientName.length<=160 && v.clientName.trim().length>0 && !/[\x00-\x1f\x7f]/.test(v.clientName) && ['Home support','Nursing'].includes(v.service) && text(v.area,100) && v.area.length>=2
    && revision(v.instructionsVersion) && micro(v.instructionsSavedAt) && micro(v.confirmedAt)
    && (v.inquiryId===null && v.inquiryRevision===null || id(v.inquiryId) && revision(v.inquiryRevision))
    && typeof v.sourceToken==='string' && /^[0-9a-f]{64}$/.test(v.sourceToken);
}
export function isScheduleSources(v,membershipRevision) {
  return shape(v,['schema','membershipRevision','sources']) && v.schema===1 && revision(v.membershipRevision)
    && v.membershipRevision===membershipRevision && Array.isArray(v.sources) && v.sources.length<=100 && v.sources.every(isScheduleSource)
    && new Set(v.sources.map(s=>s.clientId)).size===v.sources.length;
}
// The opt-in also accepts legacy unplanned requests; it neither requires a token
// nor verifies a saved plan. Planned callers must retain their selected token
// and compare the exact recovered request before dispatch.
export function isScheduleCreation(v,options) {
  if(!shape(v,['schema','operationId','visitId','visitRevision','membershipRevision','command']) || v.schema!==1 || !id(v.operationId)
    || !id(v.visitId) || v.visitRevision!==0 || !revision(v.membershipRevision))return false;
  const c=v.command;
  const planned=!!c && Object.hasOwn(c,'taskPlanToken');
  if(planned && (options?.allowTaskPlan!==true || c.service!=='Home support' || typeof c.taskPlanToken!=='string' || !/^[0-9a-f]{64}$/.test(c.taskPlanToken)))return false;
  return shape(c,['type','clientId','workerId','service','start','end','source',...(planned?['taskPlanToken']:[])]) && c.type==='create' && id(c.clientId)
    && (c.workerId===null || id(c.workerId)) && ['Home support','Nursing'].includes(c.service) && stamp(c.start) && stamp(c.end) && c.start<c.end
    && isScheduleSource(c.source) && c.source.clientId===c.clientId && c.source.service===c.service;
}
export function isScheduleCreationResult(v,request,options) {
  if(!isScheduleCreation(request,options))return false;
  const c=request.command;
  return shape(v,['visit','receipt']) && isScheduleVisit(v.visit) && v.visit.id===request.visitId && v.visit.revision===1
    && v.visit.clientId===c.clientId && v.visit.workerId===c.workerId && v.visit.service===c.service && v.visit.start===c.start && v.visit.end===c.end
    && v.visit.status===(c.workerId?'Assigned':'Open') && shape(v.receipt,['operationId','expectedRevision','revision'])
    && v.receipt.operationId===request.operationId && v.receipt.expectedRevision===0 && v.receipt.revision===1;
}
