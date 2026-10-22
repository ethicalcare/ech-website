import { AdminError, UUID, parseCommand, commandFingerprint } from './shared-commands.js';
import { authorize, requireOperational } from './permissions.js';
const tables={inquiry:'ech_inquiries',partner:'ech_partners'};
export async function rpc(current,name,body,fetcher) {
  let response;try{response=await fetcher(current.config.base+'/rest/v1/rpc/'+name,{method:'POST',redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(10000),headers:{apikey:current.config.key,Authorization:'Bearer '+current.token,'Content-Type':'application/json'},body:JSON.stringify(body)});}catch{throw new AdminError(502,'write_unconfirmed','The database result is unknown. Keep the operation identity.');}
  if(response.status>=300&&response.status<400||!response.ok){const code=response.status===409?'conflict':response.status===403?'forbidden':response.status===400?'invalid_request':'write_unconfirmed';throw new AdminError([400,403,409].includes(response.status)?response.status:502,code,code==='conflict'?'Records changed. Reload before retrying.':'The database action could not be confirmed.');}
  return response.json();
}
async function rows(current,path,fetcher) {
  const response=await fetcher(current.config.base+'/rest/v1/'+path,{redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(10000),headers:{apikey:current.config.key,Authorization:'Bearer '+current.token}});
  if(response.status>=300&&response.status<400||!response.ok)throw new AdminError(response.status===401?401:503,response.status===401?'unauthenticated':'unavailable','Records could not be loaded.');
  const value=await response.json();if(!Array.isArray(value))throw new AdminError(503,'unavailable','Records could not be verified.');return value;
}
export function project(row) {return {...row.data,id:row.id,revision:row.revision,ownerId:row.owner_id,createdAt:new Date(row.created_at).toISOString(),updatedAt:new Date(row.updated_at).toISOString()};}
export async function list(current,kind,params,fetcher) {
  requireOperational(current.member);if(!tables[kind])throw new AdminError(400,'invalid_request','Invalid record type.');
  for(const key of params.keys())if(!['id','cursor','limit'].includes(key))throw new AdminError(400,'invalid_request','Invalid list filter.');
  const id=params.get('id'),cursor=params.get('cursor'),limit=Number(params.get('limit')||50);
  if(id&&!UUID.test(id)||cursor&&!UUID.test(cursor)||!Number.isInteger(limit)||limit<1||limit>100)throw new AdminError(400,'invalid_request','Invalid list filter.');
  const query=new URLSearchParams({select:'id,revision,owner_id,data,created_at,updated_at',order:'id.asc',limit:String(id?1:Math.min(limit,20)+1)});
  if(id)query.set('id','eq.'+id);else if(cursor)query.set('id','gt.'+cursor);
  if(current.member.operational_role==='staff')query.set('owner_id','eq.'+current.member.user_id);
  const result=await rows(current,tables[kind]+'?'+query,fetcher);
  for(const row of result)authorize(current.member,'read',row);
  if(id&&!result.length)throw new AdminError(404,'forbidden','Record is not available.');
  const items=[];let bytes=0;for(const row of result.slice(0,Math.min(limit,20))){const item=project(row),size=new TextEncoder().encode(JSON.stringify(item)).length;if(bytes+size>2000000)break;items.push(item);bytes+=size;}
  return {schema:1,mode:'shared',items,nextCursor:result.length>items.length&&items.length?items.at(-1).id:null};
}
export async function commit(current,kind,raw,fetcher) {
  const envelope=parseCommand(kind,raw);requireOperational(current.member);
  if(['create','assign'].includes(envelope.command.type))authorize(current.member,envelope.command.type);
  else await list(current,kind,new URLSearchParams({id:envelope.command.id}),fetcher);
  const value=await rpc(current,'ech_commit',{p_kind:kind,p_envelope:envelope},fetcher);
  if(!value?.record||!value.receipt||value.receipt.operationId!==envelope.operationId||value.receipt.expectedRevision!==envelope.expectedRevision||value.receipt.revision!==envelope.expectedRevision+1||value.record.revision!==value.receipt.revision||value.receipt.commandFingerprint!==await commandFingerprint(envelope)||value.record.id!==envelope.command.id)throw new AdminError(502,'write_unconfirmed','Save receipt could not be verified. Keep the operation identity and review records.');
  return {schema:1,mode:'shared',...value};
}
export async function assignees(current,fetcher) {authorize(current.member,'assignees');const items=await rpc(current,'ech_assignees',{},fetcher);if(!Array.isArray(items))throw new AdminError(503,'unavailable','Assignments unavailable.');return {items};}
export async function history(current,params,fetcher) {
  const kind=params.get('recordType'),id=params.get('id');if(!tables[kind]||!UUID.test(id||''))throw new AdminError(400,'invalid_request','Invalid history request.');
  await list(current,kind,new URLSearchParams({id}),fetcher);
  const cursor=Number(params.get('cursor')||0),limit=Number(params.get('limit')||20);if(!Number.isSafeInteger(cursor)||cursor<0||!Number.isInteger(limit)||limit<1||limit>100)throw new AdminError(400,'invalid_request','Invalid history cursor.');
  const query=new URLSearchParams({revision:'gt.'+cursor,record_type:'eq.'+kind,record_id:'eq.'+id,select:'id,operation_id,record_type,record_id,actor_id,actor_label,at,action,revision,details',order:'revision.asc',limit:String(Math.min(limit,20)+1)});
  const events=await rows(current,'ech_events?'+query,fetcher);
  const page=events.slice(0,Math.min(limit,20));return {nextCursor:events.length>page.length?page.at(-1).revision:null,items:page.map(e=>({id:e.id,operationId:e.operation_id,recordType:e.record_type,recordId:e.record_id,actorId:e.actor_id,actorLabel:e.actor_label,at:new Date(e.at).toISOString(),action:e.action,revision:e.revision,details:Object.fromEntries(Object.entries(e.details).filter(([key])=>key!=='source'))}))};
}
