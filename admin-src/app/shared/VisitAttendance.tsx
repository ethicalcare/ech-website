'use client';
import {useEffect,useRef,useState} from 'react';
import type {ScheduleVisit} from './schedule-client';
import {readJson,requestOptions} from './session';
import {scheduleLabel} from './schedule-window';
import {isVisitAttendance,visitAttendanceStatus} from '../../../lib/operations/visit-attendance.js';

type Actual={visitId:string;revision:number;observedAt:string;checkInAt:string|null;checkOutAt:string|null};
type Action='check_in'|'check_out';
export function VisitAttendance({visit,actor,role,fetcher}:{
  visit:ScheduleVisit;actor:string;role:'staff'|'manager'|'owner';fetcher:typeof fetch;
}) {
  const [snapshot,setSnapshot]=useState<{scope:string;actual:Actual}|null>(null), [pending,setPending]=useState(false);
  const [error,setError]=useState(false), [reload,setReload]=useState(0);
  const [readLoading,setReadLoading]=useState<string|null>(null);
  const controller=useRef<AbortController|null>(null);
  const reloadLock=useRef<string|null>(null);
  const locking=useRef(false);
  const {id,revision}=visit;
  const scope=JSON.stringify([actor,role,id,revision]);
  const manager=role!=='staff';
  const actual=snapshot?.scope===scope?snapshot.actual:null;
  const reading=readLoading===scope;
  function refreshAttendance(){
    if(reading||reloadLock.current===scope)return;
    reloadLock.current=scope;setReadLoading(scope);setReload(v=>v+1);
  }
  useEffect(()=>{
    const current=new AbortController(); controller.current=current; locking.current=false;
    setSnapshot(null);setPending(false);setError(false);setReadLoading(scope);
    const query=new URLSearchParams({attendance:id,revision:String(revision)});
    void (async()=>{
      try {
        const response=await fetcher('/api/admin/operations?'+query,{
          ...requestOptions(),method:'GET',signal:AbortSignal.any([current.signal,AbortSignal.timeout(15_000)]),
          headers:{Accept:'application/json','X-ECH-Schedule-Actor':actor,'X-ECH-Schedule-Role':role}
        });
        if (current.signal.aborted) return;
        if (!response.ok) throw new Error('read');
        const data=await readJson(response,4096);
        if (!isVisitAttendance(data,id,revision)) throw new Error('invalid');
        if (!current.signal.aborted) setSnapshot({scope,actual:data as Actual});
      } catch { if (!current.signal.aborted) setError(true); }
      finally {
        if (!current.signal.aborted){if(reloadLock.current===scope)reloadLock.current=null;setReadLoading(null);}
      }
    })();
    return()=>current.abort();
  },[fetcher,actor,role,id,revision,scope,reload]);

  async function record(action:Action) {
    const current=controller.current;
    if (!current || current.signal.aborted || locking.current || !actual || error || role!=='staff') return;
    locking.current=true;setPending(true);
    try {
      const response=await fetcher('/api/admin/operations?attendance=1',{
        ...requestOptions(),method:'POST',signal:AbortSignal.any([current.signal,AbortSignal.timeout(15_000)]),
        headers:{'Content-Type':'application/json',Accept:'application/json','X-ECH-Schedule-Actor':actor,'X-ECH-Schedule-Role':role},
        body:JSON.stringify({visitId:id,revision,action})
      });
      if (!response.ok) throw new Error('write');
      const data=await readJson(response,4096);
      if (!isVisitAttendance(data,id,revision)) throw new Error('invalid');
      const confirmed=data as Actual;
      if (action==='check_in' ? !confirmed.checkInAt : !confirmed.checkOutAt) throw new Error('invalid');
      if (!current.signal.aborted) setSnapshot({scope,actual:confirmed});
    } catch { if (!current.signal.aborted) {setSnapshot(null);setError(true);} }
    finally { if (!current.signal.aborted) {locking.current=false;setPending(false);} }
  }

  if(error&&!manager) return <p role="status">Attendance could not be verified. <button type="button" onClick={refreshAttendance}>Reload attendance</button></p>;
  if(!actual&&(!manager||(!reading&&!error))) return null;
  const current=reading||error?null:actual;
  const status=current?visitAttendanceStatus(visit,current,current.observedAt):null;
  return <section aria-label="Visit attendance">
    <h4>Visit attendance</h4>
    <p>Check-in and check-out show when those actions were recorded. A missing record does not mean the visit did not happen. These records do not approve hours.</p>
    {manager&&<button type="button" aria-disabled={reading} onClick={refreshAttendance}>Refresh attendance</button>}
    {manager&&reading&&<p role="status">Updating attendance…</p>}
    {manager&&!reading&&error&&<p role="status">Attendance could not be verified. Refresh to check the latest recorded times.</p>}
    {current&&<>
    {manager&&<p>Last checked: {scheduleLabel(current.observedAt)}</p>}
    <dl><dt>Recorded check-in · Vancouver</dt><dd>{current.checkInAt?scheduleLabel(current.checkInAt):'Not recorded'}</dd>
    <dt>Recorded check-out · Vancouver</dt><dd>{current.checkOutAt?scheduleLabel(current.checkOutAt):'Not recorded'}</dd></dl>
    {role!=='staff' && current.checkInAt && Date.parse(current.checkInAt)>Date.parse(visit.start) && <p>Check-in was recorded after the scheduled start.</p>}
    {role!=='staff' && status==='scheduled_start_passed_without_check_in' && <p>Follow up: scheduled start passed without a recorded check-in.</p>}
    {role!=='staff' && status==='scheduled_end_passed_without_check_in' && <p>Follow up: scheduled visit ended without a recorded check-in.</p>}
    {role==='staff' && !current.checkInAt && ['Confirmed','In progress'].includes(visit.status) &&
      <button type="button" disabled={pending} onClick={()=>void record('check_in')}>Check in</button>}
    {role==='staff' && current.checkInAt && !current.checkOutAt && ['Confirmed','In progress','Completed'].includes(visit.status) &&
      <button type="button" disabled={pending} onClick={()=>void record('check_out')}>Check out</button>}
    {pending && <p role="status">Recording attendance…</p>}
    </>}
  </section>;
}
