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
  const [actual,setActual]=useState<Actual|null>(null), [pending,setPending]=useState(false);
  const [error,setError]=useState(false), [reload,setReload]=useState(0);
  const controller=useRef<AbortController|null>(null);
  const locking=useRef(false);
  const {id,revision}=visit;
  useEffect(()=>{
    const current=new AbortController(); controller.current=current; locking.current=false;
    setActual(null);setPending(false);setError(false);
    const query=new URLSearchParams({attendance:id,revision:String(revision)});
    void (async()=>{
      try {
        const response=await fetcher('/api/admin/operations?'+query,{
          ...requestOptions(),method:'GET',signal:AbortSignal.any([current.signal,AbortSignal.timeout(15_000)]),
          headers:{Accept:'application/json','X-ECH-Schedule-Actor':actor,'X-ECH-Schedule-Role':role}
        });
        if (response.status===405 || current.signal.aborted) return;
        if (!response.ok) throw new Error('read');
        const data=await readJson(response,4096);
        if (!isVisitAttendance(data,id,revision)) throw new Error('invalid');
        if (!current.signal.aborted) setActual(data as Actual);
      } catch { if (!current.signal.aborted) setError(true); }
    })();
    return()=>current.abort();
  },[fetcher,actor,role,id,revision,reload]);

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
      if (!current.signal.aborted) setActual(confirmed);
    } catch { if (!current.signal.aborted) {setActual(null);setError(true);} }
    finally { if (!current.signal.aborted) {locking.current=false;setPending(false);} }
  }

  if(error) return <p role="status">Attendance could not be verified. <button type="button" onClick={()=>setReload(v=>v+1)}>Reload attendance</button></p>;
  if(!actual || actual.visitId!==id || actual.revision!==revision) return null;
  const status=visitAttendanceStatus(visit,actual,actual.observedAt);
  return <section aria-label="Visit attendance">
    <h4>Visit attendance</h4>
    <dl><dt>Recorded check-in · Vancouver</dt><dd>{actual.checkInAt?scheduleLabel(actual.checkInAt):'Not recorded'}</dd>
    <dt>Recorded check-out · Vancouver</dt><dd>{actual.checkOutAt?scheduleLabel(actual.checkOutAt):'Not recorded'}</dd></dl>
    {role!=='staff' && actual.checkInAt && Date.parse(actual.checkInAt)>Date.parse(visit.start) && <p>Check-in was recorded after the scheduled start.</p>}
    {role!=='staff' && status==='scheduled_start_passed_without_check_in' && <p>Follow up: scheduled start passed without a recorded check-in.</p>}
    {role!=='staff' && status==='scheduled_end_passed_without_check_in' && <p>Follow up: scheduled visit ended without a recorded check-in.</p>}
    {role==='staff' && !actual.checkInAt && ['Confirmed','In progress'].includes(visit.status) &&
      <button type="button" disabled={pending} onClick={()=>void record('check_in')}>Check in</button>}
    {role==='staff' && actual.checkInAt && !actual.checkOutAt && ['Confirmed','In progress','Completed'].includes(visit.status) &&
      <button type="button" disabled={pending} onClick={()=>void record('check_out')}>Check out</button>}
    {pending && <p role="status">Recording attendance…</p>}
  </section>;
}
