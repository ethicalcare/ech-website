'use client';
import {SharedVisitReport} from './SharedVisitReport';
import {createVisitReportClient} from './visit-report-client';
import {useEffect,useMemo,useState} from 'react';
import {createVisitDetailClient,type VisitDetail} from './visit-detail-client';
import type {ScheduleVisit} from './schedule-client';

// Parent keys this view by account/role/feature scope and visit revision.
export function SharedVisitRead({actor,role,visit,fetcher,onClose,onVerificationFailure}:{actor:string;role:'owner'|'manager'|'staff';visit:ScheduleVisit;fetcher:typeof fetch;onClose:()=>void;onVerificationFailure?:()=>void}){
 const [reportOpen,setReportOpen]=useState(false);
 const [reportVersion,setReportVersion]=useState<number|null>(null);
 const loadReport=useMemo(()=>createVisitReportClient(fetcher,actor,role),[fetcher,actor,role]);
 const [retry,setRetry]=useState(0);
 const key=JSON.stringify([actor,role,visit.id,visit.revision,retry]);
 const [state,setState]=useState<{key:string;detail?:VisitDetail;error?:string}>({key:''});
 const load=useMemo(()=>createVisitDetailClient(fetcher,actor,role),[fetcher,actor,role]);
 useEffect(()=>{
  let current=true;const controller=new AbortController();setState({key});
  void load(visit.id,visit.revision,controller.signal).then(detail=>{if(current&&!controller.signal.aborted)setState({key,detail});}).catch(()=>{if(current&&!controller.signal.aborted)setState({key,error:'Visit details could not be verified. Reload the schedule if this visit has changed.'});});
  return()=>{current=false;controller.abort();};
 },[load,visit.id,visit.revision,key]);
 const visible=state.key===key?state:undefined,detail=visible?.detail;
 const labels={address:'Address',unit:'Unit',entry:'Entry instructions',preferences:'Visit preferences'} as const;
 return <section className="panel dashboard-card" aria-label="Selected visit details">
  <h3>Selected visit details</h3><p>Read-only details for the selected visit revision.</p>
  <button type="button" onClick={onClose}>Close visit details</button><button type="button" onClick={()=>setRetry(value=>value+1)}>Reload visit details</button>
  {!detail&&!visible?.error&&<p role="status">Loading visit details…</p>}
  {visible?.error&&<p role="alert">{visible.error}</p>}
  {detail&&<><dl>{Object.entries(labels).map(([field,label])=><div key={field}><dt>{label}</dt><dd>{detail.fields[field as keyof typeof labels]||'Not provided'}</dd></div>)}</dl>
   {detail.fields.contact&&<section aria-label="Visit logistics contact"><h4>Visit logistics contact</h4><p>{detail.fields.contact.name}</p><p>{detail.fields.contact.phone||'Phone not provided'}</p></section>}
   <p>Contact authority is unknown. Do not infer consent or decision-making authority.</p><p>Allergy status is unknown. Absence of information does not mean no allergies.</p>
   <button type="button" aria-expanded={reportOpen} onClick={()=>setReportOpen(value=>!value)}>{reportOpen?'Hide report history':'View report history'}</button>
   {reportOpen&&<SharedVisitReport key={key} visitId={visit.id} visitRevision={visit.revision} load={loadReport} onVerificationFailure={()=>{setState({key,error:"Visit access could not be verified. Reload the schedule."});setReportOpen(false);setReportVersion(null);onVerificationFailure?.();}} selectedVersion={reportVersion} onSelectedVersionChange={setReportVersion}/>}
  </>}
 </section>;
}
