import {AdminError,UUID} from './shared-commands.js';
import {visitTaskAccess} from './operations-visit-task-availability.js';
import {isCompletedTaskHistory,COMPLETED_TASK_HISTORY_MAX_BYTES} from '../operations/completed-task-history-wire.js';
const unavailable=()=>new AdminError(503,'unavailable','Completed task history could not be verified.');
export async function completedTaskHistory(current,params,env,fetcher){
 if(env?.ECH_COMPLETED_TASK_HISTORY_ENABLED!==true)throw new AdminError(405,'disabled','Completed task history is not enabled.');
 const {role,revision:membershipRevision}=visitTaskAccess(current);
 const visit=params.get('completedTaskHistory'),raw=params.get('revision'),revision=Number(raw),reportRaw=params.get('reportRevision'),reportRevision=Number(reportRaw);
 if(params.size!==3||params.getAll('completedTaskHistory').length!==1||params.getAll('revision').length!==1||params.getAll('reportRevision').length!==1||!Number.isSafeInteger(reportRevision)||reportRevision<1||String(reportRevision)!==reportRaw||!visit||visit.length!==36||!UUID.test(visit)||!Number.isSafeInteger(revision)||revision<1||String(revision)!==raw)
  throw new AdminError(400,'invalid_request','Choose a current visit.');
 let response;
 try{response=await fetcher(current.config.base+'/rest/v1/rpc/ech_operations_completed_task_history',{method:'POST',redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(10000),headers:{apikey:current.config.key,Authorization:'Bearer '+current.token,'Content-Type':'application/json'},body:JSON.stringify({p_visit:visit,p_visit_revision:revision,p_role:role,p_membership_revision:membershipRevision,p_report_revision:reportRevision})});}catch{throw unavailable();}
 if([401,403,409,412].includes(response.status))throw new AdminError(response.status,({401:'unauthenticated',403:'forbidden',409:'conflict',412:'stale_visit'})[response.status],'Completed task history access changed. Reopen the current visit.');
 if(response.status!==200||response.redirected||response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json'||!response.body)throw unavailable();
 try{const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let size=0,body='';
 try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>COMPLETED_TASK_HISTORY_MAX_BYTES){await reader.cancel();throw unavailable();}body+=decoder.decode(part.value,{stream:true});}const value=JSON.parse(body+decoder.decode());if(!isCompletedTaskHistory(value,visit.toLowerCase(),revision,reportRevision,role,current.principal.id))throw unavailable();return value;}finally{reader.releaseLock();}}catch{throw unavailable();}
}
