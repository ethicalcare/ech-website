import {useEffect,useState} from 'react';
import {todayPhase,todayPriority,todayGroupKey,todayInstantLabel} from './today-interval';
import {focusedCalendarWindow} from './schedule-calendar';
import {scheduleDay} from './schedule-window';
import {createScheduleClient, type ScheduleSnapshot} from './schedule-client';

const today = () => scheduleDay(new Date().toISOString());

type Result={kind:'unavailable'}|{kind:'verified';open:number;waiting:number;snapshot:ScheduleSnapshot};

export function ManagerTodayScheduleAttention({actor,fetcher,onOpenSchedule,onMobileOpenSchedule}:{
 actor:string;fetcher:typeof fetch;onOpenSchedule:()=>void;onMobileOpenSchedule:()=>void;
}){
 const [request,setRequest]=useState(()=>({day:today()}));
 const [clock,setClock]=useState(()=>Date.now());
 const [loaded,setLoaded]=useState<{request:typeof request;fetcher:typeof fetch;result:Result}|null>(null);
  const result=loaded?.request===request&&loaded.fetcher===fetcher?loaded.result:undefined;
 const groups = new Map<string,{visit:ScheduleSnapshot['visits'][number];count:number}>();
 if(result?.kind==='verified') for(const visit of result.snapshot.visits){
  const key=todayGroupKey(visit);
  const group=groups.get(key);
  if(group) group.count++; else groups.set(key,{visit,count:1});
 }
 useEffect(()=>{
  // Only a Vancouver date change starts a new read; focus also catches a suspended tab.
  if(typeof window==='undefined'||typeof document==='undefined')return;
  const checkDay=()=>{
   if(document.visibilityState!=='visible')return;
   setClock(Date.now());
   const day=today();
   setRequest(previous=>previous.day===day?previous:{day});
  };
  checkDay();
  const timer=window.setInterval(checkDay,60_000);
  window.addEventListener('focus',checkDay);
  document.addEventListener('visibilitychange',checkDay);
  return()=>{
   window.clearInterval(timer);
   window.removeEventListener('focus',checkDay);
   document.removeEventListener('visibilitychange',checkDay);
  };
 },[]);
 useEffect(()=>{
  if(result?.kind!=='verified')return;
  const now=Date.now();const boundary=result.snapshot.visits.flatMap(v=>[Date.parse(v.start),Date.parse(v.end)]).filter(t=>t>now).sort((a,b)=>a-b)[0];
  if(boundary===undefined)return;
  const timer=setTimeout(()=>setClock(Date.now()),Math.min(boundary-now,2147483647));
  return()=>clearTimeout(timer);
 },[result,clock]);
 useEffect(()=>{
  const controller=new AbortController(),signal=controller.signal;
  const publish=(result:Result)=>{if(!signal.aborted){setClock(Date.now());setLoaded({request,fetcher,result});}};
  void Promise.resolve().then(()=>createScheduleClient(fetcher,'manager',actor)
    .loadSchedule(focusedCalendarWindow(request.day,'day'),signal))
    .then(snapshot=>{
      const {visits}=snapshot;
      let open=0,waiting=0;
      for(const visit of visits){
       if(visit.status==='Open')open++;
       if(visit.status==='Assigned')waiting++;
      }
      publish({kind:'verified',open,waiting,snapshot});
    },()=>publish({kind:'unavailable'}));
  return()=>controller.abort();
 },[actor,fetcher,request]);
 return <section className="panel dashboard-card today-schedule-attention" aria-label="Today’s visits needing attention">
  <section className="today-schedule-body" aria-label="Today schedule"><h2>Today schedule</h2>{!result&&<p role="status">Checking the shared schedule…</p>}{result?.kind==='unavailable'&&<p role="status">Today’s schedule could not be verified.</p>}{result?.kind==='verified'&&<>{result.snapshot.visits.length===0?<><p>No visits scheduled today.</p><button className="today-empty-mobile-action" type="button" onClick={onMobileOpenSchedule}>Open schedule</button></>:<ul>{[...groups.values()].sort((a,b)=>todayPriority(a.visit,new Date(clock).toISOString())-todayPriority(b.visit,new Date(clock).toISOString())||a.visit.start.localeCompare(b.visit.start)).map(({visit,count})=><li key={todayGroupKey(visit)}>{count} {count===1?'visit':'visits'} · {visit.service} · {todayInstantLabel(visit.start)} – {todayInstantLabel(visit.end)} · {visit.status}{visit.status!=='Cancelled'&&visit.status!=='Completed'&&<> · {todayPhase(visit,new Date(clock).toISOString())}</>}</li>)}</ul>}</>}</section>
  <h2>Today’s visits needing attention</h2>
  {!result&&<p role="status">Checking visits needing attention…</p>}
  {result?.kind==='unavailable'&&<p role="status">Visits needing attention could not be verified.</p>}
  {result?.kind==='verified'&&(result.open||result.waiting
   ?<dl><dt>Open / unassigned</dt><dd>{result.open}</dd><dt>Waiting for worker confirmation</dt><dd>{result.waiting}</dd></dl>
   :<p>No visits are unassigned or awaiting worker confirmation.</p>)}
  <button className={result?.kind==='verified'&&result.snapshot.visits.length===0?'today-empty-original-action':undefined} type="button" disabled={!result} onClick={()=>setRequest({day:today()})}>Refresh today’s schedule</button>
  <button className={result?.kind==='verified'&&result.snapshot.visits.length===0?'today-empty-original-action':undefined} type="button" onClick={onOpenSchedule}>Open shared schedule</button>
 </section>;
}
