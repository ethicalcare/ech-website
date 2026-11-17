import { SharedError, assertWire, uuid, type OperationalRole } from './live-model.ts';
import { readJson, requestOptions } from './session.ts';
import { isVisitAction, isVisitActionReceipt } from '../../../lib/operations/visit-action-wire.js';
import type { VisitDetail } from './visit-detail-client';
import type { LoadVisitReport, VisitReport } from './visit-report-client';
import type { ScheduleVisit } from './schedule-client';

export type ReportFields = { summary: string; issue: string; actualStart: string; actualEnd: string; completedTasks: string[]; observations: string; noteEventAt?: string | null };
export type VisitCommand = {type:'start'} | (ReportFields & {type:'submit';outcome:'completed'|'follow-up'|'not-completed'})
  | (ReportFields & {type:'correct';reason:string}) | {type:'review';version:number;decision:'accepted'|'returned';note:string};
export type VisitAction = {schema:1;operationId:string;visitId:string;visitRevision:number;reportRevision:number|null;membershipRevision:number;command:VisitCommand};
export type VisitActionReceipt = {schema:1;operationId:string;visitId:string;visitRevision:number;reportRevision:number|null;reportVersion:number|null;action:VisitCommand['type'];recordedAt:string|null};
export type VisitActionAccess = {schema:1;enabled:boolean;membershipRevision:number;noteEventTime?:boolean};
export type VisitActionsClient = ReturnType<typeof createVisitActionsClient>;
const unknown = () => new SharedError('write_unconfirmed', 'The result is unknown. Your draft and exact request are retained. Retry the exact request to check its receipt.');
export function createVisitActionsClient(fetcher: typeof fetch, actor: string, role: Exclude<OperationalRole, null>) {
  const headers = {Accept:'application/json','X-ECH-Schedule-Actor':actor,'X-ECH-Schedule-Role':role,'X-ECH-Visit-Features':'1'};
  async function send(path: string, signal: AbortSignal, action?: VisitAction) {
    signal.throwIfAborted();
    assertWire(uuid(actor) && actor.length === 36 && ['owner','manager','staff'].includes(role));
    const options = requestOptions();
    const combined = options.signal ? AbortSignal.any([options.signal,signal]) : signal;
    const checkCancellation = () => { signal.throwIfAborted(); if (combined.aborted) throw unknown(); };
    let response: Response;
    try { response = await fetcher('/api/admin/operations' + path, {...options,method:action?'POST':'GET',signal:combined,
      headers:{...headers,...(action?{'Content-Type':'application/json'}:{})},...(action?{body:JSON.stringify(action)}:{})}); }
    catch { checkCancellation(); throw unknown(); }
    checkCancellation();
    let result: any;
    try { result = await readJson(response, 16_384); }
    catch { checkCancellation(); throw unknown(); }
    checkCancellation();
    if (response.status !== 200) {
      const messages: Record<number,[string,string]> = {
        400:['invalid_request','Check the summary, actual times, completed tasks and reason or review note.'],
        401:['unauthenticated','Sign in again before checking the result.'],
        403:['forbidden','The server rejected this request. Starting and submitting require the assigned worker; review requires an independent manager.'],
        405:['disabled','Visit commands are not enabled here.'],
        409:['action_conflict','The visit, report, access or actual times conflict. Your draft is retained. Reload before preparing a new request.'],
        412:['stale_visit','The visit changed. Your draft is retained. Reload before preparing a new request.'],
      };
      if (result?.error?.code === 'scope_changed') throw new SharedError('scope_changed','Account access changed. Reopen the workspace.');
      const failure = messages[response.status];
      if (failure) throw new SharedError(...failure);
      throw unknown();
    }
    return result;
  }
  return {
    reviewEligibility(report: VisitReport | null): { allowed: boolean; reason: string } {
      if (role !== 'owner' && role !== 'manager') return { allowed: false, reason: 'An owner or manager must independently review this report.' };
      const original = report?.versions[0];
      const latest = report?.versions.at(-1);
      if (!original || !latest) return { allowed: false, reason: 'No saved report is available for review.' };
      if ([original.actorId, latest.actorId].includes(actor.toLowerCase())) {
        return { allowed: false, reason: 'A different owner or manager must review this report. You authored its original or latest version.' };
      }
      return { allowed: true, reason: 'The server will recheck independent review authority when you submit.' };
    },
    async availability(signal: AbortSignal): Promise<VisitActionAccess> {
      const result = await send('?commands=1',signal);
      assertWire(result && ['enabled,membershipRevision,schema','enabled,membershipRevision,noteEventTime,schema'].includes(Object.keys(result).sort().join(',')) && result.schema===1
        && (!Object.hasOwn(result,'noteEventTime') || typeof result.noteEventTime==='boolean' && (!result.noteEventTime || result.enabled===true))
        && typeof result.enabled==='boolean' && Number.isSafeInteger(result.membershipRevision) && result.membershipRevision>0);
      return result;
    },
    async commit(action: VisitAction, signal: AbortSignal, visit: ScheduleVisit,
      loadDetail: (id:string,revision:number,signal:AbortSignal)=>Promise<VisitDetail>, loadReport: LoadVisitReport): Promise<{visit:ScheduleVisit;report:VisitReport|null;receipt:VisitActionReceipt}> {
      if (!isVisitAction(action)) throw new SharedError('invalid_request','Use a summary of 3–2000 characters, past UTC times under 24 hours, at most 50 completed tasks, and a reason or review note of 3–500 characters. A completed outcome requires at least one task.');
      if (!visit || visit.id !== action.visitId || visit.revision !== action.visitRevision)
        throw new SharedError('stale_visit','The selected visit does not match this request. Reload the visit before preparing a new request.');
      const receipt = await send('', signal, action);
      if (!isVisitActionReceipt(receipt,action)) throw unknown();
      // A receipt alone is not a displayed save. Recheck current scoped reads.
      let report: VisitReport | null;
      try {
        await loadDetail(action.visitId,receipt.visitRevision,signal);
        signal.throwIfAborted();
        report = action.command.type === 'start' ? null : await loadReport(action.visitId,receipt.visitRevision,signal,receipt.reportRevision);
        signal.throwIfAborted();
        if(action.command.type!=='start' && !report)throw unknown();
        if (report) {
          const event = action.command.type === 'review' ? report.reviews.find(row=>row.revision===receipt.reportRevision)
            : report.versions.find(row=>row.revision===receipt.reportRevision);
          if (!event || event.actorId!==actor || event.actorRole!==role || event.version!==receipt.reportVersion || event.recordedAt!==receipt.recordedAt) throw unknown();
          const c = action.command;
          if (c.type==='review') {
            if (!('decision' in event) || event.decision!==c.decision || event.note!==c.note) throw unknown();
          } else if (c.type!=='start') {
            if (!('summary' in event) || event.summary!==c.summary || event.issue!==c.issue || event.actualStart!==c.actualStart
              || event.actualEnd!==c.actualEnd || event.observations!==c.observations || JSON.stringify(event.completedTasks)!==JSON.stringify(c.completedTasks)
              || Object.hasOwn(c,'noteEventAt') && (event.noteEventAt ?? null)!==c.noteEventAt
              || (c.type==='submit' ? event.outcome!==c.outcome || event.reason!==null : event.reason!==c.reason)) throw unknown();
          }
        }
      } catch (error) {
        signal.throwIfAborted();
        if (error instanceof SharedError && ['unauthenticated','forbidden','conflict','scope_changed'].includes(error.code))
          throw new SharedError('scope_changed','Current visit access could not be confirmed. Reopen the workspace before checking the result.');
        // A failed read cannot turn an acknowledged write into a rejection.
        throw unknown();
      }
      return {visit:{...visit,revision:receipt.visitRevision,status:action.command.type==='start'?'In progress':'Completed'},report,receipt};
    },
  };
}
