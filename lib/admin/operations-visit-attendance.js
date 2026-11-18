import { AdminError, UUID } from './shared-commands.js';
import { requireOperational } from './permissions.js';
import { isVisitAttendance } from '../operations/visit-attendance.js';

const unavailable=()=>new AdminError(503,'unavailable','Attendance could not be verified. Reload before trying again.');
export async function visitAttendance(current, raw, action, fetcher) {
  requireOperational(current.member);
  if (action!=='read' && current.member.operational_role!=='staff')
    throw new AdminError(403,'forbidden','Only assigned staff can record attendance.');
  if (!raw || Object.keys(raw).length !== 2 || typeof raw.visitId!=='string' ||
      !UUID.test(raw.visitId) || !Number.isSafeInteger(raw.revision) || raw.revision<1)
    throw new AdminError(400,'invalid_request','Choose a current visit.');
  if (!Number.isSafeInteger(current.member.revision) || current.member.revision<1) throw unavailable();
  let response;
  try {
    response=await fetcher(current.config.base+'/rest/v1/rpc/ech_operations_visit_attendance',{
      method:'POST',redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(10_000),
      headers:{apikey:current.config.key,Authorization:'Bearer '+current.token,'Content-Type':'application/json'},
      body:JSON.stringify({p_visit_id:raw.visitId,p_revision:raw.revision,p_role:current.member.operational_role,
        p_membership_revision:current.member.revision,p_action:action})
    });
  } catch { throw unavailable(); }
  if ([403,409,412].includes(response.status))
    throw new AdminError(response.status,'conflict','Attendance was not recorded. Reload the visit to verify its current state.');
  if (!response.ok) throw unavailable();
  const reader=response.body?.getReader();
  if (!reader) throw unavailable();
  try {
    const decoder=new TextDecoder('utf-8',{fatal:true}); let text='',size=0;
    for (;;) {
      const {value,done}=await reader.read();
      if (done) break;
      size+=value.byteLength;
      if (size>4096) {await reader.cancel(); throw unavailable();}
      text+=decoder.decode(value,{stream:true});
    }
    const result=JSON.parse(text+decoder.decode());
    if (!isVisitAttendance(result,raw.visitId.toLowerCase(),raw.revision)) throw unavailable();
    return result;
  } catch { throw unavailable(); }
  finally { reader.releaseLock(); }
}
