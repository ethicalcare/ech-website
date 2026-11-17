import { useId, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { SharedError } from './live-model';
import type { ScheduleIdentity, ScheduleVisit } from './schedule-client';
import type { ScheduleSource, ScheduleCreation, ScheduleCreateClient } from './schedule-create-client';
import { reportUtcTime, reportLocalTime } from './visit-time';
import type { ScheduleRecurrence } from './schedule-recurrence-client';
import { CreationReceiptError, sameCreationReview, sameCreationVisit, creationStaffLabel, type CreationReview } from './schedule-creation-review';
import { recurrenceIntervals } from '../../../lib/operations/schedule-recurrence-wire.js';
import './shared-schedule-commands.css';

const emptyDraft={sourceId:'',workerId:'',start:'',end:'',repeat:'none',count:'2'};
const recurrenceDate=new Intl.DateTimeFormat('en-CA',{timeZone:'UTC',month:'short',day:'numeric',year:'numeric'});
function recurrenceReviewLabel(start:string,end:string) {
  const localStart=reportLocalTime(start),localEnd=reportLocalTime(end);
  const date=(local:string)=>recurrenceDate.format(new Date(local+'Z'));
  const clock=(local:string)=>{
    const hour=Number(local.slice(11,13)),seconds=local.slice(17,19),millis=local.slice(20,23);
    const precision=seconds!=='00'||millis!=='000'?':'+seconds+(millis!=='000'?'.'+millis:''):'';
    return `${hour%12||12}:${local.slice(14,16)}${precision} ${hour<12?'a.m.':'p.m.'}`;
  };
  return `${date(localStart)}, ${clock(localStart)}–${localStart.slice(0,10)===localEnd.slice(0,10)?'':date(localEnd)+', '}${clock(localEnd)} · Vancouver`;
}

export function SharedScheduleCreate({client,staff,selectedTaskPlan,active=true,allowRecurrence=false,onScopeFailure,onConfirmed,onPendingChange}:{client:ScheduleCreateClient;staff:ScheduleIdentity[];active?:boolean;allowRecurrence?:boolean;selectedTaskPlan?:{clientId:string;membershipRevision:number;instructionsVersion:number;planToken:string}|null;
  onScopeFailure:(code:string)=>void;onConfirmed:(visit:ScheduleVisit)=>void;onPendingChange:(pending:boolean)=>void}) {
  const [access,setAccess]=useState<{enabled:boolean;membershipRevision:number}|null>(null),[sources,setSources]=useState<ScheduleSource[]|null>(null);
  const [draft,setDraft]=useState(emptyDraft),[pending,setPending]=useState<ScheduleCreation|ScheduleRecurrence|null>(null);
  const [reviewSource,setReviewSource]=useState<{clientId:string;clientName:string}|null>(null);
  const [review,setReview]=useState<CreationReview|null>(null),[resolved,setResolved]=useState(false);
  const [receiptState,setReceiptState]=useState<'unresolved'|'unknown'|'committed'>('unresolved');
  const inFlight=useRef(false),receiptHeading=useRef<HTMLHeadingElement>(null);
  useLayoutEffect(()=>{if(review)receiptHeading.current?.focus({preventScroll:true});},[review]);
  const [recurrenceEnabled,setRecurrenceEnabled]=useState(false);
  const [busy,setBusy]=useState(false),[dirty,setDirty]=useState(false),[rejected,setRejected]=useState(false),[error,setError]=useState(false),[message,setMessage]=useState('');
  const heading=useRef<HTMLHeadingElement>(null),controller=useRef<AbortController|null>(null),generation=useRef(0),membership=useRef<number|null>(null),id=useId();
  const callbacks=useRef({onScopeFailure,onConfirmed,onPendingChange});callbacks.current={onScopeFailure,onConfirmed,onPendingChange};
  useLayoutEffect(()=>{callbacks.current.onPendingChange(!!pending||dirty);},[pending,dirty]);
  function fail(failure:unknown) {
    setError(true);setMessage(failure instanceof SharedError?failure.message:'Current scheduling access could not be verified. Your draft is retained.');
    if(failure instanceof SharedError && ['unauthenticated','scope_changed','conflict','forbidden'].includes(failure.code)) {
      setReview(null);setReviewSource(null);setSources(null);setPending(null);setDraft(emptyDraft);setDirty(false);setAccess(null);
      callbacks.current.onScopeFailure(failure.code);
    }
  }
  async function load() {
    if(!active)return;
    controller.current?.abort();const request=new AbortController();controller.current=request;const current=++generation.current;
    setBusy(true);setSources(null);setError(false);
    try {
      const next=await client.availability(request.signal);
      if(membership.current!==null && next.membershipRevision!==membership.current)throw new SharedError('scope_changed','Account access changed. Reopen the workspace.');
      if(!next.enabled){if(!request.signal.aborted && current===generation.current){setAccess(next);setSources([]);}return;}
      const recurring=allowRecurrence?await client.recurrence.availability(request.signal):{enabled:false,membershipRevision:next.membershipRevision};
      if(recurring.membershipRevision!==next.membershipRevision)throw new SharedError('scope_changed','Account access changed. Reopen the workspace.');
      const recovered=await client.drafts.recover(next.membershipRevision,request.signal);
      if(request.signal.aborted || current!==generation.current)return;
      membership.current=next.membershipRevision;setAccess(next);setRecurrenceEnabled(recurring.enabled);
      if(recovered){setPending(recovered.request);setReceiptState(recovered.state==='committed'?'committed':'unknown');setDirty(false);setRejected(false);setMessage('Recovered the outstanding exact creation request from the shared service. Review its receipt or cancel the reservation before starting another visit.');return;}
      setPending(null);setReceiptState('unresolved');setRejected(false);
      const values=await client.sources(next.membershipRevision,request.signal);
      if(request.signal.aborted || current!==generation.current)return;
      membership.current=next.membershipRevision;setAccess(next);setRecurrenceEnabled(recurring.enabled);setSources(values);setDraft(old=>({...old,sourceId:''}));

    }catch(failure){if(!request.signal.aborted && current===generation.current)fail(failure);}
    finally{if(!request.signal.aborted && current===generation.current)setBusy(false);}
  }
  useLayoutEffect(()=>{heading.current?.focus({preventScroll:true});void load();return()=>{generation.current++;controller.current?.abort();};},[client]);
  // Returning to an open form invalidates the selectable source snapshot. Retain
  // the exact request after a possible write, and require an explicit receipt retry.
  useLayoutEffect(()=>{
    const hide=()=>{generation.current++;controller.current?.abort();setBusy(false);setSources(null);setReview(null);setReviewSource(null);setResolved(false);if(inFlight.current)setReceiptState(old=>old==='committed'?old:'unknown');inFlight.current=false;setError(false);setMessage('Source details are hidden until current access is rechecked. If a request was sent, retry that exact request to check its outcome.');};
    const onVisibility=()=>{if(document.visibilityState!=='visible')hide();};
    if(!active)hide();
    window.addEventListener('blur',hide);document.addEventListener('visibilitychange',onVisibility);
    return()=>{window.removeEventListener('blur',hide);document.removeEventListener('visibilitychange',onVisibility);};
  },[active]);
  async function execute(command:ScheduleCreation|ScheduleRecurrence) {
    if(!active || !allowRecurrence&&command.command.type==='createSeries')return;
    controller.current?.abort();const request=new AbortController();controller.current=request;const current=++generation.current;
    inFlight.current=true;setReview(null);setResolved(false);setBusy(true);setSources(null);setError(false);setRejected(false);setMessage('Checking the creation receipt and current shared visit…');
    try {
      const series=command.command.type==='createSeries';
      const result=series?await client.recurrence.commit(command as ScheduleRecurrence,request.signal):await client.commit(command as ScheduleCreation,request.signal);
      if(request.signal.aborted || current!==generation.current)return;
      const visits='visits' in result?result.visits:[result.visit];
      setReviewSource({clientId:command.command.source.clientId,clientName:command.command.source.clientName});
      setReview({operationId:result.operationId,visits:visits.map(visit=>({original:structuredClone(visit),current:visit}))});
      setDirty(false);setReceiptState('committed');
      setMessage(('visits' in result?`Confirmed ${result.visits.length} recurring visits saved.`:'Confirmed new visit saved.')+' Review and acknowledge the current outcomes before starting another visit.');
      callbacks.current.onConfirmed(visits[0]);
    }catch(failure){
      if(request.signal.aborted || current!==generation.current)return;
      if(failure instanceof CreationReceiptError)setReceiptState('committed');
      else if(!(failure instanceof SharedError) || failure.code==='write_unconfirmed')setReceiptState(old=>old==='committed'?old:'unknown');
      setRejected(receiptState==='unresolved' && failure instanceof SharedError && ['invalid_request','schedule_conflict','disabled'].includes(failure.code));
      fail(failure instanceof SharedError && failure.code==='schedule_conflict' && receiptState!=='unresolved'
        ?new SharedError('schedule_conflict','This check was rejected. An earlier creation attempt still needs review; keep the exact request and retry its receipt check before creating another visit.')
        :failure);
    }finally{if(current===generation.current){inFlight.current=false;if(!request.signal.aborted)setBusy(false);}}
  }
  async function inspectReceipt(acknowledge=false) {
    if(!active||!pending || busy)return;
    controller.current?.abort();const request=new AbortController();controller.current=request;const current=++generation.current;
    inFlight.current=true;const previous=review;setReview(null);setSources(null);setRejected(false);setBusy(true);setError(false);
    setMessage('Rechecking the exact receipt and every current visit…');
    try {
      const next=pending.command.type==='createSeries'
        ?await client.recurrence.reconcile(pending as ScheduleRecurrence,request.signal,access?.membershipRevision)
        :await client.reconcile(pending as ScheduleCreation,request.signal,access?.membershipRevision);
      if(request.signal.aborted || current!==generation.current)return;
      setReviewSource({clientId:pending.command.source.clientId,clientName:pending.command.source.clientName});setReview(next);setReceiptState('committed');
      if(acknowledge && previous && sameCreationReview(previous,next)) {
        const terminal=await client.drafts.resolve(pending,request.signal);
        if(terminal?.state!=='resolved')throw new SharedError('write_unconfirmed','Receipt resolution could not be confirmed. Recover the outstanding request before starting another.');
        if(request.signal.aborted || current!==generation.current)return;
        setPending(null);setDirty(false);setDraft(emptyDraft);setResolved(true);setReceiptState('unresolved');
        setMessage('Creation receipt resolved. The original creation is recorded; the current outcomes below were rechecked. No additional visits were created.');
        callbacks.current.onConfirmed(next.visits[0].current);
      }else setMessage(acknowledge?'The schedule changed during review. Review the updated current outcomes and acknowledge again.':'Creation receipt verified. Review each original and current outcome before acknowledging this request.');
    }catch(failure){
      if(request.signal.aborted || current!==generation.current)return;
      if(failure instanceof CreationReceiptError)setReceiptState('committed');
      fail(failure);
    }finally{if(current===generation.current){inFlight.current=false;if(!request.signal.aborted)setBusy(false);}}
  }
  async function cancelReservation() {
    if(!active||!pending||busy)return;
    controller.current?.abort();const request=new AbortController();controller.current=request;const current=++generation.current;setBusy(true);setError(false);setReview(null);
    try{
      const result=await client.drafts.cancel(pending,request.signal);
      if(request.signal.aborted||current!==generation.current)return;
      if(result?.state==='committed'||result?.state==='resolved'){setReceiptState('committed');setRejected(false);setMessage('Creation committed before cancellation. Review the recorded creation and current visits before resolving it.');return;}
      if(result?.state!=='cancelled')throw new SharedError('write_unconfirmed','Cancellation could not be confirmed. Recover this request before starting another.');
      setPending(null);setReceiptState('unresolved');setRejected(false);setDraft(emptyDraft);setDirty(false);setMessage('Creation reservation cancelled. Delayed attempts using that request are fenced from creating visits.');
      await load();
    }catch(failure){if(!request.signal.aborted&&current===generation.current)fail(failure);}
    finally{if(current===generation.current&&!request.signal.aborted)setBusy(false);}
  }
  function stopCheck() {
    generation.current++;controller.current?.abort();inFlight.current=false;setBusy(false);setReview(null);setRejected(false);
    setReceiptState(old=>old==='committed'?old:'unknown');setMessage('Check stopped. The exact request is retained; its outcome still needs review.');
  }
  function submit(event:FormEvent) {
    event.preventDefault();if(!active||busy||pending||!access?.enabled||!sources)return;
    const source=sources.find(s=>s.clientId===draft.sourceId);if(!source){fail(new SharedError('invalid_request','Select a current reviewed scheduling source.'));return;}
    if(selectedTaskPlan && (source.clientId!==selectedTaskPlan.clientId || source.instructionsVersion!==selectedTaskPlan.instructionsVersion || access.membershipRevision!==selectedTaskPlan.membershipRevision || source.service!=='Home support')){fail(new SharedError('invalid_request','The selected task plan belongs to a different client or instruction version. Review the current plan before scheduling.'));return;}
    let start:string,end:string;
    try{start=reportUtcTime(draft.start);end=reportUtcTime(draft.end);if(start>=end)throw new RangeError('The visit end must be after its start.');}
    catch(failure){setError(true);setMessage(failure instanceof Error?failure.message:'Check the Vancouver times.');return;}
    if(draft.repeat!=='none') {
      if(!recurrenceEnabled){fail(new SharedError('disabled','Recurring visits are not enabled here.'));return;}
      try {
        const localStart=reportLocalTime(start),localEnd=reportLocalTime(end),cadence=draft.repeat as 'daily'|'weekly',count=Number(draft.count);
        const occurrences=recurrenceIntervals(localStart,localEnd,cadence,count).map((times:{start:string;end:string})=>({...times,operationId:crypto.randomUUID(),visitId:crypto.randomUUID()}));
        const command:ScheduleRecurrence={schema:1,operationId:crypto.randomUUID(),membershipRevision:access.membershipRevision,
          command:{type:'createSeries',clientId:source.clientId,service:source.service,workerId:draft.workerId||null,source:structuredClone(source),...(selectedTaskPlan?{taskPlanToken:selectedTaskPlan.planToken}:{}),timeZone:'America/Vancouver',localStart,localEnd,cadence,count,occurrences}};
        setPending(command);void execute(command);
      }catch(failure){setError(true);setMessage(failure instanceof Error?failure.message:'Review each Vancouver occurrence.');}
      return;
    }
    const command:ScheduleCreation={schema:1,operationId:crypto.randomUUID(),visitId:crypto.randomUUID(),visitRevision:0,membershipRevision:access.membershipRevision,
      command:{type:'create',clientId:source.clientId,service:source.service,workerId:draft.workerId||null,start,end,source:structuredClone(source),...(selectedTaskPlan?{taskPlanToken:selectedTaskPlan.planToken}:{})}};
    setPending(command);void execute(command);
  }
  const selected=sources?.find(s=>s.clientId===draft.sourceId);
  let preview:{start:string;end:string}[]=[],previewError='';
  if(draft.repeat!=='none'&&draft.start&&draft.end)try{preview=recurrenceIntervals(reportLocalTime(reportUtcTime(draft.start)),reportLocalTime(reportUtcTime(draft.end)),draft.repeat,Number(draft.count));}catch(failure){previewError=failure instanceof Error?failure.message:'Check recurrence times.';}

  return <section className="shared-schedule-commands" aria-labelledby={`${id}-title`}>
    <h2 ref={heading} tabIndex={-1} id={`${id}-title`}>Create a shared visit</h2>
    {selectedTaskPlan && <p>Selected task plan: instruction version {selectedTaskPlan.instructionsVersion}. Choose its matching client; the server rechecks the exact plan.</p>}
    {message && <p role={error?'alert':'status'}>{message}</p>}
    {review && <section aria-labelledby={`${id}-receipt-title`} className="creation-receipt-review">
      <h3 ref={receiptHeading} id={`${id}-receipt-title`} tabIndex={-1}>Original receipt and current schedule</h3>
      <p>Creation receipt verified for {review.visits.length} {review.visits.length===1?'visit':'visits'}. Current states are snapshots from the latest successful checks, including visits moved outside the calendar window. Acknowledging does not restore, edit or recreate visits.</p>
      <p>Client names are from the reviewed creation source. Staff names are from the last loaded schedule; they are not a fresh name lookup.</p>
      <ol>{review.visits.map((row,index)=><li key={row.original.id}>
        <h4>Visit {index+1} · {sameCreationVisit(row.original,row.current)?'Unchanged since creation':'Changed since creation'}</h4>
        {row.original.workerId!==row.current.workerId && <p>Staff assignment changed since creation.</p>}
        <div className="creation-receipt-pair">{(['original','current'] as const).map(kind=><div key={kind}>
          <h5>{kind==='original'?'Original saved creation':'Current accessible schedule'}</h5>
          <dl><dt>Time</dt><dd>{recurrenceReviewLabel(row[kind].start,row[kind].end)}</dd>
            <dt>Status / revision</dt><dd>{row[kind].status} · revision {row[kind].revision}</dd>
            <dt>Assigned staff</dt><dd>{creationStaffLabel(row[kind].workerId,staff)}</dd>
            <dt>Client</dt><dd>{reviewSource?.clientId===row[kind].clientId?reviewSource.clientName:'Client name unavailable'}</dd>
            <dt>Service</dt><dd>{row[kind].service}</dd></dl>
        </div>)}</div>
      </li>)}</ol>
      {!resolved && <button type="button" disabled={busy} onClick={()=>void inspectReceipt(true)}>Acknowledge current outcomes and resolve request</button>}
      {resolved && <button type="button" disabled={busy} onClick={()=>{setReview(null);setResolved(false);setReceiptState('unresolved');void load();}}>Start another visit</button>}
    </section>}
    {busy && pending && <button type="button" onClick={stopCheck}>Stop check and retain request</button>}
    {pending && <div>{pending.command.type==='createSeries'&&!allowRecurrence&&<p>Recurring creation retries are not enabled here. Review or cancel this recovered reservation before starting a single visit.</p>}<p>Confirmed reservations are retained by the shared service across refreshes and reopening. Recover this request before starting another visit.</p>
      <button type="button" disabled={busy||pending.command.type==='createSeries'&&!allowRecurrence} onClick={()=>void execute(pending)}>Retry exact creation request</button>
      {receiptState==='committed' && <button type="button" disabled={busy} onClick={()=>void inspectReceipt()}>Review recorded creation and current visits</button>}
      {receiptState==='unknown' && <p>The outcome is still unknown. Only the exact retained request can establish whether creation was recorded.</p>}
      <button type="button" disabled={busy} onClick={()=>void cancelReservation()}>Cancel creation reservation</button>
      <button type="button" disabled={busy} onClick={()=>void load()}>Recover outstanding creation</button>
      <p>Resolve this request before starting another visit.</p></div>}
    {!access && busy && <p role="status">Checking visit creation access…</p>}
    {access && !access.enabled && <p>Read-only. New shared visits are not enabled here.</p>}
    {!sources && !pending && !busy && !review && <><p>Source details are hidden until current manager access is rechecked. Your draft stays in this open form.</p><button type="button" onClick={()=>void load()}>Reload reviewed sources</button></>}
    {access?.enabled && sources && !pending && <>
      <p>Choose existing recorded client and service readiness. This form shows saved instruction version metadata; instruction content is not available here. Source approval and instruction authoring are maintained outside this workspace.</p>
      {!sources.length?<p>No current reviewed sources are available. A database owner must resolve readiness, saved instructions, service rules or linked inquiry changes before creation.</p>
        :<form onSubmit={submit} onChange={()=>setDirty(true)}><fieldset disabled={busy}>
          <legend>Review source and visit times</legend>
          <label htmlFor={`${id}-source`}>Reviewed client and service</label><select id={`${id}-source`} required value={draft.sourceId} onChange={event=>setDraft(old=>({...old,sourceId:event.target.value}))}>
            <option value="">Choose a reviewed source</option>{sources.map(source=><option key={source.clientId} value={source.clientId}>{source.clientName} · {source.service} · {source.area}</option>)}</select>
          {selected && <div aria-label="Selected scheduling source"><p>{selected.clientName} · {selected.service} · {selected.area}</p>
            <p>Recorded readiness: <time dateTime={selected.confirmedAt}>{selected.confirmedAt.slice(0,16).replace('T',' ')+' UTC'}</time>.</p>
            <p>Saved instructions version {selected.instructionsVersion} · <time dateTime={selected.instructionsSavedAt}>{selected.instructionsSavedAt.slice(0,16).replace('T',' ')+' UTC'}</time>. Contents are not shown.</p>
            <p>{selected.inquiryId?`Linked inquiry · current revision ${selected.inquiryRevision}.`:'No inquiry is linked to this readiness record.'}</p></div>}
          <p>Enter visit times in Vancouver. The server checks the selected source and current dispatch rules again in the creation transaction.</p>
          <label htmlFor={`${id}-start`}>New visit start · Vancouver</label><input id={`${id}-start`} type="datetime-local" step="0.001" required value={draft.start} onChange={event=>setDraft(old=>({...old,start:event.target.value}))}/>
          <label htmlFor={`${id}-end`}>New visit end · Vancouver</label><input id={`${id}-end`} type="datetime-local" step="0.001" required value={draft.end} onChange={event=>setDraft(old=>({...old,end:event.target.value}))}/>
          <label htmlFor={`${id}-worker`}>Initial staff assignment</label><select id={`${id}-worker`} value={draft.workerId} onChange={event=>setDraft(old=>({...old,workerId:event.target.value}))}>
            <option value="">Leave unassigned</option>{staff.map(worker=><option key={worker.id} value={worker.id}>{worker.name}</option>)}</select>
          <p>Roster inclusion does not establish eligibility. Nursing assignment authority is unavailable; a Nursing visit can be left unassigned.</p>
          {recurrenceEnabled && <>
            <label htmlFor={`${id}-repeat`}>Repeat visits</label><select id={`${id}-repeat`} value={draft.repeat} onChange={event=>setDraft(old=>({...old,repeat:event.target.value}))}>
              <option value="none">Once</option><option value="daily">Daily</option><option value="weekly">Weekly</option></select>
            {draft.repeat!=='none' && <><label htmlFor={`${id}-count`}>Number of visits, including the first</label><input id={`${id}-count`} type="number" min="2" max="12" step="1" required value={draft.count} onChange={event=>setDraft(old=>({...old,count:event.target.value}))}/>
              <p>Review every Vancouver occurrence. All visits are saved together after current source, availability and assignment checks. A conflict saves none. Staff accept each assigned visit separately.</p>
              {previewError && <p role="alert">{previewError}</p>}
              {preview.length>0 && <ol aria-label="Recurring visit review">{preview.map((v,i)=><li key={i}>{recurrenceReviewLabel(v.start,v.end)}</li>)}</ol>}
            </>}
          </>}
          <button type="submit" disabled={draft.repeat!=='none'&&(!recurrenceEnabled||preview.length!==Number(draft.count))}>{draft.repeat==='none'?'Create shared visit':`Create ${draft.count} recurring visits`}</button>
        </fieldset></form>}
      <button type="button" disabled={busy} onClick={()=>void load()}>Refresh reviewed sources</button>
    </>}
    <p>Unsubmitted form edits stay in memory. Before any creation is sent, its exact request is reserved with the shared service. Reopening this form recovers the current account’s outstanding request; no client or scheduling details are stored in browser storage.</p>
  </section>;
}
