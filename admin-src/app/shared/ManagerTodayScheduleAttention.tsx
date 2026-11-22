import {useEffect,useState} from 'react';
import {focusedCalendarWindow} from './schedule-calendar';
import {createScheduleClient} from './schedule-client';
import {companyDate} from './time';

type Result={kind:'unavailable'}|{kind:'verified';open:number;waiting:number};

export function ManagerTodayScheduleAttention({actor,fetcher,onOpenSchedule}:{
 actor:string;fetcher:typeof fetch;onOpenSchedule:()=>void;
}){
 const [request,setRequest]=useState(()=>({day:companyDate()}));
 const [loaded,setLoaded]=useState<{request:typeof request;fetcher:typeof fetch;result:Result}|null>(null);
 const result=loaded?.request===request&&loaded.fetcher===fetcher?loaded.result:undefined;
 useEffect(()=>{
  // Only a Vancouver date change starts a new read; focus also catches a suspended tab.
  if(typeof window==='undefined'||typeof document==='undefined')return;
  const checkDay=()=>{
   if(document.visibilityState!=='visible')return;
   const day=companyDate();
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
  const controller=new AbortController(),signal=controller.signal;
  const publish=(result:Result)=>{if(!signal.aborted)setLoaded({request,fetcher,result});};
  void Promise.resolve().then(()=>createScheduleClient(fetcher,'manager',actor)
    .loadSchedule(focusedCalendarWindow(request.day,'day'),signal))
    .then(({visits})=>{
      let open=0,waiting=0;
      for(const visit of visits){
       if(visit.status==='Open')open++;
       if(visit.status==='Assigned')waiting++;
      }
      publish({kind:'verified',open,waiting});
    },()=>publish({kind:'unavailable'}));
  return()=>controller.abort();
 },[actor,fetcher,request]);
 return <section className="panel dashboard-card" aria-label="Today’s visits needing attention">
  <h2>Today’s visits needing attention</h2>
  <p>{request.day} · Vancouver calendar day. These are schedule statuses, not report or attendance status.</p>
  {!result&&<p role="status">Checking the shared schedule…</p>}
  {result?.kind==='unavailable'&&<p role="status">Today’s schedule could not be verified.</p>}
  {result?.kind==='verified'&&(result.open||result.waiting
   ?<dl><dt>Open / unassigned</dt><dd>{result.open}</dd><dt>Waiting for worker confirmation</dt><dd>{result.waiting}</dd></dl>
   :<p>No visits are unassigned or awaiting worker confirmation.</p>)}
  <button type="button" disabled={!result} onClick={()=>setRequest({day:companyDate()})}>Refresh today’s schedule</button>
  <button type="button" onClick={onOpenSchedule}>Open shared schedule</button>
 </section>;
}
