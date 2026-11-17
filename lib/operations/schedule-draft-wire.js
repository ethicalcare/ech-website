import { isScheduleCreation,isScheduleCreationResult } from './schedule-create-wire.js';
import { isScheduleRecurrence,isScheduleRecurrenceResult } from './schedule-recurrence-wire.js';
export const isCreationDraftRequest=(value,options)=>isScheduleCreation(value,options)||isScheduleRecurrence(value,options);
export function isCreationDraftResult(value,options) {
 return !!value&&Object.keys(value).sort().join(',')==='draft,schema'&&value.schema===1&&(value.draft===null||
   !!value.draft&&Object.keys(value.draft).sort().join(',')==='request,reservedRole,result,state'&&['pending','committed','cancelled','resolved'].includes(value.draft.state)&&['owner','manager'].includes(value.draft.reservedRole)&&isCreationDraftRequest(value.draft.request,options)&&(['committed','resolved'].includes(value.draft.state)?(value.draft.request.command.type==='create'?isScheduleCreationResult(value.draft.result,value.draft.request,options):isScheduleRecurrenceResult(value.draft.result,value.draft.request,options)):value.draft.result===null));
}
export function creationDraftEnvelope(raw,role) {
 return raw.command.type==='createSeries'?{...raw,expectedRole:role}:{schema:2,operationId:raw.operationId,expectedRevision:0,expectedRole:role,
   membershipRevision:raw.membershipRevision,command:{...raw.command,visitId:raw.visitId}};
}
export function creationDraftRequest(envelope) {
 const {expectedRole,...value}=envelope;
 if(value.command?.type==='createSeries')return value;
 const {visitId,...command}=value.command||{};
 return {schema:1,operationId:value.operationId,visitId,visitRevision:value.expectedRevision,membershipRevision:value.membershipRevision,command};
}

export const canonicalCreation=value=>Array.isArray(value)?value.map(canonicalCreation):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonicalCreation(value[key])])):value;
export const sameCreationDraftRequest=(a,b)=>JSON.stringify(canonicalCreation(a))===JSON.stringify(canonicalCreation(b));
