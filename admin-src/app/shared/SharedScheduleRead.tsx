'use client';
import {ScheduleStaffFilter,type ScheduleStaffSelection} from './ScheduleStaffFilter';
import {calendarDays,calendarReadWindow,visitsOnDay,calendarWeekday,calendarWeekdays,type CalendarView} from './schedule-calendar';
import './shared-schedule-calendar.css';
import {scheduleDay,scheduleLabel} from './schedule-window';
import {useCallback,useEffect,useMemo,useState,useRef,useLayoutEffect} from 'react';
import {SharedScheduleCreate} from './SharedScheduleCreate';
import {createScheduleCreateClient} from './schedule-create-client';
import {SharedVisitRead} from './SharedVisitRead';
import type {VisitLeaveState} from './SharedVisitActions';
import type {Session} from './live-model';
import {operationsFeatures,operationsFeatureScope} from './operations-features';
import {createScheduleClient,type ScheduleSnapshot} from './schedule-client';

// The keyed child owns every request and all protected state. Changing account,
// role or negotiated features destroys it rather than reusing prior rows.
export function SharedScheduleRead({session,fetcher=fetch,active=true}:{session:Session|null;fetcher?:typeof fetch;active?:boolean}){
 if(!session?.authenticated || !operationsFeatures(session).reads || !session.principal.operationalRole)return null;
 return <ScheduleRows key={operationsFeatureScope(session)} scope={operationsFeatureScope(session)} tasksEnabled={operationsFeatures(session).taskResults===true} actor={session.principal.id} role={session.principal.operationalRole} fetcher={fetcher} active={active} recurrenceEnabled={operationsFeatures(session).scheduleRecurrence} schedulingEnabled={operationsFeatures(session).scheduleCommands} actionsEnabled={operationsFeatures(session).visitActions}/>;
}
function ScheduleRows({scope,tasksEnabled,actor,role,fetcher,active,schedulingEnabled,actionsEnabled,recurrenceEnabled}:{scope:string;tasksEnabled:boolean;actor:string;role:'owner'|'manager'|'staff';fetcher:typeof fetch;active:boolean;schedulingEnabled:boolean;actionsEnabled:boolean;recurrenceEnabled:boolean}){
 const visitButtons=useRef(new Map<string,HTMLButtonElement>());
 const origin=useRef<string|null>(null);
 const returnFocus=useRef<string|null>(null);
 const scheduleHeading=useRef<HTMLHeadingElement|null>(null);
 const [staffFilter,setStaffFilter]=useState<ScheduleStaffSelection>({ids:null,unassigned:true,query:''});
 const [view,setView]=useState<CalendarView>('week');
 const [day,setDay]=useState(()=>scheduleDay(new Date().toISOString()));
 const [createOpen,setCreateOpen]=useState(false),[creationHeld,setCreationHeld]=useState(false);
 const [creationStaff,setCreationStaff]=useState<import('./schedule-client').ScheduleIdentity[]>([]);
 const createClient=useMemo(()=>role==='staff'?null:createScheduleCreateClient(fetcher,actor,role),[fetcher,actor,role]);
 const creationConfirmed=useCallback(()=>setReload(value=>value+1),[]);
 const [leave,setLeave]=useState<VisitLeaveState>({dirty:false,pending:false});
 const canLeave=()=>!leave.pending&&(!(leave.dirty||leave.retained)||window.confirm('Discard the unsaved visit draft and retained request?'));
 const close=()=>{if(canLeave()){returnFocus.current=origin.current;setSelected(null);setLeave({dirty:false,pending:false});}};
 const invalidate=useCallback(()=>{setCreateOpen(false);setCreationHeld(false);setSelected(null);setLeave({dirty:false,pending:false});setReload(value=>value+1);},[]);
 const confirmed=useCallback((visit:import('./schedule-client').ScheduleVisit)=>{setState(current=>current.snapshot?{...current,snapshot:{...current.snapshot,visits:current.snapshot.visits.map(row=>row.id===visit.id?visit:row)}}:current);setSelected({id:visit.id,revision:visit.revision});},[]);
 useEffect(()=>{if(typeof window==='undefined')return;const warn=(event:BeforeUnloadEvent)=>{if(creationHeld||leave.dirty||leave.pending||leave.retained){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[leave,creationHeld]);
 const [selected,setSelected]=useState<{id:string;revision:number}|null>(null);
 useLayoutEffect(()=>{if(selected===null&&active&&returnFocus.current){const button=visitButtons.current.get(returnFocus.current);returnFocus.current=null;if(button&&!button.disabled)button.focus();else scheduleHeading.current?.focus();}},[selected,active]);
 const [reload,setReload]=useState(0);
 const [state,setState]=useState<{request:string;snapshot?:ScheduleSnapshot;error?:string}>({request:''});
 const client=useMemo(()=>createScheduleClient(fetcher,role,actor),[fetcher,role,actor]);
 const request=day+':'+reload;
 useEffect(()=>{
  const controller=new AbortController();let current=true;
  setState({request});
  let window;try{window=calendarReadWindow(day);}catch{setState({request,error:'Choose a valid date.'});return()=>{current=false;controller.abort();};}
  void client.loadSchedule(window,controller.signal).then(snapshot=>{
   if(current&&!controller.signal.aborted)setState({request,snapshot});
  }).catch(()=>{if(current&&!controller.signal.aborted)setState({request,error:'Schedule could not be verified. Reload to try again.'});});
  return()=>{current=false;controller.abort();};
 },[client,day,reload,request]);
 const visible=state.request===request?state:undefined;
 const data=visible?.snapshot;
 const selectedVisit=data?.visits.find(visit=>visit.id===selected?.id&&visit.revision===selected.revision);
 const filteredVisits=data?.visits.filter(visit=>visit.workerId===null?staffFilter.unassigned:staffFilter.ids===null||staffFilter.ids.includes(visit.workerId))??[];
 const days=useMemo(()=>{try{return calendarDays(day,view);}catch{return [];}},[day,view]);
 const shownVisits=filteredVisits.filter(visit=>days.some(date=>visitsOnDay([visit],date).length>0));
 const clients=new Map(data?.clients.map(row=>[row.id,row.name]));
 const staff=new Map(data?.staff.map(row=>[row.id,row.name]));
 return <section className="panel dashboard-card" aria-label="Shared schedule">
  <h2 ref={scheduleHeading} tabIndex={-1}>Shared visit schedule</h2><p>Read-only shared records. Times shown in Vancouver time. No changes are saved from this view.</p>
  <label>Calendar date (Vancouver)<input type="date" value={day} disabled={leave.pending||createOpen} onChange={event=>{if(canLeave()){setLeave({dirty:false,pending:false});setSelected(null);setDay(event.currentTarget.value);}}}/></label>
  <div role="group" aria-label="Calendar view">{(['day','week','month'] as const).map(mode=><button key={mode} type="button" aria-pressed={view===mode} onClick={()=>setView(mode)}>{mode[0].toUpperCase()+mode.slice(1)}</button>)}<button type="button" disabled={leave.pending||createOpen} onClick={()=>{const today=scheduleDay(new Date().toISOString());if(today!==day&&canLeave()){setLeave({dirty:false,pending:false});setSelected(null);setDay(today);}}}>Today</button></div>
  <button type="button" disabled={leave.pending||createOpen} onClick={()=>{if(canLeave()){setLeave({dirty:false,pending:false});setSelected(null);setReload(value=>value+1);}}}>Reload schedule</button>
  {createClient&&schedulingEnabled&&!createOpen&&<button type="button" disabled={!data||leave.pending} onClick={()=>{if(canLeave()){setSelected(null);setLeave({dirty:false,pending:false});setCreationStaff(data?.staff??[]);setCreateOpen(true);}}}>New shared visit</button>}
  {createOpen&&createClient&&<><button type="button" onClick={()=>{if(!creationHeld||window.confirm('Close this creation form? Unsubmitted edits will be lost. Reserved requests must be recovered when you reopen.')){setCreateOpen(false);setCreationHeld(false);}}}>Close creation form</button><SharedScheduleCreate client={createClient} allowRecurrence={recurrenceEnabled} staff={creationStaff} active={active} onConfirmed={creationConfirmed} onScopeFailure={invalidate} onPendingChange={setCreationHeld}/></>}
  {!visible?.error&&!data&&<p role="status">Loading schedule…</p>}
  {visible?.error&&<p role="alert">{visible.error}</p>}
  <ScheduleStaffFilter staff={data?.staff??[]} value={staffFilter} onChange={setStaffFilter} disabled={!data||createOpen}/>
  {data&&!createOpen&&!leave.pending&&!leave.retained&&<><p>{shownVisits.length} visits shown in the selected {view} view. Dates and original visit times are Vancouver local time.</p>{!data.visits.length&&<p>No visits returned for this account and window.</p>}
  {data.visits.length>0&&!shownVisits.length&&<p>No visits match the staff selection. Change the filter to show other permitted visits.</p>}
  <div className="shared-schedule-calendar" data-view={view} role="region" aria-label="Visit calendar" tabIndex={0}>
   <div className="shared-schedule-calendar__days" style={{'--calendar-columns':view==='day'?1:7} as import('react').CSSProperties}>
   {view==='month'&&calendarWeekdays.map(name=><div key={name} className="shared-schedule-calendar__weekday" aria-hidden="true">{name}</div>)}
   {days.map((date,index)=><section key={date} className="shared-schedule-calendar__day" style={view==='month'&&index===0?{gridColumnStart:calendarWeekday(date)+1}:undefined} aria-label={date}><h3>{date} · {calendarWeekdays[calendarWeekday(date)]}</h3>{!visitsOnDay(filteredVisits,date).length&&<p className="shared-schedule-calendar__empty">No visible visits</p>}<ul>{visitsOnDay(filteredVisits,date).map(visit=><li key={visit.id}><strong>{clients.get(visit.clientId)}</strong><p>{visit.service} · {visit.status}</p><p>{scheduleLabel(visit.start)} to {scheduleLabel(visit.end)}</p><p>{visit.workerId?staff.get(visit.workerId):'Unassigned'}</p><button ref={element=>{if(element)visitButtons.current.set(visit.id+':'+date,element);else visitButtons.current.delete(visit.id+':'+date);}} type="button" disabled={leave.pending||createOpen} onClick={()=>{if(selected?.id===visit.id&&selected.revision===visit.revision)return;if(canLeave()){origin.current=visit.id+':'+date;setLeave({dirty:false,pending:false});setSelected({id:visit.id,revision:visit.revision});}}}>View visit details for {clients.get(visit.clientId)}</button></li>)}</ul></section>)}
   </div>
  </div></>}
  {(leave.pending||leave.retained)&&<p role="status">A visit request is retained. Prior schedule rows and visit details are hidden until its result is verified.</p>}
  {selectedVisit&&!shownVisits.some(visit=>visit.id===selectedVisit.id)&&<p>The selected visit is outside the current staff filter or calendar view. Its details and drafts remain open.</p>}
  {selectedVisit&&<SharedVisitRead key={selectedVisit.id} scope={scope} tasksEnabled={tasksEnabled} actor={actor} role={role} staff={data?.staff} visit={selectedVisit} fetcher={fetcher} onClose={close} onVerificationFailure={invalidate} active={active} schedulingEnabled={schedulingEnabled} actionsEnabled={actionsEnabled} onConfirmed={confirmed} onLeaveStateChange={setLeave}/>}
 </section>;
}
