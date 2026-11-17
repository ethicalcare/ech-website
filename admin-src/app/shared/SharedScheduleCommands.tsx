import { type FormEvent, type ReactNode, useId, useLayoutEffect, useRef, useState } from 'react';
import {isScheduleCommand} from '../../../lib/operations/schedule-command-wire.js';
import {ScheduleCommandRejected} from './schedule-command-client';
import { SharedError, type OperationalRole } from './live-model';
import type { ScheduleIdentity, ScheduleVisit } from './schedule-client';
import type { ScheduleCommand, ScheduleCommandAccess, ScheduleCommandClient, SchedulingCommand } from './schedule-command-client';
import { reportLocalTime, reportUtcTime } from './visit-time';
import './shared-schedule-commands.css';

export function SharedScheduleCommands({visit,active,role,staff,client,onConfirmed,onScopeFailure,onLeaveStateChange,onStale,renderReceiptStatus}: {
  visit:ScheduleVisit;active:boolean;role:Exclude<OperationalRole,null>;staff:ScheduleIdentity[];client:ScheduleCommandClient;
  onConfirmed:(visit:ScheduleVisit)=>void;onScopeFailure:(code:string)=>void;
  onLeaveStateChange:(state:{dirty:boolean;pending:boolean;retained?:boolean})=>void;
  onStale:()=>void;
  renderReceiptStatus?: (command:ScheduleCommand)=>ReactNode;
}) {
  const [access,setAccess]=useState<ScheduleCommandAccess|null>(null);
  const [mode,setMode]=useState<SchedulingCommand['type']>(role==='staff'?'confirm':'reschedule');
  const [draft,setDraft]=useState(()=>({workerId:visit.workerId??'',start:reportLocalTime(visit.start),end:reportLocalTime(visit.end),
    reasons:{assign:'',unassign:'',reschedule:'',cancel:'',confirm:''}}));
  const [pending,setPending]=useState<ScheduleCommand|null>(null);
  const [dirty,setDirty]=useState(false);
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState(false),[rejected,setRejected]=useState(false),[retry,setRetry]=useState(0);
  const controller=useRef<AbortController|null>(null),generation=useRef(0),id=useId();
  const outcomeUncertain=useRef(false),mutationOwner=useRef<AbortController|null>(null);
  const confirmed=useRef(onConfirmed);confirmed.current=onConfirmed;
  const scopeFailure=useRef(onScopeFailure);scopeFailure.current=onScopeFailure;
  const leaveChange=useRef(onLeaveStateChange);leaveChange.current=onLeaveStateChange;
  const stale=useRef(onStale);stale.current=onStale;
  const membership=useRef<number|null>(null);
  useLayoutEffect(()=>{leaveChange.current({dirty,pending:!!pending&&!rejected,retained:!!pending});},[pending,dirty,rejected]);
  useLayoutEffect(()=>{
    const current=++generation.current;controller.current?.abort();mutationOwner.current=null;setBusy(false);setAccess(null);
    if(!active)return;
    const request=new AbortController();controller.current=request;
    client.availability(request.signal).then(value=>{
      if(request.signal.aborted || current!==generation.current)return;
      if(membership.current!==null && membership.current!==value.membershipRevision)
        throw new SharedError('scope_changed','Account access changed. Reopen the workspace.');
      membership.current=value.membershipRevision;setAccess(value);
    }).catch(failure=>{
      if(request.signal.aborted || current!==generation.current)return;
      setError(true);setMessage('Schedule command access could not be verified. The draft is retained in this open visit.');
      if(failure instanceof SharedError && ['unauthenticated','scope_changed','conflict','forbidden'].includes(failure.code))scopeFailure.current(failure.code);
    });
    return ()=>{request.abort();controller.current?.abort();};
  },[client,active,visit.id,visit.revision,retry]);
  async function execute(command:ScheduleCommand) {
    if(!active||mutationOwner.current)return;
    controller.current?.abort();const request=new AbortController();mutationOwner.current=request;controller.current=request;const current=generation.current;
    const previouslyUncertain=outcomeUncertain.current;outcomeUncertain.current=true;
    setBusy(true);setError(false);setRejected(false);setMessage('Checking the command receipt and reloading the current shared schedule…');
    try {
      const result=await client.commit(command,request.signal,visit);
      if(request.signal.aborted || current!==generation.current)return;
      const action=command.command.type;
      const nextDraft={workerId:action==='assign'||action==='unassign'?result.visit.workerId??'':draft.workerId,
        start:action==='reschedule'?reportLocalTime(result.visit.start):draft.start,
        end:action==='reschedule'?reportLocalTime(result.visit.end):draft.end,
        reasons:{...draft.reasons,[action]:''}};
      // Saving one action must not remove leave protection for another action's
      // edited fields, even when its reason has not been written yet.
      outcomeUncertain.current=false;setPending(null);setDirty(hasDraft(nextDraft,result.visit));setDraft(nextDraft);
      if(role!=='staff')setMode('reschedule');
      setMessage('Confirmed schedule change. The current shared schedule was rechecked.');confirmed.current(result.visit);
    } catch(failure) {
      if(request.signal.aborted || current!==generation.current)return;
      setError(true);setMessage(failure instanceof SharedError?failure.message:'The change could not be confirmed. The draft and exact request are retained.');
      // Only a first definite transport rejection or local preflight failure
      // permits recovery. Lost/acknowledged outcomes and any earlier uncertainty
      // retain the exact request even if a later attempt is rejected.
      const neverSent=!previouslyUncertain && (failure instanceof ScheduleCommandRejected || failure instanceof SharedError && failure.code==='invalid_local_request');
      outcomeUncertain.current=!neverSent;setRejected(neverSent);
      if(failure instanceof SharedError && ['schedule_conflict','stale_visit','write_unconfirmed'].includes(failure.code))stale.current();
      if(failure instanceof SharedError && ['unauthenticated','scope_changed'].includes(failure.code))scopeFailure.current(failure.code);
    } finally {if(mutationOwner.current===request)mutationOwner.current=null;if(!request.signal.aborted && current===generation.current)setBusy(false);}
  }
  async function reconcile() {
    if(outcomeUncertain.current || pending && !rejected)return;
    controller.current?.abort();const request=new AbortController();controller.current=request;const current=generation.current;
    setBusy(true);setError(false);
    try {
      const membershipRevision=pending?.membershipRevision??membership.current;
      if(!membershipRevision)throw new SharedError('scope_changed','Current schedule access could not be confirmed.');
      const next=await client.reload(visit,request.signal,membershipRevision);
      if(request.signal.aborted || current!==generation.current)return;
      setPending(null);setRejected(false);setMessage('Current visit reloaded. Your draft is retained. Compare it with the current visit before sending a new request.');confirmed.current(next);setRetry(value=>value+1);
      if(role!=='staff' && (mode==='unassign'&&!next.workerId || mode==='confirm'&&next.status!=='Assigned'))setMode('reschedule');
    } catch(failure) {
      if(request.signal.aborted || current!==generation.current)return;
      setError(true);setMessage('The current visit could not be reloaded. Your draft and exact request are retained.');
      if(failure instanceof SharedError && ['unauthenticated','scope_changed','forbidden','conflict'].includes(failure.code))scopeFailure.current(failure.code);
    } finally {if(!request.signal.aborted && current===generation.current)setBusy(false);}
  }
  function hasDraft(value:typeof draft,current:ScheduleVisit) {
    return Object.values(value.reasons).some(reason=>reason.trim().length>0)
      || value.workerId!==(current.workerId??'')
      || value.start!==reportLocalTime(current.start)
      || value.end!==reportLocalTime(current.end);
  }
  function discardActionDraft() {
    if(!active||role==='staff'||pending||busy||mutationOwner.current)return;
    const next={...draft,reasons:{...draft.reasons,[mode]:''},
      ...(mode==='assign'?{workerId:visit.workerId??''}:{}),
      ...(mode==='reschedule'?{start:reportLocalTime(visit.start),end:reportLocalTime(visit.end)}:{})};
    setDraft(next);setDirty(hasDraft(next,visit));setError(false);
    setMessage('Unsubmitted edits for this action were discarded. Other action drafts are unchanged. No shared visit was changed.');
  }
  function submit(event:FormEvent) {
    // Synchronous ownership fences repeat events before disabled state renders.
    event.preventDefault();if(!active || mutationOwner.current || !access || pending || busy)return;
    if(mode==='confirm' && role!=='staff'){setMode('reschedule');setError(true);setMessage('This manager view waits for the assigned worker to confirm. No confirmation request was sent.');return;}
    let command:SchedulingCommand;
    try {
      command=mode==='confirm'?{type:'confirm'}:mode==='assign'?{type:'assign',workerId:draft.workerId,reason:draft.reasons.assign}
        :mode==='reschedule'?{type:'reschedule',start:reportUtcTime(draft.start),end:reportUtcTime(draft.end),reason:draft.reasons.reschedule}
          :{type:mode,reason:draft.reasons[mode]};
    } catch(failure) {setError(true);setMessage(failure instanceof Error?failure.message:'Check the Vancouver visit times.');return;}
    const request=Object.freeze({schema:1 as const,operationId:crypto.randomUUID(),visitId:visit.id,visitRevision:visit.revision,
      membershipRevision:access.membershipRevision,command:Object.freeze(command)});
    // Local validation has not sent a request. Keep the form editable rather
    // than treating invalid input as an unresolved or rejected server action.
    if(!isScheduleCommand(request)){
      setError(true);setMessage('Check the proposed times, staff selection and operational reason. The end must be after the start; choose a staff member for assignment and enter a reason of 3–500 characters without line breaks or control characters. No request was sent. Your draft is still editable.');return;
    }
    outcomeUncertain.current=false;leaveChange.current({dirty,pending:true});setPending(request);void execute(request);
  }
  const retained=pending && <div><p>Your draft and exact request are retained while this visit stays open.</p>
    {active && access?.enabled && renderReceiptStatus?.(pending)}
    <button type="button" disabled={busy} onClick={()=>void execute(pending)}>Retry exact schedule request</button>
    {rejected && <button type="button" disabled={busy} onClick={()=>void reconcile()}>{role==='staff'?'Discard rejected confirmation and reload':'Keep schedule draft and reload'}</button>}
  </div>;
  if(!active)return pending||dirty?<section className="shared-schedule-commands" aria-label="Retained schedule request">
    <p>Visit details are hidden while current access is checked. Your schedule draft is retained.</p>
    {message && <p role={error?'alert':'status'}>{message}</p>}{retained}
    {!pending && <button type="button" disabled={busy} onClick={()=>void reconcile()}>{role==='staff'?'Discard rejected confirmation and reload':'Keep schedule draft and reload'}</button>}
  </section>:null;
  const manager=role==='manager'||role==='owner',editable=['Open','Assigned','Confirmed'].includes(visit.status);
  return <section className="shared-schedule-commands" aria-labelledby={`${id}-heading`}>
    <h3 id={`${id}-heading`}>Schedule changes</h3>
    {message && <p role={error?'alert':'status'} className="shared-visit-report__wording">{message}</p>}
    {!access && <><p role="status">Checking schedule command availability…</p><button type="button" onClick={()=>setRetry(value=>value+1)}>Retry schedule command access</button></>}
    {access && !access.enabled && <p>Read-only. Schedule changes and assignment confirmation are not enabled here.</p>}
    {access?.enabled && <>
      {retained}
      {manager && visit.status==='Assigned' && <p role="status">Waiting for the assigned worker to confirm this visit. Managers can review or change the assignment; this view does not confirm on the worker’s behalf.</p>}
      {editable && (manager || visit.status==='Assigned') && <form onSubmit={submit} onChange={event=>{if(event?.target && (event.target as HTMLElement).id===`${id}-action`)return;leaveChange.current({dirty:true,pending:!!pending});setDirty(true);}}><fieldset disabled={busy||!!pending}>
        <legend>{manager?'Change this visit':'Confirm your assigned visit'}</legend>
        {manager && <><label htmlFor={`${id}-action`}>Action</label><select id={`${id}-action`} value={mode} onChange={event=>setMode(event.target.value as SchedulingCommand['type'])}>
          <option value="reschedule">Reschedule</option><option value="assign">Assign or reassign staff</option>
          {visit.workerId && <option value="unassign">Remove assignment</option>}<option value="cancel">Cancel visit</option>

        </select></>}
        {mode==='assign' && <><label htmlFor={`${id}-worker`}>Staff member</label><select id={`${id}-worker`} required value={draft.workerId} onChange={event=>setDraft(old=>({...old,workerId:event.target.value}))}>
          <option value="">Choose staff</option>{staff.map(worker=><option key={worker.id} value={worker.id}>{worker.name}</option>)}</select>
          <p>The roster labels staff; it does not establish eligibility. The server checks current service qualification, credentials, availability, overlap and travel rules.</p></>}
        {mode==='reschedule' && <><p>Enter the proposed visit times in Vancouver. Changing the time removes any previous confirmation.</p>
          <label htmlFor={`${id}-start`}>Proposed start · Vancouver</label><input id={`${id}-start`} type="datetime-local" step="0.001" required value={draft.start} onChange={event=>setDraft(old=>({...old,start:event.target.value}))}/>
          <label htmlFor={`${id}-end`}>Proposed end · Vancouver</label><input id={`${id}-end`} type="datetime-local" step="0.001" required value={draft.end} onChange={event=>setDraft(old=>({...old,end:event.target.value}))}/></>}
        {mode==='confirm'?<p>Confirming means you acknowledge this assignment. Only the currently assigned worker can confirm. This records no attendance or worked time.</p>
          :<><label htmlFor={`${id}-reason`}>Operational reason</label><textarea id={`${id}-reason`} required minLength={3} maxLength={500} value={draft.reasons[mode]} onChange={event=>setDraft(old=>({...old,reasons:{...old.reasons,[mode]:event.target.value}}))}/></>}
        {mode==='cancel' && <p>This cancels the visit and preserves its history.</p>}
        <button type="submit">{mode==='confirm'?'Confirm assignment':'Save schedule change'}</button>
        {manager&&<button type="button" onClick={discardActionDraft}>Discard this action's draft</button>}
        {manager&&<p>Discard clears only this action’s unsubmitted edits. It does not cancel a visit, undo a saved change or discard an unresolved request.</p>}
      </fieldset></form>}
      {!editable && <p>This visit is {visit.status.toLowerCase()}. Scheduling changes are unavailable for this status.</p>}
      {manager && <p>Managers can use New shared visit in the schedule to select existing recorded readiness and saved instruction version metadata. Source authoring and instruction content are unavailable here.</p>}
      <p>Drafts stay in memory while this visit remains open. Closing the visit or changing account clears them. Nursing assignment authority is unavailable.</p>
    </>}
  </section>;
}
