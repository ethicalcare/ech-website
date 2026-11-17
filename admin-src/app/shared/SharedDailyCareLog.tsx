import {useLayoutEffect,useRef,useState} from 'react';
import type {VisitReport} from './visit-report-client';
import type {CompletedTaskHistory} from './completed-task-history-client';
import {joinedCareLog,type CareLogEvent} from './daily-care-log';
import {activityDayGroups} from './activity-day-groups';
import {taskEventLocalTime} from './visit-task-timeline';
import {ReportActor} from './ReportActor';
export function SharedDailyCareLog({report,load,onFailure}:{report:VisitReport;load:(id:string,revision:number,reportRevision:number,signal:AbortSignal)=>Promise<CompletedTaskHistory>;onFailure:()=>void}){
 const [saved,setSaved]=useState<{report:VisitReport;load:typeof load;value:CompletedTaskHistory}|null>(null),[state,setState]=useState<'loading'|'paused'|'error'|'ready'>('loading');
 const history=saved?.report===report&&saved.load===load?saved.value:null;
 const failure=useRef(onFailure);failure.current=onFailure;
 useLayoutEffect(()=>{let controller:AbortController|undefined;
  const focused=()=>document.visibilityState==='visible'&&document.hasFocus();
  function clear(){controller?.abort();setSaved(null);setState('paused');}
  function check(){clear();if(!focused())return;const request=new AbortController();controller=request;setState('loading');
   load(report.visitId,report.visitRevision,report.reportRevision,request.signal).then(value=>{if(request.signal.aborted||!focused())return;joinedCareLog(report,value);setSaved({report,load,value});setState('ready');}).catch(()=>{if(request.signal.aborted||!focused())return;setSaved(null);setState('error');failure.current();});
  }
  check();document.addEventListener('visibilitychange',check);window.addEventListener('blur',clear);window.addEventListener('focus',check);const timer=window.setInterval(check,60000);
  return()=>{controller?.abort();document.removeEventListener('visibilitychange',check);window.removeEventListener('blur',clear);window.removeEventListener('focus',check);window.clearInterval(timer);};
 },[report,load]);
 const entries=history?joinedCareLog(report,history):null;
 const event=(e:CareLogEvent)=><li key={e.key}><h5>{e.title} · {e.kind==='task'?'Task result':'Report note'} · {e.original?'Original':`Correction · version ${e.version}`}</h5><dl>
  <dt>Event time · Vancouver</dt><dd>{e.eventAt?<time dateTime={e.eventAt}>{taskEventLocalTime(e.eventAt)}</time>:'Not recorded · unknown'}</dd>
  <dt>Recorded at · Vancouver</dt><dd><time dateTime={e.recordedAt}>{taskEventLocalTime(e.recordedAt)}</time></dd>
  <dt>Author</dt><dd><ReportActor report={report} actorId={e.actorId} role={e.role}/></dd>
  <dt>{e.kind==='task'?'Outcome':'Factual summary'}</dt><dd>{e.detail}</dd>
  <dt>Observations</dt><dd>{e.observation||'No observations recorded.'}</dd>
  {e.issue&&<><dt>Issue text</dt><dd>{e.issue}</dd></>}{e.reason&&<><dt>Correction reason</dt><dd>{e.reason}</dd></>}
  {e.sourceRevision!==null&&<><dt>Source content revision</dt><dd>{e.sourceRevision}</dd></>}
 </dl></li>;
 return <section aria-label="Daily care log for this visit"><h3>Daily care log for this visit</h3><p>Authorized task results and report notes, ordered by event time. Originals and corrections remain separate; versions are not additional care events. Report reviews and worked-time approval remain separate. Planned timing is not included.</p>
  {state==='loading'&&<p role="status">Checking completed task history…</p>}{state==='paused'&&<p role="status">Care log is hidden until access is checked again.</p>}{state==='error'&&<p role="alert">Care log access could not be verified.</p>}
  {entries&&<>{history?.resultVisibility==='limited'&&<p>Only your authorized task results are shown; this is not a complete visit or client history.</p>}
   {entries.known.length?activityDayGroups(entries.known,e=>e.eventAt!).map(group=><section key={group.day}><h4>{group.day} · Vancouver</h4><ol>{group.events.map(event)}</ol></section>):<p>No events with known event times are available.</p>}
   {entries.unknown.length>0&&<section><h4>Unknown event time</h4><p>Recording time is not substituted for when care occurred.</p><ol>{entries.unknown.map(event)}</ol></section>}
  </>}
 </section>;
}
