import { AdminError } from './shared-commands.js';
import { requireOperational } from './permissions.js';
import { scheduleCommandsEnabled,scheduleTaskPlansEnabled } from './operations-schedule-commands.js';
import { scheduleRecurrenceEnabled } from './operations-schedule-recurrence.js';
import { isCreationDraftRequest,isCreationDraftResult,creationDraftEnvelope,creationDraftRequest,sameCreationDraftRequest } from '../operations/schedule-draft-wire.js';
export async function creationDraft(current,raw,env,fetcher) {
 requireOperational(current.member);
 if(!scheduleCommandsEnabled(env))throw new AdminError(405,'disabled','Creation recovery is not enabled here.');
 if(!['owner','manager'].includes(current.member.operational_role))throw new AdminError(403,'forbidden','Current manager scheduling access is unavailable.');
 // Non-reserve actions can only address an existing actor-owned exact envelope
 // in SQL; disabling new planned writes must not strand that reservation.
 const taskPlanOptions={allowTaskPlan:raw?.action!=='reserve'||scheduleTaskPlansEnabled(env)};
 if(!raw||Object.keys(raw).sort().join(',')!=='action,membershipRevision,request,reservedRole'||!['recover','reserve','cancel','resolve','inspect'].includes(raw.action)
   ||!['owner','manager',null].includes(raw.reservedRole)||raw.membershipRevision!==current.member.revision||(raw.action==='recover'?raw.request!==null:!isCreationDraftRequest(raw.request,taskPlanOptions)))
   throw new AdminError(409,'scope_changed','Check current account access and the exact creation request.');
 if(raw.action==='reserve'&&raw.request.command.type==='createSeries'&&!scheduleRecurrenceEnabled(env))throw new AdminError(405,'disabled','Recurring visits are not enabled here.');
 if(raw.action==='reserve'&&raw.request&&raw.request.membershipRevision!==raw.membershipRevision)throw new AdminError(409,'scope_changed','Creation access changed.');
 const unknown=()=>new AdminError(502,'write_unconfirmed','Creation recovery could not be confirmed. Reopen this form to recover the outstanding request before creating another.');
 let response,value;
 try{
  response=await fetcher(current.config.base+'/rest/v1/rpc/ech_operations_creation_draft',{method:'POST',redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(10000),
   headers:{apikey:current.config.key,Authorization:'Bearer '+current.token,'Content-Type':'application/json'},
   body:JSON.stringify({p_action:raw.action,p_role:current.member.operational_role,p_revision:raw.membershipRevision,p_envelope:raw.request?creationDraftEnvelope(raw.request,raw.action==='reserve'?current.member.operational_role:raw.reservedRole||current.member.operational_role):null})});
 }catch{throw unknown();}
 if(response.status===401)throw new AdminError(401,'unauthenticated','Sign in again to recover this request.');
 if(response.status===403)throw new AdminError(403,'forbidden','Current manager scheduling access is unavailable.');
 if(response.status===409)throw new AdminError(409,'schedule_conflict','An outstanding request, source or identity changed. Recover the current request before creating another.');
 if(response.status===400)throw new AdminError(400,'invalid_request','Check the exact creation request.');
 if(response.status!==200||response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')throw unknown();
 try{const reader=response.body?.getReader();if(!reader)throw unknown();let data='',size=0;const decoder=new TextDecoder('utf-8',{fatal:true});
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>32768){await reader.cancel();throw unknown();}data+=decoder.decode(value,{stream:true});}}finally{reader.releaseLock();}
  value=JSON.parse(data+decoder.decode());
  if(!value||Object.keys(value).sort().join(',')!=='draft,schema'||value.draft!==null&&(!value.draft||Object.keys(value.draft).sort().join(',')!=='envelope,result,state'))throw unknown();
  if(value?.draft){
   const envelope=value.draft.envelope,request=creationDraftRequest(envelope),reservedRole=envelope.expectedRole;
   if(!sameCreationDraftRequest(envelope,creationDraftEnvelope(request,reservedRole)))throw unknown();
   value={schema:value.schema,draft:{state:value.draft.state,request,result:value.draft.result,reservedRole}};
  }
 }catch{throw unknown();}
 if(!isCreationDraftResult(value,taskPlanOptions))throw unknown();
 if(raw.request&&!sameCreationDraftRequest(value.draft?.request,raw.request))throw unknown();
 return value;
}
