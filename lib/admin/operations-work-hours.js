import {AdminError,exact,text,UUID} from './shared-commands.js';
import {requireOperational} from './permissions.js';

const invalid=()=>new AdminError(400,'invalid_request','Choose an exact work-hours decision.');
const unavailable=()=>new AdminError(503,'unavailable','Work-hours review could not be verified.');
const pos=n=>Number.isSafeInteger(n)&&n>0;
const uuid=x=>typeof x==='string'&&UUID.test(x);
const recorded=x=>typeof x==='string'&&x.length===24&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString()===x;
const decisions=['approve','return'];
const readKeys=['workHours','visit','visitRevision','reportRevision'];
const pins=['visitId','visitRevision','reportRevision','membershipRevision'];
function parseIntExact(x){const n=Number(x);if(x!==String(n)||!pos(n))throw invalid();return n;}
function samePins(result,input){return result?.schema===1&&pins.every(key=>result[key]===input[key]);}

// Injection only. Hosted callers do not supply this port, and request input
// cannot enable it or designate a database. No bearer-to-service-role fallback.
export async function workHours(current,request,body,port) {
  const method=request.method, params=new URL(request.url).searchParams;
  if(!port)throw new AdminError(404,'unavailable','Work-hours review is not enabled.');
  if(!['GET','POST'].includes(method))throw invalid();
  requireOperational(current.member);
  const role=current.member.operational_role, actor=current.member.user_id;
  const membershipRevision=current.member.revision;
  const staffRead=method==='GET'&&role==='staff';
  if((!staffRead&&!['owner','manager'].includes(role))||!uuid(actor)||!pos(membershipRevision))
    throw new AdminError(403,'forbidden','Work-hours review is unavailable.');
  if(request.headers.get('x-ech-schedule-actor')!==current.principal.id||
     request.headers.get('x-ech-schedule-role')!==current.principal.operationalRole||
     current.principal.id!==actor||current.principal.operationalRole!==role)
    throw new AdminError(409,'conflict','Account access changed. Reload the workspace.');
  if(params.get('workHours')!=='1')throw invalid();
  if(method==='GET') {
    if(params.size!==readKeys.length||!readKeys.every(k=>params.getAll(k).length===1)||!uuid(params.get('visit')))throw invalid();
    const input={visitId:params.get('visit').toLowerCase(),visitRevision:parseIntExact(params.get('visitRevision')),
      reportRevision:parseIntExact(params.get('reportRevision')),membershipRevision};
    const result=await port.read(current,input);
    if(!samePins(result,input)||result.enabled!==true||!pos(result.contentRevision)||
       result.contentRevision>input.reportRevision||typeof result.canDecide!=='boolean'||staffRead&&result.canDecide||
       !(result.receipt===null||result.receipt&&decisions.includes(result.receipt.decision)&&
          (staffRead?!Object.hasOwn(result.receipt,'recordedAt'):recorded(result.receipt.recordedAt))&&result.canDecide===false))throw unavailable();
    return {schema:1,enabled:true,...input,contentRevision:result.contentRevision,canDecide:result.canDecide,
      receipt:result.receipt===null?null:{decision:result.receipt.decision,...(!staffRead?{recordedAt:result.receipt.recordedAt}:{})}};
  }
  if(params.size!==1)throw invalid();
  exact(body,['schema',...pins,'contentRevision','operationId','decision'],['reason']);
  if(body.schema!==1||!uuid(body.visitId)||!uuid(body.operationId)||!pos(body.visitRevision)||
     !pos(body.reportRevision)||!pos(body.contentRevision)||body.contentRevision>body.reportRevision||
     !pos(body.membershipRevision)||!decisions.includes(body.decision))throw invalid();
  if(body.membershipRevision!==membershipRevision)throw new AdminError(409,'conflict','Account access changed. Reload the workspace.');
  if(Object.hasOwn(body,'reason')||body.decision==='return')text(body.reason,500,true);
  const input={visitId:body.visitId.toLowerCase(),visitRevision:body.visitRevision,reportRevision:body.reportRevision,
    contentRevision:body.contentRevision,membershipRevision,operationId:body.operationId.toLowerCase(),
    decision:body.decision,reason:body.reason?.trim()??null};
  const result=await port.decide(current,input);
  if(!samePins(result,input)||result.contentRevision!==input.contentRevision||result.operationId!==input.operationId||
     result.decision!==input.decision||!recorded(result.recordedAt))throw unavailable();
  const {reason,...publicInput}=input;
  return {schema:1,...publicInput,recordedAt:result.recordedAt};
}

// Private preview process supplies a transaction bound to the verified fictional
// session on its own disposable socket. The route never accepts that connection,
// JWT claims or SQL from a request and cannot activate it in hosted deployments.
export function createWorkHoursFixturePort(withVerifiedFixtureSession) {
  const calls={
    read:'select ech_fixture_hours.read_current($1::uuid,$2::bigint,$3::bigint,$4::text,$5::bigint) as value',
    decide:'select ech_fixture_hours.decide($1::uuid,$2::bigint,$3::bigint,$4::bigint,$5::text,$6::bigint,$7::uuid,$8::text,$9::text) as value',
  };
  async function run(action,current,input){
    const {visitId,visitRevision,reportRevision,contentRevision,membershipRevision,operationId,decision,reason}=input;
    const role=current.member.operational_role;
    const args=action==='read'?[visitId,visitRevision,reportRevision,role,membershipRevision]:
      [visitId,visitRevision,reportRevision,contentRevision,role,membershipRevision,operationId,decision,reason];
    try{
      const result=await withVerifiedFixtureSession(current,async tx=>tx.query(calls[action],args));
      if(!Array.isArray(result?.rows)||result.rows.length!==1||!result.rows[0]?.value)throw unavailable();
      return result.rows[0].value;
    }catch(error){
      const code=error?.code;
      if(code==='PT403')throw new AdminError(403,'forbidden','Work-hours review is unavailable.');
      if(code==='PT409'||code==='PT412')throw new AdminError(code==='PT409'?409:412,'conflict','The visit or reported hours changed. Reload the report.');
      if(code==='PT400')throw invalid();
      throw unavailable();
    }
  }
  return {read:(current,input)=>run('read',current,input),decide:(current,input)=>run('decide',current,input)};
}
