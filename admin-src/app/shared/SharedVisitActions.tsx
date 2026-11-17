import { type FormEvent, useId, useLayoutEffect, useRef, useState } from 'react';
import { SharedError } from './live-model';
import type { ScheduleVisit } from './schedule-client';
import type { VisitDetail } from './visit-detail-client';
import type { LoadVisitReport, VisitReport } from './visit-report-client';
import type { VisitAction, VisitActionAccess, VisitActionsClient, VisitCommand } from './visit-action-client';
import { reportLocalTime, reportUtcTime } from './visit-time';
import { isVisitAction } from '../../../lib/operations/visit-action-wire.js';
import './shared-visit-report.css';

type Context = {access:VisitActionAccess;report:VisitReport|null};
export type VisitLeaveState = {dirty:boolean;pending:boolean;retained?:boolean};
type Comparison = {visit:ScheduleVisit;reportRevision:number|null};
const sameVisit = (left:ScheduleVisit,right:ScheduleVisit) => (['id','clientId','workerId','service','status','start','end','revision'] as const).every(key=>left[key]===right[key]);
const samePurpose = (left:ScheduleVisit,right:ScheduleVisit) => (['id','clientId','workerId','service','status'] as const).every(key=>left[key]===right[key]);
type Mode = 'submit'|'correct'|'review';
const empty = {summary:'',issue:'',actualStart:'',actualEnd:'',tasks:'',observations:'',reason:'',note:'',outcome:'',decision:'accepted',noteEventAt:'',noteEventOriginal:''};
const hasDraft = (draft:typeof empty) => Object.keys(empty).some(field=>draft[field as keyof typeof empty]!==empty[field as keyof typeof empty]);
type SavedDraft = {draft:typeof empty;visit:ScheduleVisit;reportRevision:number|null;reviewVersion:number|null};
export function SharedVisitActions({visit,active,client,loadDetail,loadReport,loadCurrentVisit,onConfirmed,onReconciled,onReconciliationFailure,onScopeFailure,onLeaveStateChange,noteEventTimeEnabled=false,reconciliationEnabled=true}: {
  visit:ScheduleVisit;active:boolean;client:VisitActionsClient;loadDetail:(id:string,revision:number,signal:AbortSignal)=>Promise<VisitDetail>;
  loadCurrentVisit:(id:string,membershipRevision:number,signal:AbortSignal)=>Promise<ScheduleVisit>;
  onReconciled:(visit:ScheduleVisit)=>void;
  onReconciliationFailure?:()=>void;
  loadReport:LoadVisitReport;onConfirmed:(visit:ScheduleVisit)=>void;onScopeFailure:(code:string)=>void;
  onLeaveStateChange:(state:VisitLeaveState)=>void;noteEventTimeEnabled?:boolean;reconciliationEnabled?:boolean;
}) {
  const [context,setContext] = useState<Context|null>(null);
  const [verifiedAccess,setVerifiedAccess] = useState<VisitActionAccess|null>(null);
  const [draft,setDraft] = useState(empty);
  const [mode,setMode] = useState<Mode>('submit');
  const [pending,setPending] = useState<VisitAction|null>(null);
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState('');
  const [error,setError] = useState(false);
  const [rejected,setRejected] = useState(false);
  const [reload,setReload] = useState(0);
  const [hideDraft,setHideDraft] = useState(false);
  const [comparison,setComparison] = useState<Comparison|null>(null);
  const savedDrafts = useRef<Partial<Record<Mode,SavedDraft>>>({});
  const unresolved = useRef(false);
  const membership = useRef<number|null>(null);
  const draftVisit = useRef({...visit});
  const draftReportRevision = useRef<number|null>(null);
  const draftReviewVersion = useRef<number|null>(null);
  const requestVisit = useRef<ScheduleVisit|null>(null);
  const controller = useRef<AbortController|null>(null);
  const current = useRef(0);
  const confirmed = useRef(onConfirmed); confirmed.current=onConfirmed;
  const reconciled = useRef(onReconciled); reconciled.current=onReconciled;
  const reconciliationFailure = useRef(onReconciliationFailure); reconciliationFailure.current=onReconciliationFailure;
  const scopeFailure = useRef(onScopeFailure); scopeFailure.current=onScopeFailure;
  const id = useId();
  const activeDirty=hasDraft(draft);
  const otherDrafts=(['submit','correct','review'] as const).some(mode=>{const saved=savedDrafts.current[mode];return !!saved && hasDraft(saved.draft);});
  const dirty=activeDirty || otherDrafts;
  const supported=visit.service==='Home support' && ['Confirmed','In progress','Completed'].includes(visit.status);
  useLayoutEffect(()=>{if(!activeDirty&&!pending){draftVisit.current={...visit};draftReportRevision.current=context?.report?.reportRevision??null;}},[visit,context,activeDirty,pending]);
  useLayoutEffect(()=>()=>{
    ++current.current;
    controller.current?.abort();
  },[]);
  useLayoutEffect(()=>{onLeaveStateChange({dirty,pending:!!pending&&!rejected,retained:!!pending});},[dirty,pending,rejected,onLeaveStateChange]);
  useLayoutEffect(()=>{
    const generation=++current.current;
    controller.current?.abort(); setBusy(false); setContext(null); setVerifiedAccess(null);
    if (!active || !supported) return;
    const request=new AbortController();controller.current=request;
    client.availability(request.signal).then(async access=>{
      if(request.signal.aborted || current.current!==generation)return;
      if(membership.current!==null && access.membershipRevision!==membership.current)throw new SharedError('scope_changed','Account access changed. Reopen the workspace.');
      membership.current=access.membershipRevision;
      // Receipt retries need fresh command access even if an earlier write made the old report revision stale.
      setVerifiedAccess(access);
      const report = access.enabled && ['In progress','Completed'].includes(visit.status)
        ? await loadReport(visit.id,visit.revision,request.signal) : null;
      if (!request.signal.aborted && current.current===generation) setContext({access,report});
    }).catch(error=>{
      if (request.signal.aborted || current.current!==generation) return;
      setError(true);setMessage('Visit command access could not be verified. The draft is retained in this open visit.');
      if(error instanceof SharedError && ['unauthenticated','scope_changed','conflict','forbidden'].includes(error.code)){setVerifiedAccess(null);scopeFailure.current(error.code);}
    });
    return ()=>{request.abort();controller.current?.abort();};
  },[client,active,visit.id,visit.revision,visit.status,supported,loadReport,reload]);
  const latest=context?.report?.versions.at(-1);
  const completedTasks=draft.tasks.split('\n').filter(task=>task.trim().length>0);
  const reviewEligibility=client.reviewEligibility(context?.report??null);
  async function execute(action:VisitAction) {
    if(!active || !supported || !verifiedAccess?.enabled || verifiedAccess.membershipRevision!==action.membershipRevision || busy)return;
    controller.current?.abort();
    const request=new AbortController();controller.current=request;const generation=current.current;
    const previouslyUnresolved=unresolved.current;
    // Cancellation cannot prove that a sent command was rejected.
    unresolved.current=true;setComparison(null);
    setBusy(true);setError(false);setMessage('Checking command receipt and reloading the current visit…');setRejected(false);
    try {
      const result=await client.commit(action,request.signal,requestVisit.current??visit,loadDetail,loadReport);
      if (request.signal.aborted || generation!==current.current) return;
      unresolved.current=false;requestVisit.current=null;draftReviewVersion.current=null;setHideDraft(false);
      setPending(null);setDraft(empty);setMode('submit');setMessage(`Confirmed ${result.receipt.action} · receipt ${result.receipt.operationId}. Current visit and report access rechecked.`);
      setContext(old=>old?{...old,report:result.report}:old);
      setError(false);confirmed.current(result.visit);
    } catch(error) {
      if(request.signal.aborted || generation!==current.current) return;
      setError(true);setMessage(error instanceof SharedError?error.message:'The result could not be confirmed. The draft and exact request are retained.');
      const definitive=!previouslyUnresolved && error instanceof SharedError && ['invalid_request','forbidden','action_conflict','stale_visit','disabled'].includes(error.code);
      unresolved.current=!definitive;setRejected(definitive);
      if(previouslyUnresolved)setMessage('The result is unknown. Keep the draft and retry the exact request to check its receipt. A later rejection does not establish whether an earlier attempt was recorded.');
      if(error instanceof SharedError && ['unauthenticated','scope_changed'].includes(error.code)){setVerifiedAccess(null);scopeFailure.current(error.code);}
    } finally {if(!request.signal.aborted && generation===current.current)setBusy(false);}
  }
  function submit(event:FormEvent) {
    event.preventDefault();if(!active || !supported || !context?.access.enabled || pending || busy || comparison || activeDirty && (!sameVisit(draftVisit.current,visit) || draftReportRevision.current!==(context.report?.reportRevision??null)))return;
    let command:VisitCommand;
    if(visit.status==='Confirmed')command={type:'start'};
    else if(mode==='review' && latest){
      if(!reviewEligibility.allowed)return;
      const version=draftReviewVersion.current;
      if(version===null || version!==latest.version)return;
      command={type:'review',version,decision:draft.decision as 'accepted'|'returned',note:draft.note};
    }
    else {
      if(visit.status==='In progress' && !['completed','follow-up','not-completed'].includes(draft.outcome)) {
        setError(true);setMessage('Choose the factual visit outcome before submitting. No outcome is selected automatically.');return;
      }
      const outcome=visit.status==='In progress'?draft.outcome:latest?.outcome;
      if(outcome==='completed' && completedTasks.length===0) {
        setError(true);setMessage(visit.status==='In progress'
          ? 'No completed tasks are listed. Choose Follow-up needed or Not completed and explain what happened in the factual summary. Do not invent a completed task.'
          : 'The original report outcome is Completed and corrections preserve that outcome. At least one completed task is required; review the original report before correcting it.');return;
      }
      let actualStart:string, actualEnd:string, noteEventAt:string|null;
      try {
        actualStart=reportUtcTime(draft.actualStart); actualEnd=reportUtcTime(draft.actualEnd);
        // Preserve an unchanged explicitly recorded instant, including historical offsets.
        // A blank field is unknown, never the visit interval or the save time.
        noteEventAt=!draft.noteEventAt ? null
          : draft.noteEventOriginal && draft.noteEventAt===reportLocalTime(draft.noteEventOriginal)
            ? draft.noteEventOriginal : reportUtcTime(draft.noteEventAt);
      }
      catch (failure) { setError(true); setMessage(failure instanceof Error ? failure.message : 'Check the Vancouver visit times.'); return; }
      const fields={summary:draft.summary,issue:draft.issue,actualStart,actualEnd,
        completedTasks,observations:draft.observations,...(noteEventTimeEnabled || draft.noteEventOriginal ? {noteEventAt} : {})};
      command=visit.status==='In progress'?{...fields,type:'submit',outcome:draft.outcome as 'completed'|'follow-up'|'not-completed'}
        :{...fields,type:'correct',reason:draft.reason};
    }
    const action:VisitAction={schema:1,operationId:crypto.randomUUID(),visitId:visit.id,visitRevision:visit.revision,
      reportRevision:command.type==='start'?null:context.report?.reportRevision??0,membershipRevision:context.access.membershipRevision,command};
    // Invalid local input has never been sent. Keep it editable instead of
    // putting it into the retained-request/reconciliation workflow.
    if(!isVisitAction(action)) {
      setError(true);setMessage('Check the factual summary, actual times and completed tasks. Use a summary of 3–2000 characters, an end time after the start and in the past, a visit under 24 hours, and at most 50 tasks of 500 characters each. Issue text allows 1000 characters and observations 3000. Corrections and reviews also need a reason or note of 3–500 characters. Remove unsupported control characters from text. Your draft is still editable.');return;
    }
    requestVisit.current={...visit};unresolved.current=false;
    setPending(action);void execute(action);
  }
  const change=(field:keyof typeof empty,value:string)=>{if(mode==='review' && draftReviewVersion.current===null)draftReviewVersion.current=latest?.version??null;if(!activeDirty&&!pending){draftVisit.current={...visit};draftReportRevision.current=context?.report?.reportRevision??null;}setDraft(old=>({...old,[field]:value}));};
  function selectMode(next:Mode) {
    if(!latest || pending || busy || comparison || next===mode || next==='review' && !reviewEligibility.allowed)return;
    savedDrafts.current[mode]={draft,visit:{...draftVisit.current},reportRevision:draftReportRevision.current,reviewVersion:draftReviewVersion.current};
    const saved=savedDrafts.current[next];
    delete savedDrafts.current[next];
    if(saved) {
      draftVisit.current={...saved.visit};draftReportRevision.current=saved.reportRevision;draftReviewVersion.current=saved.reviewVersion;
      setDraft(saved.draft);
    } else {
      draftVisit.current={...visit};draftReportRevision.current=context?.report?.reportRevision??null;
      draftReviewVersion.current=next==='review'?latest.version:null;
      setDraft(next==='correct'?{...empty,summary:latest.summary,issue:latest.issue,actualStart:reportLocalTime(latest.actualStart),
        actualEnd:reportLocalTime(latest.actualEnd),tasks:latest.completedTasks.join('\n'),observations:latest.observations,
        noteEventAt:latest.noteEventAt ? reportLocalTime(latest.noteEventAt) : '',noteEventOriginal:latest.noteEventAt ?? ''}:empty);
    }
    setMode(next);
  }
  function correction() {selectMode('correct');}
  function review() {selectMode('review');}
  async function reconcile() {
    if(unresolved.current || pending&&!rejected)return;
    const pinned=pending?.membershipRevision??membership.current;
    if(!pinned)return;
    controller.current?.abort();const request=new AbortController();controller.current=request;const generation=current.current;
    setBusy(true);setError(false);setComparison(null);
    setMessage('Reloading the current visit while retaining this draft…');
    const live=()=>!request.signal.aborted && generation===current.current;
    try {
      const access=await client.availability(request.signal);
      if(!live())return;
      if(access.membershipRevision!==pinned)throw new SharedError('scope_changed','Account access changed. Reopen the workspace.');
      if(!access.enabled)throw new SharedError('disabled','Visit commands are not enabled here.');
      const next=await loadCurrentVisit(visit.id,pinned,request.signal);
      if(!live())return;
      if(!samePurpose(draftVisit.current,next))throw new SharedError('changed_purpose','The client, assignment, service or status changed. This draft cannot be applied automatically. Keep this visit open or explicitly discard the draft.');
      await loadDetail(next.id,next.revision,request.signal);
      if(!live())return;
      const report=['In progress','Completed'].includes(next.status)?await loadReport(next.id,next.revision,request.signal):null;
      if(!live())return;
      // A second scoped read refuses a visit that changed during reconciliation.
      const checked=await loadCurrentVisit(next.id,pinned,request.signal);
      if(!sameVisit(next,checked))throw new SharedError('stale_visit','The visit changed again. Keep the draft and reload again before comparing.');
      const reviewVersion=pending?.command.type==='review'?pending.command.version:mode==='review'?draftReviewVersion.current:null;
      if(reviewVersion!==null && reviewVersion!==report?.versions.at(-1)?.version)
        throw new SharedError('changed_purpose','The latest report version changed. This exact-version review cannot be retargeted automatically. Keep this visit open or explicitly discard the draft.');
      if(request.signal.aborted || generation!==current.current)return;
      setContext({access,report});
      setHideDraft(false);setComparison({visit:next,reportRevision:report?.reportRevision??null});
      setMessage('Current visit reloaded. Compare the retained draft with the current visit and report below before enabling a new request.');
      reconciled.current(next);
    } catch(failure) {
      if(request.signal.aborted || generation!==current.current)return;
      setHideDraft(true);reconciliationFailure.current?.();
      setError(true);setMessage(failure instanceof SharedError && ['changed_purpose','stale_visit','disabled'].includes(failure.code)?failure.message:'The current visit could not be reloaded. Your draft and exact request are retained.');
      if(failure instanceof SharedError && failure.code==='disabled')setVerifiedAccess(null);
      if(failure instanceof SharedError && ['unauthenticated','scope_changed','forbidden','conflict'].includes(failure.code)){setVerifiedAccess(null);scopeFailure.current(failure.code);}
    } finally {if(!request.signal.aborted && generation===current.current)setBusy(false);}
  }
  const canCompare=!!comparison && !!context && sameVisit(comparison.visit,visit) && comparison.reportRevision===(context.report?.reportRevision??null) && (mode!=='review' || draftReviewVersion.current===latest?.version);
  function acceptComparison() {
    if(!active || !context?.access.enabled || !canCompare || unresolved.current || pending&&!rejected || busy)return;
    draftVisit.current={...visit};draftReportRevision.current=context?.report?.reportRevision??null;requestVisit.current=null;
    setPending(null);setRejected(false);setComparison(null);
    setMessage('Draft retained for editing against the current visit. Sending requires a new explicit submission.');
  }
  const retained=pending && <div>
    <p>Draft retained in this open visit. An exact retry sends the same content and revisions.</p>
    {active && !hideDraft && <p>Request identity: <span className="shared-visit-report__actor">{pending.operationId}</span>.</p>}
    <button type="button" disabled={busy || !active || !supported || !verifiedAccess?.enabled || verifiedAccess.membershipRevision!==pending.membershipRevision} onClick={()=>void execute(pending)}>Retry exact request</button>
  </div>;
  const reloadDraft=reconciliationEnabled&&(dirty||pending)&&(!pending||rejected) && <button type="button" disabled={busy} onClick={()=>void reconcile()}>Keep draft and reload for editing</button>;
  if(!active || !supported || hideDraft)return pending||dirty?<section className="shared-visit-actions" aria-label={pending&&!rejected?'Unresolved visit request':'Retained visit draft'}>
    <p>Visit details and draft content are hidden while current access is checked. Your draft is retained in this open visit.</p>
    {pending&&!rejected && <p>A sent visit request remains unresolved; it may already have been recorded.</p>}
    {message && <p role={error?'alert':'status'}>{message}</p>}{retained}{reloadDraft}
  </section>:null;
  return <section className="shared-visit-actions" aria-labelledby={`${id}-heading`}>
    <h3 id={`${id}-heading`}>Visit commands</h3>
    {!context && <><p role="status">Checking command availability…</p><button type="button" onClick={()=>setReload(value=>value+1)}>Retry command access</button></>}
    {message && <p role={error?'alert':'status'} className="shared-visit-report__wording">{message}</p>}
    {context && !context.access.enabled && <p>Read-only. Visit start, submission, correction and review commands are not enabled here.</p>}
    {!context?.access.enabled && <>{retained}{reloadDraft}</>}
    {context?.access.enabled && <>
      <p>The server checks assignment and current access for every request. A reviewer must be a different manager from the original author and latest correcting author.</p>
      {retained}{reloadDraft}
      {otherDrafts && <p>A draft in another command is retained in this open visit. Switching commands restores its original fields and report version. Sending this command clears only its own draft.</p>}
      {comparison && <div>
        <p>Compare every retained field below with the current report history and visit details above. No new request has been sent.</p>
        {canCompare ? <button type="button" disabled={busy} onClick={acceptComparison}>Use retained draft with current visit</button>
          : <p role="alert">The current visit or report changed again. Reload before comparing this draft.</p>}
      </div>}
      {visit.status==='Completed' && latest && !pending && !comparison && <div className="shared-visit-actions__choices">
        <button type="button" onClick={correction}>Correct latest report</button>
        {reviewEligibility.allowed ? <button type="button" onClick={review}>Review latest report</button>
          : <p className="shared-visit-report__wording">{reviewEligibility.reason}</p>}
      </div>}
      {mode==='review' && draftReviewVersion.current!==latest?.version && <p role="alert">This draft reviews version {draftReviewVersion.current}. The latest report version changed; the draft cannot be retargeted automatically.</p>}
      {(visit.status==='Confirmed' || visit.status==='In progress' || latest && (mode==='correct' || mode==='review' && reviewEligibility.allowed)) && <form onSubmit={submit}>
        <fieldset disabled={busy || !!pending || !!comparison || activeDirty && (!sameVisit(draftVisit.current,visit) || draftReportRevision.current!==(context.report?.reportRevision??null)) || mode==='review' && draftReviewVersion.current!==latest?.version}>
          <legend>{visit.status==='Confirmed'?'Start assigned visit':visit.status==='In progress'?'Submit factual visit report':mode==='review'?`Independent review · exact version ${draftReviewVersion.current}`:`Correct latest report · version ${latest?.version}`}</legend>
          {visit.status==='Confirmed' ? <p>Request an in-progress status for the assigned visit. This records no actual attendance or worked time.</p>
            : mode==='review' && visit.status==='Completed' ? <>
              <p>Review the latest exact version in the history above before deciding. This draft reviews version {draftReviewVersion.current}. The current report shown is version {latest?.version}, content revision {latest?.revision}, report stream revision {context.report?.reportRevision}.</p>
              <dl className="shared-visit-detail__fields"><dt>Exact summary</dt><dd>{latest?.summary}</dd><dt>Outcome</dt><dd>{latest?.outcome}</dd><dt>Actual start · Vancouver</dt><dd>{latest && reportLocalTime(latest.actualStart).replace('T',' ')}</dd><dt>Actual end · Vancouver</dt><dd>{latest && reportLocalTime(latest.actualEnd).replace('T',' ')}</dd><dt>Completed tasks</dt><dd>{latest?.completedTasks.length ? latest.completedTasks.map((task,index)=><p key={index}>{task}</p>) : 'No completed tasks were recorded in this report version.'}</dd><dt>Issue text</dt><dd>{latest?.issue || 'None entered'}</dd><dt>Observations</dt><dd>{latest?.observations || 'None entered'}</dd><dt>Note event time · Vancouver</dt><dd>{latest?.noteEventAt ? reportLocalTime(latest.noteEventAt).replace('T',' ') : 'Not recorded · unknown'}</dd><dt>Correction reason</dt><dd>{latest?.reason || 'Original report'}</dd></dl>
              <label htmlFor={`${id}-decision`}>Decision</label><select id={`${id}-decision`} value={draft.decision} onChange={event=>change('decision',event.target.value)}><option value="accepted">Accept this version</option><option value="returned">Return this version</option></select>
              <label htmlFor={`${id}-note`}>Review note</label><textarea id={`${id}-note`} required minLength={3} maxLength={500} value={draft.note} onChange={event=>change('note',event.target.value)} />
            </> : <>
              {visit.status==='In progress' && <><label htmlFor={`${id}-outcome`}>Outcome reported</label><select id={`${id}-outcome`} required value={draft.outcome} onChange={event=>change('outcome',event.target.value)}><option value="" disabled>Choose the factual outcome</option><option value="completed">Completed</option><option value="follow-up">Follow-up needed</option><option value="not-completed">Not completed</option></select></>}
              <label htmlFor={`${id}-summary`}>{completedTasks.length===0 ? 'Factual summary · what happened and why no tasks were completed' : 'Factual summary'}</label><textarea id={`${id}-summary`} required minLength={3} maxLength={2000} value={draft.summary} onChange={event=>change('summary',event.target.value)} />
              <p id={`${id}-time-help`}>Enter the actual date and time in Vancouver. The end must be after the start; visits must be under 24 hours and cannot overlap another report for this worker.</p>
              <label htmlFor={`${id}-start`}>Actual start · Vancouver</label><input id={`${id}-start`} type="datetime-local" step="0.001" aria-describedby={`${id}-time-help`} required value={draft.actualStart} onChange={event=>change('actualStart',event.target.value)} />
              <label htmlFor={`${id}-end`}>Actual end · Vancouver</label><input id={`${id}-end`} type="datetime-local" step="0.001" aria-describedby={`${id}-time-help`} required value={draft.actualEnd} onChange={event=>change('actualEnd',event.target.value)} />
              <label htmlFor={`${id}-tasks`}>Completed tasks · one per line, at most 50</label><textarea id={`${id}-tasks`} aria-describedby={`${id}-tasks-help`} value={draft.tasks} onChange={event=>change('tasks',event.target.value)} />
              <p id={`${id}-tasks-help`}>{completedTasks.length===0
                ? 'No completed tasks entered. Leave this list empty when none were completed; describe what happened in the summary. An empty record alone does not prove missed care.'
                : `${completedTasks.length} completed task${completedTasks.length===1?'':'s'} entered. List only work actually completed.`}</p>
              {visit.status==='In progress' && completedTasks.length===0 && <p>For a report with no completed tasks, choose Follow-up needed or Not completed. Record the actual visit times and factual reason; this does not approve worked time.</p>}
              <label htmlFor={`${id}-issue`}>Issue text</label><textarea id={`${id}-issue`} maxLength={1000} value={draft.issue} onChange={event=>change('issue',event.target.value)} />
              <label htmlFor={`${id}-observations`}>Factual observations</label><textarea id={`${id}-observations`} maxLength={3000} value={draft.observations} onChange={event=>change('observations',event.target.value)} />
              {noteEventTimeEnabled && <><label htmlFor={`${id}-note-event`}>Note event time · Vancouver (optional)</label>
              <input id={`${id}-note-event`} type="datetime-local" step="0.001" aria-describedby={`${id}-note-event-help`} value={draft.noteEventAt} onChange={event=>change('noteEventAt',event.target.value)} />
              <p id={`${id}-note-event-help`}>Enter when the event described in this note actually occurred, if known. Leave blank when unknown. This is separate from the visit interval and the automatically recorded save time; it is never filled automatically.</p></>}
              {visit.status==='Completed' && <><p>Corrections append a version and preserve the original outcome and history.</p><label htmlFor={`${id}-reason`}>Correction reason</label><textarea id={`${id}-reason`} required minLength={3} maxLength={500} value={draft.reason} onChange={event=>change('reason',event.target.value)} /></>}
            </>}
          <button type="submit">{visit.status==='Confirmed'?'Request visit start':visit.status==='In progress'?'Submit report':mode==='review'?'Record exact-version review':'Submit correction'}</button>
        </fieldset>
      </form>}
      {visit.status==='Completed' && !latest && <p>No report is available to correct or review.</p>}
      <p>Drafts stay only in memory while this visit remains open. Closing the visit or changing account clears them. A report does not approve worked time, verify attendance, resolve an issue, provide clinical authority or send a handover. Addressed handovers and clinical records are not supported.</p>
    </>}
  </section>;
}
