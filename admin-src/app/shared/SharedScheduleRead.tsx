'use client';
import {useEffect,useMemo,useState} from 'react';
import type {Session} from './live-model';
import {operationsFeatures,operationsFeatureScope} from './operations-features';
import {createScheduleClient,type ScheduleSnapshot} from './schedule-client';

// The keyed child owns every request and all protected state. Changing account,
// role or negotiated features destroys it rather than reusing prior rows.
export function SharedScheduleRead({session,fetcher=fetch}:{session:Session|null;fetcher?:typeof fetch}){
 if(!session?.authenticated || !operationsFeatures(session).reads || !session.principal.operationalRole)return null;
 return <ScheduleRows key={operationsFeatureScope(session)} actor={session.principal.id} role={session.principal.operationalRole} fetcher={fetcher}/>;
}
function ScheduleRows({actor,role,fetcher}:{actor:string;role:'owner'|'manager'|'staff';fetcher:typeof fetch}){
 const [day,setDay]=useState(()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Vancouver',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()));
 const [reload,setReload]=useState(0);
 const [state,setState]=useState<{request:string;snapshot?:ScheduleSnapshot;error?:string}>({request:''});
 const client=useMemo(()=>createScheduleClient(fetcher,role,actor),[fetcher,role,actor]);
 const request=day+':'+reload;
 useEffect(()=>{
  const controller=new AbortController();let current=true;
  setState({request});
  // Window uses explicit UTC dates; appointment labels use Vancouver time.
  // It does not infer a clinical day boundary.
  const from=new Date(day+'T00:00:00.000Z');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(from.getTime())||from.toISOString().slice(0,10)!==day){setState({request,error:'Choose a valid date.'});return()=>{current=false;controller.abort();};}
  const to=new Date(from.getTime()+7*86400000).toISOString();
  void client.loadSchedule({from:from.toISOString(),to},controller.signal).then(snapshot=>{
   if(current&&!controller.signal.aborted)setState({request,snapshot});
  }).catch(()=>{if(current&&!controller.signal.aborted)setState({request,error:'Schedule could not be verified. Reload to try again.'});});
  return()=>{current=false;controller.abort();};
 },[client,day,reload,request]);
 const visible=state.request===request?state:undefined;
 const data=visible?.snapshot;
 const clients=new Map(data?.clients.map(row=>[row.id,row.name]));
 const staff=new Map(data?.staff.map(row=>[row.id,row.name]));
 const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Vancouver',dateStyle:'medium',timeStyle:'short'});
 const label=(stamp:string)=>formatter.format(new Date(stamp));
 return <section className="panel dashboard-card" aria-label="Shared schedule">
  <h2>Shared visit schedule</h2><p>Read-only shared records. Times shown in Vancouver time. No changes are saved from this view.</p>
  <label>Week starting (UTC)<input type="date" value={day} onChange={event=>setDay(event.currentTarget.value)}/></label>
  <button type="button" onClick={()=>setReload(value=>value+1)}>Reload schedule</button>
  {!visible?.error&&!data&&<p role="status">Loading schedule…</p>}
  {visible?.error&&<p role="alert">{visible.error}</p>}
  {data&&<><p>{data.visits.length} visits in this seven-day UTC window.</p>{!data.visits.length&&<p>No visits returned for this account and window.</p>}
  <ul>{data.visits.map(visit=><li key={visit.id}><strong>{clients.get(visit.clientId)}</strong><p>{visit.service} · {visit.status}</p><p>{label(visit.start)} to {label(visit.end)}</p><p>{visit.workerId?staff.get(visit.workerId):'Unassigned'}</p></li>)}</ul></>}
 </section>;
}
