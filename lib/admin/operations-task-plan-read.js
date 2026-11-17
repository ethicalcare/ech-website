import {AdminError,UUID} from './shared-commands.js';
import {visitTaskAccess} from './operations-visit-task-availability.js';
import {isTaskPlanRead,TASK_PLAN_READ_MAX_BYTES} from '../operations/task-plan-read-wire.js';
const unavailable=()=>new AdminError(503,'unavailable','Task-plan review could not be verified.');
export async function taskPlanRead(current,params,env,fetcher){
 if(env?.ECH_TASK_PLAN_READ_ENABLED!==true)throw new AdminError(405,'disabled','Task-plan review is not enabled.');
 const {role,revision}=visitTaskAccess(current);
 if(!['owner','manager'].includes(role))throw new AdminError(403,'forbidden','Current manager task-plan access is required.');
 const client=params.get('taskPlan'),rawVersion=params.get('instructionsVersion'),version=Number(rawVersion),rawRevision=params.get('membershipRevision'),requestedRevision=Number(rawRevision);
 if(params.size!==3||['taskPlan','instructionsVersion','membershipRevision'].some(k=>params.getAll(k).length!==1)||!client||client.length!==36||!UUID.test(client)
  ||!Number.isSafeInteger(version)||version<1||String(version)!==rawVersion||!Number.isSafeInteger(requestedRevision)||requestedRevision<1||String(requestedRevision)!==rawRevision)
  throw new AdminError(400,'invalid_request','Choose the exact instruction version for review.');
 if(requestedRevision!==revision)throw new AdminError(409,'conflict','Account access changed. Reload the workspace.');
 let response;
 try{response=await fetcher(current.config.base+'/rest/v1/rpc/ech_operations_task_plan_read',{method:'POST',redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(10000),headers:{apikey:current.config.key,Authorization:'Bearer '+current.token,'Content-Type':'application/json'},body:JSON.stringify({p_role:role,p_revision:revision,p_client:client,p_version:version})});}catch{throw unavailable();}
 if([401,403,409,412].includes(response.status))throw new AdminError(response.status,({401:'unauthenticated',403:'forbidden',409:'conflict',412:'stale_visit'})[response.status],'Task-plan source access changed. Reopen the exact current source.');
 if(response.status!==200||response.redirected||response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json'||!response.body)throw unavailable();
 try{const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let size=0,body='';
 try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>TASK_PLAN_READ_MAX_BYTES){await reader.cancel();throw unavailable();}body+=decoder.decode(part.value,{stream:true});}const value=JSON.parse(body+decoder.decode());if(!isTaskPlanRead(value,client.toLowerCase(),version,revision))throw unavailable();return value;}finally{reader.releaseLock();}}catch{throw unavailable();}
}
