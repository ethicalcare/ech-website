import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { SharedError, type OperationalRole } from './live-model';
import { reportLocalTime } from './visit-time';
import { taskEventLocalTime } from './visit-task-timeline';
import { sameTaskResultInstant, taskResultActualTime } from './task-result-time';
import { type createVisitTaskClient, type VisitTaskRead, type VisitTaskWrite, type VisitTaskOutcome, type VisitTaskResult } from './visit-task-client';
import { SharedVisitTaskTimeline } from './SharedVisitTaskTimeline';
import './shared-visit-task-results.css';

type Draft = {taskId:string;expectedVersion:number;visitRevision:number;outcome:VisitTaskOutcome|'';observation:string;actualAt:string;originalActualAt?:string;reason:string};
type Entries = {draft:Draft|null;pending:VisitTaskWrite|null};
// Only entered drafts/exact requests, never loaded protected task histories.
// Caller clears these when the authenticated session is replaced or signed out.
const retained=new Map<string,Entries>();
export function clearVisitTaskResultEntries(){retained.clear();}
// A new membership must never hide an uncertain request stored under an earlier one.
export function hasUnresolvedTaskMembership(scopeKey:string,visitId:string,role:Exclude<OperationalRole,null>,actorId:string,membershipRevision:number){
  for(const [key,entry] of retained){const [actor,scope,visit,entryRole,revision]=JSON.parse(key);if(actor===actorId&&scope===scopeKey&&visit===visitId&&entryRole===role&&revision!==membershipRevision&&entry.pending)return true;}
  return false;
}
export function discardUnsentVisitTaskDraft(scopeKey:string,visitId:string,role:Exclude<OperationalRole,null>,membershipRevision:number,actorId:string){
  const key=JSON.stringify([actorId,scopeKey,visitId,role,membershipRevision]),entry=retained.get(key);
  if(entry && !entry.pending)retained.delete(key);
}
type Props={enabled?:boolean;actorId:string;scopeKey:string;visitId:string;visitRevision:number;visitStatus:string;membershipRevision:number;
  role:Exclude<OperationalRole,null>;active:boolean;client:ReturnType<typeof createVisitTaskClient>;
  onScopeFailure:(code:string)=>void;onStale:()=>void;onLeaveStateChange?:(state:{dirty:boolean;pending:boolean})=>void;
  onPlanChange?:(plan:VisitTaskRead|null)=>void; refreshKey?:number; mutationsBlocked?:boolean;
};
const labels:Record<VisitTaskOutcome,string>={done:'Done',declined:'Declined',unable:'Unable', 'not-required':'Not required'};
function displayTime(value:string){return taskEventLocalTime(value)+' Vancouver';}
export function SharedVisitTaskResults(props:Props){return <TaskResultsBody key={`${props.actorId}:${props.scopeKey}:${props.visitId}:${props.role}:${props.membershipRevision}:${props.visitRevision}:${props.active}:${props.enabled===true}`} {...props}/>;}
function TaskResultsBody({enabled=false,actorId,scopeKey,visitId,visitRevision,visitStatus,membershipRevision,role,active,client,onScopeFailure,onStale,onLeaveStateChange,onPlanChange,refreshKey=0,mutationsBlocked=false}:Props){
  const scope=JSON.stringify([actorId,scopeKey,visitId,role,membershipRevision]);
  const [data,setData]=useState<VisitTaskRead|null>(null);
  const [draft,setDraft]=useState<Draft|null>(()=>retained.get(scope)?.draft??null);
  const [pending,setPending]=useState<VisitTaskWrite|null>(()=>retained.get(scope)?.pending??null);
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[failure,setFailure]=useState(false),[reload,setReload]=useState(0);
  const controller=useRef<AbortController|null>(null),generation=useRef(0),lock=useRef(false),id=useId();
  const editorHeading=useRef<HTMLLegendElement|null>(null);
  const taskButtons=useRef(new Map<string,HTMLButtonElement>());
  const focusedTask=useRef<string|null>(null);
  const permitted=enabled&&active&&!['Completed','Cancelled'].includes(visitStatus);
  const writable=permitted&&!mutationsBlocked&&role==='staff'&&visitStatus==='In progress';
  useEffect(()=>{
    if(!active||!permitted)return;
    if(draft){
      focusedTask.current=draft.taskId;
      editorHeading.current?.focus();
    }else if(focusedTask.current){
      // After discard or confirmed save, return to the task that opened the
      // editor. Never move focus on each keystroke or while retrying a write.
      const button=taskButtons.current.get(focusedTask.current);
      focusedTask.current=null;
      if(button&&!button.disabled)button.focus();
    }
  },[draft?.taskId,active,permitted]);
  const callbacks=useRef({onScopeFailure,onStale,onLeaveStateChange});callbacks.current={onScopeFailure,onStale,onLeaveStateChange};
  const planCallback=useRef(onPlanChange);planCallback.current=onPlanChange;
  useEffect(()=>{planCallback.current?.(data);return()=>planCallback.current?.(null);},[data]);
  const latest=(taskId:string)=>data?.results.filter(r=>r.taskId===taskId).at(-1);
  const selectedLatest=draft?latest(draft.taskId):undefined;
  const stale=!!draft&&(draft.visitRevision!==visitRevision||(selectedLatest?.version??0)!==draft.expectedVersion);
  useEffect(()=>{
    if(draft||pending)retained.set(scope,{draft,pending});else retained.delete(scope);
    callbacks.current.onLeaveStateChange?.({dirty:!!draft,pending:!!pending});
    if(!draft&&!pending)return;
    const warn=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue='';};window.addEventListener('beforeunload',warn);
    return()=>window.removeEventListener('beforeunload',warn);
  },[scope,draft,pending]);
  function fail(error:unknown){setFailure(true);setMessage(error instanceof Error?error.message:'Task records could not be verified. Entries are retained.');
    if(error instanceof SharedError&&error.code==='stale_visit'){
      generation.current++;controller.current?.abort();setData(null);callbacks.current.onStale();return;
    }
    if(error instanceof SharedError&&['unauthenticated','forbidden','scope_changed'].includes(error.code)){setData(null);callbacks.current.onScopeFailure(error.code);}}
  useEffect(()=>{
    const gen=++generation.current;controller.current?.abort();setData(null);setBusy(false);lock.current=false;
    if(!permitted)return;
    const request=new AbortController();controller.current=request;setBusy(true);
    client.load(visitId,visitRevision,membershipRevision,request.signal).then(value=>{if(!request.signal.aborted&&generation.current===gen)setData(value);})
      .catch(error=>{if(!request.signal.aborted&&generation.current===gen)fail(error);})
      .finally(()=>{if(!request.signal.aborted&&generation.current===gen)setBusy(false);});
    return()=>{request.abort();controller.current?.abort();generation.current++;};
  },[client,permitted,visitId,visitRevision,membershipRevision,reload,refreshKey]);
  function edit(taskId:string){
    if(!writable||pending||busy||draft)return;
    const result=latest(taskId);
    setDraft({taskId,expectedVersion:result?.version??0,visitRevision,outcome:result?.outcome??'',observation:result?.observation??'',actualAt:result?reportLocalTime(result.actualAt):'',originalActualAt:result?.actualAt,reason:''});
    setMessage('');setFailure(false);
  }
  async function execute(request:VisitTaskWrite){
    if(!writable||!data||busy||lock.current||request.visitRevision!==visitRevision||request.membershipRevision!==membershipRevision)return;
    lock.current=true;setBusy(true);setFailure(false);setMessage('Saving the exact task result…');
    const abort=new AbortController();controller.current=abort;const gen=generation.current;
    const valid=()=>!abort.signal.aborted&&generation.current===gen;
    try{
      const receipt=await client.save(request,abort.signal);if(!valid())return;
      const snapshot=await client.load(visitId,visitRevision,membershipRevision,abort.signal);if(!valid())return;
      const result=snapshot.results.find(r=>r.taskId===request.taskId&&r.version===receipt.version);
      if(!result||result.actorId!==actorId||result.outcome!==request.outcome||result.observation!==request.observation||!sameTaskResultInstant(result.actualAt,request.actualAt)||result.reason!==request.reason||!sameTaskResultInstant(result.recordedAt,receipt.recordedAt))throw new SharedError('write_unconfirmed','A receipt was returned but the exact saved task result could not be matched. Keep this request and retry.');
      setData(snapshot);setPending(null);setDraft(null);retained.delete(scope);setMessage(`Task result version ${receipt.version} saved and read back. The visit plan and time approval are unchanged.`);
    }catch(error){if(valid()){
      // Only this local preflight error is proven to precede transport. Any
      // server response or interrupted request keeps its exact operation ID.
      if(error instanceof SharedError && error.code==='invalid_local_request'){
        setPending(null);retained.set(scope,{draft,pending:null});
        callbacks.current.onLeaveStateChange?.({dirty:!!draft,pending:false});
      }
      fail(error);
    }}finally{if(valid()){lock.current=false;setBusy(false);}}
  }
  function submit(e:FormEvent){
    e.preventDefault();if(!draft||!writable||pending||busy||stale||!draft.outcome)return;
    try{
      const request:VisitTaskWrite={visitId,visitRevision,membershipRevision,taskId:draft.taskId,expectedVersion:draft.expectedVersion,operationId:crypto.randomUUID(),outcome:draft.outcome,observation:draft.observation,actualAt:taskResultActualTime(draft.actualAt,draft.originalActualAt),reason:draft.expectedVersion?draft.reason:null};
      if(request.expectedVersion&&draft.reason.trim().length<3)throw new Error('Explain the correction in at least three characters.');
      retained.set(scope,{draft,pending:request});callbacks.current.onLeaveStateChange?.({dirty:true,pending:true});setPending(request);void execute(request);
    }catch(error){fail(error);}
  }
  function history(result:VisitTaskResult){return <dl className="visit-task-results__facts"><dt>Outcome</dt><dd>{labels[result.outcome]}</dd><dt>Observation</dt><dd>{result.observation||'No observation recorded.'}</dd><dt>Actual event time</dt><dd><time dateTime={result.actualAt}>{displayTime(result.actualAt)}</time></dd><dt>Recorded at</dt><dd><time dateTime={result.recordedAt}>{displayTime(result.recordedAt)}</time></dd><dt>Author identifier</dt><dd>{result.actorId}</dd>{result.reason&&<><dt>Correction reason</dt><dd>{result.reason}</dd></>}</dl>;}
  if(!active||!enabled)return null;
  return <section className="visit-task-results" aria-label="Visit task results" aria-busy={busy}>
    <h3>Visit tasks and results</h3>
    {data?.plan!=null&&<p>This task plan is saved for this visit. A newer client plan does not replace it.</p>}
    <p>Results are recorded separately. Missing or unavailable result information does not establish missed care. Recording a result does not approve worked time.</p>
    {!permitted?<p>Task history for completed or cancelled visits is unavailable in the current access contract.</p>:<>
      {message&&<p role={failure?'alert':'status'}>{message}</p>}
      <button type="button" disabled={busy} onClick={()=>setReload(n=>n+1)}>Reload task records</button>
      {!data&&<p>{busy?'Loading authorized task records…':'Task records are not available. No care outcome is inferred.'}</p>}
      {data?.plan===null&&<p>No structured plan is attached to this visit. This does not mean care was missed or completed.</p>}
      {data?.plan?.length===0&&<p>The saved plan contains no categories.</p>}
      {data && <SharedVisitTaskTimeline snapshot={data} />}
      {data?.plan?.map(category=><section key={category.id} aria-label={category.label}><h4>{category.label}</h4>
        <ol>{[...category.tasks.map(task=>({...task,addition:false})),...data.additions.filter(a=>a.categoryId===category.id).map(a=>({id:a.taskId,text:a.text,addition:true}))].map(task=>{
          const results=data.results.filter(r=>r.taskId===task.id),result=results.at(-1);
          return <li key={task.id}><h5>{task.text}</h5>{task.addition&&<p>Visit-only addition; original plan unchanged.</p>}
            {result?<><p>Latest visible result · version {result.version}</p>{history(result)}</>:<p>{data.resultVisibility==='complete' ? 'Not recorded. This does not establish missed care.' : 'Result unavailable or unknown in this account’s permitted view. No care outcome is inferred.'}</p>}
            {results.length>1&&<details><summary>Earlier result versions ({results.length-1})</summary>{results.slice(0,-1).map(r=><section key={r.version}><h6>Version {r.version}</h6>{history(r)}</section>)}</details>}
            {writable&&<button ref={element=>{if(element)taskButtons.current.set(task.id,element);else taskButtons.current.delete(task.id);}} type="button" disabled={busy||!!pending||!!draft} onClick={()=>edit(task.id)}>{result?'Correct my visible result':'Record my factual result'}</button>}
          </li>;
        })}</ol>
      </section>)}
      {draft&&<form onSubmit={submit} aria-label="Task result editor"><fieldset disabled={busy||!!pending||stale||!writable||!data}><legend ref={editorHeading} tabIndex={-1}>{draft.expectedVersion?`Correction to version ${draft.expectedVersion}`:'Record factual task result'}</legend>
        <p>{data?.plan?.flatMap(c=>c.tasks).find(t=>t.id===draft.taskId)?.text||data?.additions.find(a=>a.taskId===draft.taskId)?.text}</p>
        <label htmlFor={`${id}-outcome`}>Outcome<select id={`${id}-outcome`} required value={draft.outcome} onChange={e=>setDraft({...draft,outcome:e.target.value as VisitTaskOutcome})}><option value="" disabled>Choose actual outcome</option>{Object.entries(labels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
        <label htmlFor={`${id}-observation`}>Factual observation<textarea id={`${id}-observation`} rows={3} maxLength={3000} value={draft.observation} onChange={e=>setDraft({...draft,observation:e.target.value})}/></label>
        <label htmlFor={`${id}-time`}>Actual event date/time · Vancouver<input id={`${id}-time`} type="datetime-local" step="0.001" required value={draft.actualAt} onChange={e=>setDraft({...draft,actualAt:e.target.value})}/></label>
        {draft.expectedVersion>0&&<label htmlFor={`${id}-reason`}>Reason for correction<textarea id={`${id}-reason`} required minLength={3} maxLength={500} value={draft.reason} onChange={e=>setDraft({...draft,reason:e.target.value})}/></label>}
        <p>Earlier versions stay in history. The server rechecks assignment, current access and the latest result before saving.</p><button type="submit">{draft.expectedVersion?'Save correction':'Save task result'}</button>
      </fieldset>{!pending&&<button type="button" disabled={busy} onClick={()=>{setDraft(null);setMessage('Unsent task draft discarded. Saved results are unchanged.');}}>Discard unsent draft</button>}{stale&&<p role="alert">The visit or latest visible result changed. This draft has not been retargeted. Review the current record before preparing a new draft.</p>}</form>}
    </>}
    {pending&&<aside aria-label="Retained task request"><p>An exact task-result request is retained. Retry uses the same operation identifier and fields, never a replacement request.</p><button type="button" disabled={!writable||!data||busy||pending.visitRevision!==visitRevision} onClick={()=>void execute(pending)}>Retry exact task result</button>{pending.visitRevision!==visitRevision&&<p>The visit revision changed. Retain this request for reconciliation; it cannot be replayed against a different revision.</p>}</aside>}
  </section>;
}
