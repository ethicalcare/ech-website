'use client';
import {useEffect,useRef,useState} from 'react';

type Role='staff'|'manager'|'owner';
type Row={id:string;owner:string|null;state:'open'|'closed';summary:string;followUpRecorded:boolean};
type View={schema:1;visit:string;revision:number;membershipRevision:number;actor:string;mayFile:boolean;items:Row[]};
type Intent={id:string;operation:string;visit:string;revision:number;membershipRevision:number;
 action:'file'|'pickup'|'follow-up'|'close';summary?:string;note?:string};

export function SharedVisitIncidents({visit,revision,actor,role,fetcher}:{
 visit:string;revision:number;actor:string;role:Role;fetcher:typeof fetch;
}){
 const [view,setView]=useState<View|null>(null),[loading,setLoading]=useState(true);
 const [selected,setSelected]=useState<string|null>(null),[draft,setDraft]=useState('');
 const [note,setNote]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 const [saved,setSaved]=useState(false);
 const hold=useRef<Intent|null>(null),lag=useRef(false),lifetime=useRef<AbortController|null>(null);
 // Stubbed in disposable fixtures only; deliberately outside every hosted writer route.
 const route='/__ech_fictional__/visit-incidents?incidents=1';
 const headers={'x-ech-schedule-actor':actor,'x-ech-schedule-role':role};
 async function refresh(signal:AbortSignal,expectedMembership?:number){
  const p=new URLSearchParams({visit,revision:String(revision)});
  const response=await fetcher(route+'&'+p,{credentials:'same-origin',cache:'no-store',signal,headers});
  if(!response.ok)throw Error('Unavailable');
  const snapshot:View=await response.json();
  if(snapshot?.schema!==1||snapshot.visit!==visit||snapshot.revision!==revision||snapshot.actor!==actor||
    !Number.isSafeInteger(snapshot.membershipRevision)||snapshot.membershipRevision<1||
    (expectedMembership!==undefined&&snapshot.membershipRevision!==expectedMembership)||
    !Array.isArray(snapshot.items)||typeof snapshot.mayFile!=='boolean'||(role==='staff'&&snapshot.items.length!==0))throw Error('Unavailable');
  if(!signal.aborted)setView(snapshot);
 }
 useEffect(()=>{
  const controller=new AbortController();lifetime.current=controller;
  void refresh(controller.signal).catch(()=>{if(!controller.signal.aborted)setMessage('Incidents could not be verified.');})
    .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return()=>controller.abort();
 },[visit,revision,actor,role,fetcher]);
 // A confirmed write invalidates the displayed manager snapshot until a fresh scoped GET.
 const officeView=saved?null:view;
 const item=officeView?.items.find(x=>x.id===selected);
 const owns=item?.state==='open'&&item.owner===actor;
 async function apply(action:Intent['action']){
  const signal=lifetime.current?.signal;if(!view||!signal||signal.aborted||lag.current)return;
  if(!hold.current){
   if(action==='file'&&(!view.mayFile||!draft.trim())||
      action==='pickup'&&(!item||item.owner||item.state!=='open')||
      action==='follow-up'&&(!owns||!note.trim())||
      action==='close'&&(!owns||!item?.followUpRecorded)) return;
   hold.current={id:action==='file'?crypto.randomUUID():item!.id,operation:crypto.randomUUID(),
    visit,revision,membershipRevision:view.membershipRevision,action,
    ...(action==='file'?{summary:draft.trim()}:action==='follow-up'?{note:note.trim()}:{})};
  }
  const intent=hold.current;
  lag.current=true;setBusy(true);setMessage('');
  try{
   const response=await fetcher(route,{method:'POST',credentials:'same-origin',signal,
    headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(intent)});
   if(!response.ok)throw Error('Unavailable');
   const result=await response.json();
   if(result?.schema!==1||result.status!=='recorded'||result.id!==intent.id||
      result.operation!==intent.operation||result.action!==intent.action||result.visit!==visit)throw Error('Unavailable');
   if(signal.aborted)return;
   hold.current=null;setSaved(true);
  }catch{
   if(!signal.aborted)setMessage('Could not confirm this incident action. Retry the same action.');
   return;
  }finally{
   lag.current=false;
   if(!signal.aborted)setBusy(false);
  }
  if(intent.action==='file'){setDraft('');setMessage('Incident filed.');return;}
  setBusy(true);
  try{
   await refresh(signal,intent.membershipRevision);
   if(!signal.aborted){setNote('');setSaved(false);setMessage(intent.action==='pickup'?'Incident picked up.':
     intent.action==='follow-up'?'Follow-up recorded.':'Incident closed.');}
  }catch{
   if(!signal.aborted){
    // An exact write receipt is not proof of continuing read access.
    setView(null);setSelected(null);setNote('');
    setMessage('Action saved. Current incident access could not be verified.');
   }
  }finally{if(!signal.aborted)setBusy(false);}
 }
 async function retryRead(){
  const signal=lifetime.current?.signal;
  if(!signal||signal.aborted||lag.current)return;
  lag.current=true;setBusy(true);
  try{
   await refresh(signal);
   if(!signal.aborted){setSaved(false);setMessage('Current incidents verified.');}
  }catch{
   if(!signal.aborted){setView(null);setMessage('Action saved. Current incident access could not be verified.');}
  }finally{lag.current=false;if(!signal.aborted)setBusy(false);}
 }
 const human=(row:Row)=>row.state==='closed'?'Closed':row.owner?'Picked up':'New';
 if(!view&&!loading&&!message)return null;
 return <section className="panel dashboard-card" aria-label={role==='staff'?'File an incident':'Visit incidents'}>
  <h4>{role==='staff'?'File an incident':'Visit incidents'}</h4>
  <p role="status">{loading?'Checking incident access…':message}</p>
  {saved&&!view&&role!=='staff'&&<button type="button" disabled={busy} onClick={()=>void retryRead()}>Retry incident access</button>}
  {view?.mayFile&&<form onSubmit={event=>{event.preventDefault();void apply('file');}}>
    <label>Incident summary<textarea maxLength={500} value={draft} readOnly={busy||!!hold.current}
      onChange={event=>{setDraft(event.currentTarget.value);setMessage('');}}/></label>
    <button type="submit" disabled={busy||!draft.trim()}>{hold.current?'Retry incident filing':'File incident'}</button>
  </form>}
  {officeView&&role!=='staff'&&<>
    {officeView.items.length===0&&<p>No incidents for this visit.</p>}
    <ul>{officeView.items.map(row=><li key={row.id}>
      <button type="button" disabled={busy||!!hold.current||saved} aria-pressed={selected===row.id}
        onClick={()=>{setSelected(row.id);setNote('');setMessage('');}}>Incident {row.id} · {human(row)}</button>
      <span>{row.owner?' · '+(row.owner===actor?'You':row.owner):' · Unassigned'}</span>
    </li>)}</ul>
    {item&&<section aria-label="Selected incident">
      <p>{item.summary}</p>
      {item.followUpRecorded&&<p>Follow-up recorded.</p>}
      {hold.current&&<button type="button" disabled={busy} onClick={()=>void apply(hold.current!.action)}>Retry incident action</button>}
      {!hold.current&&!saved&&item.state==='open'&&!item.owner&&<button type="button" disabled={busy}
        onClick={()=>void apply('pickup')}>Pick up incident</button>}
      {!hold.current&&!saved&&owns&&<form onSubmit={event=>{event.preventDefault();void apply('follow-up');}}>
        <label>Follow-up note<textarea maxLength={500} value={note} disabled={busy}
           onChange={event=>setNote(event.currentTarget.value)}/></label>
        <button type="submit" disabled={busy||!note.trim()}>Record follow-up</button>
        <button type="button" disabled={busy||!item.followUpRecorded} onClick={()=>void apply('close')}>Close incident</button>
      </form>}
    </section>}
  </>}
 </section>;
}
