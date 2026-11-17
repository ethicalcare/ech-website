import { SharedError, assertWire, uuid, type OperationalRole } from './live-model.ts';
import { readJson, requestOptions } from './session.ts';
import { createScheduleClient, type ScheduleVisit } from './schedule-client.ts';
import { isScheduleCommand, isScheduleCommandResult } from '../../../lib/operations/schedule-command-wire.js';

export type SchedulingCommand = {type:'assign';workerId:string;reason:string}|{type:'unassign'|'cancel';reason:string}
  |{type:'reschedule';start:string;end:string;reason:string}|{type:'confirm'};
export type ScheduleCommand = {schema:1;operationId:string;visitId:string;visitRevision:number;membershipRevision:number;command:SchedulingCommand};
export type ScheduleCommandAccess = {schema:1;enabled:boolean;membershipRevision:number};
export type ScheduleCommandClient = ReturnType<typeof createScheduleCommandClient>;
// Only a parsed non-success response from the command transport is a rejection.
// Receipt/readback failures never use this marker. Callers must also rule out prior uncertainty.
export class ScheduleCommandRejected extends SharedError {}
const unknown = () => new SharedError('write_unconfirmed','The change could not be confirmed. Your draft and exact request are retained. Retry the exact request to check its receipt.');
export function createScheduleCommandClient(fetcher:typeof fetch, actor:string, role:Exclude<OperationalRole,null>) {
  const schedule=createScheduleClient(fetcher,role,actor);
  async function send(signal:AbortSignal, command?:ScheduleCommand):Promise<any> {
    signal.throwIfAborted();assertWire(uuid(actor) && actor.length===36 && ['owner','manager','staff'].includes(role));
    const options=requestOptions(), combined=options.signal?AbortSignal.any([signal,options.signal]):signal;
    // Caller cancellation discards late work; an internal timeout leaves the
    // write outcome unknown and must hide stale details while retaining retry.
    const checkSignal=()=>{signal.throwIfAborted();if(combined.aborted)throw unknown();};
    let response:Response;
    try {response=await fetcher('/api/admin/operations?scheduling=1',{...options,method:command?'POST':'GET',signal:combined,
      headers:{Accept:'application/json','X-ECH-Schedule-Actor':actor,'X-ECH-Schedule-Role':role,...(command?{'Content-Type':'application/json'}:{})},
      ...(command?{body:JSON.stringify(command)}:{})});} catch {checkSignal();throw unknown();}
    checkSignal();
    if(response.status===401)throw new SharedError('unauthenticated','Sign in again before checking this request.');
    let result:any;try {result=await readJson(response,16_384);}catch {checkSignal();throw unknown();}
    checkSignal();
    if(response.status!==200) {
      if(['scope_changed','conflict'].includes(result?.error?.code))throw new SharedError('scope_changed','Account access changed. Reopen the workspace.');
      const failures:Record<number,[string,string]>={400:['invalid_request','Check the schedule time, worker and operational reason.'],
        401:['unauthenticated','Sign in again before checking this request.'],403:['forbidden','This account cannot perform this action. Only the assigned worker may confirm.'],
        405:['disabled','Schedule changes are not enabled here.'],409:['schedule_conflict','The visit, access or dispatch rules changed or conflict. Your draft is retained. Reload before preparing a new request.'],
        412:['stale_visit','The visit changed. Your draft is retained. Reload before preparing a new request.']};
      if(failures[response.status])throw command ? new ScheduleCommandRejected(...failures[response.status]) : new SharedError(...failures[response.status]);throw unknown();
    }
    return result;
  }
  return {
    async availability(signal:AbortSignal):Promise<ScheduleCommandAccess> {
      const result=await send(signal);
      assertWire(result && Object.keys(result).sort().join(',')==='enabled,membershipRevision,schema' && result.schema===1
        && typeof result.enabled==='boolean' && Number.isSafeInteger(result.membershipRevision) && result.membershipRevision>0);
      return result;
    },
    async reload(visit:ScheduleVisit,signal:AbortSignal,membershipRevision:number):Promise<ScheduleVisit> {
      return schedule.loadVisit(visit.id,membershipRevision,signal);
    },
    async commit(command:ScheduleCommand,signal:AbortSignal,observed:ScheduleVisit):Promise<{visit:ScheduleVisit;operationId:string}> {
      if(!isScheduleCommand(command) || command.visitId!==observed.id || command.visitRevision!==observed.revision)
        throw new SharedError('invalid_local_request','Review the current visit, schedule time, worker and operational reason. No request was sent.');
      // Capture exact content before the first await; callers retain the same
      // frozen envelope for a retry after a lost response.
      const frozen=JSON.parse(JSON.stringify(command)) as ScheduleCommand;
      const baseline={...observed};
      let result:any;
      try {result=await send(signal,frozen);} catch(error) {
        if(error instanceof SharedError && ['schedule_conflict','forbidden'].includes(error.code)) {
          // A dispatch rejection can also follow an access change while the
          // database waited. Check the current scope before retaining details.
          try {
            const access=await this.availability(signal);
            if(access.membershipRevision!==frozen.membershipRevision)throw unknown();
            await this.reload(baseline,signal,frozen.membershipRevision);
          } catch {signal.throwIfAborted();throw new SharedError('scope_changed','Current schedule access could not be confirmed. Reopen the workspace.');}
        }
        throw error;
      }
      if(!isScheduleCommandResult(result,frozen))throw unknown();
      const v=result.visit as ScheduleVisit,c=frozen.command;
      if(v.clientId!==baseline.clientId || v.service!==baseline.service
        || c.type!=='reschedule' && (v.start!==baseline.start || v.end!==baseline.end)
        || !['assign','unassign'].includes(c.type) && v.workerId!==baseline.workerId)throw unknown();
      let current:ScheduleVisit;
      try {current=await this.reload(v,signal,frozen.membershipRevision);} catch(error) {
        if(error instanceof SharedError && ['unauthenticated','forbidden','conflict','scope_changed'].includes(error.code))
          throw new SharedError('scope_changed','Current schedule access could not be confirmed. Reopen the workspace.');
        throw unknown();
      }
      signal.throwIfAborted();
      if(!(['id','clientId','workerId','service','start','end','status','revision'] as const).every(key=>current[key]===v[key]))
        throw new SharedError('schedule_conflict','The receipt exists, but the current visit has changed again. Your draft is retained. Reload and reconcile it.');
      return {visit:current,operationId:result.receipt.operationId};
    },
  };
}
