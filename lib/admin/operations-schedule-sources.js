import { AdminError } from './shared-commands.js';
import { requireOperational } from './permissions.js';
import { isScheduleSources } from '../operations/schedule-create-wire.js';
const unavailable=()=>new AdminError(503,'unavailable','Reviewed scheduling sources could not be verified.');
export async function scheduleSources(current,params,fetcher) {
  requireOperational(current.member);
  if(!['owner','manager'].includes(current.member.operational_role))throw new AdminError(403,'forbidden','Reviewed scheduling sources require a manager.');
  const revision=Number(params.get('membershipRevision'));
  if(params.size!==2 || params.getAll('scheduleSources').length!==1 || params.get('scheduleSources')!=='1'
    || !Number.isSafeInteger(revision) || revision<1 || String(revision)!==params.get('membershipRevision'))
    throw new AdminError(400,'invalid_request','Choose current reviewed scheduling sources.');
  if(revision!==current.member.revision)throw new AdminError(409,'scope_changed','Account access changed. Reopen the workspace.');
  let response;
  try {response=await fetcher(current.config.base+'/rest/v1/rpc/ech_operations_schedule_sources',{
    method:'POST',redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(10_000),
    headers:{apikey:current.config.key,Authorization:'Bearer '+current.token,'Content-Type':'application/json'},
    body:JSON.stringify({p_expected_role:current.member.operational_role,p_membership_revision:revision}),
  });}catch{throw unavailable();}
  if(response.status===401)throw new AdminError(401,'unauthenticated','Sign in to continue.');
  if(response.status===403)throw new AdminError(403,'forbidden','Reviewed scheduling sources are unavailable.');
  if(response.status===409)throw new AdminError(409,'scope_changed','Account access changed. Reopen the workspace.');
  if(response.status!==200 || response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')throw unavailable();
  let value;
  try {
    const reader=response.body?.getReader();if(!reader)throw unavailable();
    let text='',size=0;const decoder=new TextDecoder('utf-8',{fatal:true});
    try {for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>100_000){await reader.cancel();throw unavailable();}text+=decoder.decode(value,{stream:true});}}
    finally{reader.releaseLock();}
    value=JSON.parse(text+decoder.decode());
  }catch{throw unavailable();}
  if(!isScheduleSources(value,revision))throw unavailable();
  return value;
}
