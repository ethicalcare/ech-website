import {AdminError,UUID} from '../../../lib/admin/shared-commands.js';
import {requireOperational} from '../../../lib/admin/permissions.js';
import {createIncidentIntentBoundary} from './operations-incident-intent.js';

const invalid=()=>new AdminError(400,'invalid_request','Choose an exact incident action.');
const unavailable=()=>new AdminError(503,'unavailable','Incident records could not be verified.');
const denied=()=>new AdminError(403,'forbidden','Incident records are unavailable.');
const uuid=x=>typeof x==='string'&&UUID.test(x)&&x===x.toLowerCase();
const pos=x=>Number.isSafeInteger(x)&&x>0;
const manager=role=>role==='manager'||role==='owner';
const own=(object,key)=>Object.hasOwn(object,key);
const bounded=(value,max)=>typeof value==='string'&&value.length<=max&&value.trim()===value&&!!value;
function scopeAt(c,expected,visit,revision){
  return c?.actor===expected.actor&&c.role===expected.role&&c.membershipRevision===expected.membershipRevision&&
    c.visit===visit&&c.revision===revision;
}

// The host supplies a trusted isolated transaction, never the browser. That
// transaction locks and rechecks the selected visit, membership/assignment and
// incident state; storage is supplied by the preview runner, not by this route.
export async function operationsIncidents(current,request,body,port){
  if(!port)throw new AdminError(404,'unavailable','Incident filing is not enabled.');
  requireOperational(current.member);
  const actor=current.member.user_id,role=current.member.operational_role,membershipRevision=current.member.revision;
  const expected={actor,role,membershipRevision};
  if(!uuid(actor)||!pos(membershipRevision)||actor!==current.principal.id||
     current.principal.operationalRole!==role||request.headers.get('x-ech-schedule-actor')!==actor||
     request.headers.get('x-ech-schedule-role')!==role)
    throw new AdminError(409,'conflict','Account access changed. Reload the workspace.');
  const method=request.method,params=new URL(request.url).searchParams;
  if(params.get('incidents')!=='1')throw invalid();
  if(method==='GET'){
    if(params.size!==3||!['incidents','visit','revision'].every(k=>params.getAll(k).length===1))throw invalid();
    const visit=params.get('visit'), revision=Number(params.get('revision'));
    if(!uuid(visit)||!pos(revision)||String(revision)!==params.get('revision'))throw invalid();
    const snapshot=await port.withVisitTransaction(current,visit,async tx=>{
      const c=tx.current;
      if(!scopeAt(c,expected,visit,revision))throw denied();
      const mayFile=role==='staff'&&c.assigned===true&&c.cancelled===false;
      if(!manager(role)&&!mayFile)throw denied();
      if(!manager(role))return {mayFile,items:[]};
      const records=await tx.list();
      if(!Array.isArray(records)||records.length>50)throw unavailable();
      const ids=new Set();
      const items=records.map(r=>{
        if(!uuid(r?.id)||ids.has(r.id)||r.visit!==visit||
           !(r.owner===null||uuid(r.owner))||!['open','closed'].includes(r.state)||
           typeof r.followUpRecorded!=='boolean'||r.state==='closed'&&(!r.owner||!r.followUpRecorded)||
           !bounded(r.summary,500))throw unavailable();
        ids.add(r.id);
        return {id:r.id,owner:r.owner,state:r.state,summary:r.summary,followUpRecorded:r.followUpRecorded};
      });
      return {mayFile:false,items};
    });
    if(!snapshot)throw denied();
    return {schema:1,visit,revision,membershipRevision,actor,...snapshot};
  }
  if(method!=='POST'||params.size!==1||!body||!uuid(body.visit)||
    (own(body,'note')&&!bounded(body.note,500))||(own(body,'summary')&&!bounded(body.summary,500)))throw invalid();
  const execute=createIncidentIntentBoundary((session,visit,action)=>
    port.withVisitTransaction(session,visit,tx=>{
      if(!scopeAt(tx.current,expected,visit,body.revision))return null;
      return action(tx);
    }));
  const result=await execute(current,body);
  if(result?.status!=='recorded')throw unavailable();
  return {schema:1,...result};
}
