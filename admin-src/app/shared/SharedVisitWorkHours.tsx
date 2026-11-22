import {useEffect,useId,useLayoutEffect,useRef,useState} from 'react';
import {SharedError} from './live-model';
import type {HoursBinding,HoursClient,HoursCommand,HoursDecision,HoursState} from './work-hours-client';

const scopeFailure=(error:unknown)=>error instanceof SharedError&&['unauthenticated','forbidden','scope_changed'].includes(error.code);
const staleDecision=(error:unknown)=>error instanceof SharedError&&error.code==='conflict';
const accessChanged='Hours access changed. Reopen the report before making another decision.';
type View={status:'loading'|'hidden'|'error'}|{status:'ready';hours:HoursState};
export function SharedVisitWorkHours({binding,client}:{binding:HoursBinding;client:HoursClient}){
 const [view,setView]=useState<View>({status:'loading'});
 const [reason,setReason]=useState('');
 const [notice,setNotice]=useState('');
 const [busy,setBusy]=useState(false);
 const [retry,setRetry]=useState(0);
 const visit=binding.visitId, visitRevision=binding.visitRevision;
 const reportRevision=binding.reportRevision,contentRevision=binding.contentRevision;
 const life=useRef<AbortController|null>(null);
 const pending=useRef<HoursCommand|null>(null);
 const inFlight=useRef(false);
 const recoveryFenced=useRef(false);
 const needsVerifiedRead=useRef(false);
 const id=useId();
 function fenceRecovery(){
  pending.current=null;recoveryFenced.current=true;needsVerifiedRead.current=false;
  setReason('');setNotice(accessChanged);
 }
 useLayoutEffect(()=>{
  pending.current=null;recoveryFenced.current=false;needsVerifiedRead.current=false;inFlight.current=false;
  setView({status:'loading'});setReason('');setNotice('');setBusy(false);
  return()=>life.current?.abort();
 },[client,visit,visitRevision,reportRevision,contentRevision]);
 useEffect(()=>{
  const controller=new AbortController();
  life.current=controller;
  inFlight.current=false;
  setView({status:'loading'});setBusy(false);
  void client.read({visitId:visit,visitRevision,reportRevision,contentRevision},controller.signal).then(hours=>{
   if(controller.signal.aborted)return;
   const unresolved=pending.current;
   if(!hours){setView(unresolved||recoveryFenced.current?{status:'error'}:{status:'hidden'});return;}
   if(unresolved){
    if(hours.membershipRevision!==unresolved.membershipRevision||(!hours.canDecide&&!hours.receipt)){
     fenceRecovery();
    }else if(hours.receipt){
     pending.current=null;needsVerifiedRead.current=false;
     setReason('');setNotice('A worked-hours decision is already recorded for this report version.');
    }else if(needsVerifiedRead.current){
     needsVerifiedRead.current=false;
     setNotice('Hours status verified. You can retry the same decision.');
    }
   }
   setView({status:'ready',hours:recoveryFenced.current?{...hours,canDecide:false}:hours});
  }).catch(error=>{
   if(controller.signal.aborted)return;
   if((scopeFailure(error)||staleDecision(error))&&pending.current)fenceRecovery();
   setView({status:'error'});
  });
  return()=>controller.abort();
 },[client,visit,visitRevision,reportRevision,contentRevision,retry]);

 async function record(action:HoursDecision){
  if(recoveryFenced.current||needsVerifiedRead.current||view.status!=='ready'||!view.hours.canDecide||view.hours.receipt||inFlight.current
     ||!life.current||life.current.signal.aborted)return;
  const trimmed=reason.trim();
  if(!pending.current&&action==='return'&&!trimmed){setNotice('Enter a brief reason to return the hours.');return;}
  if(!pending.current){
   // Match the existing server note constraint before creating an operation;
   // an unconfirmed operation, by contrast, must keep its original text.
   if(trimmed.length>500||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(trimmed)){
    setNotice('Edit the note to remove unsupported characters or shorten it to 500 characters.');return;
   }
   pending.current={schema:1,visitId:visit,visitRevision,reportRevision,contentRevision,
    membershipRevision:view.hours.membershipRevision,operationId:crypto.randomUUID(),decision:action,
    ...(trimmed?{reason:trimmed}:{})};
  }
  const command=pending.current;
  const scope=life.current;
  inFlight.current=true;setBusy(true);setNotice('');
  try {
   const receipt=await client.write(command,scope.signal);
   if(scope.signal.aborted)return;
   pending.current=null;
   setView({status:'ready',hours:{...view.hours,canDecide:false,receipt}});
   setReason('');
   setNotice(receipt.decision==='approve'?'Hours approval recorded.':'Hours return recorded.');
  } catch(error) {
   if(!scope.signal.aborted){
    if(scopeFailure(error)){
     fenceRecovery();setView({status:'error'});
    }else if(staleDecision(error)){
     needsVerifiedRead.current=true;
     setView({status:'error'});
     setNotice('Reload hours status to verify the current report and access before retrying this decision.');
    }else setNotice('The decision could not be confirmed. Retry the same decision or reload its status.');
   }
  } finally{
   if(!scope.signal.aborted){inFlight.current=false;setBusy(false);}
  }
 }
 if(view.status==='hidden')return null;
 const hours=view.status==='ready'?view.hours:null;
 return <section aria-labelledby={id}>
  <h4 id={id}>Worked hours decision</h4>
  <p>This decision is separate from the care report review and does not calculate pay.</p>
  {view.status==='loading'&&<p role="status">Checking worked hours…</p>}
  {view.status==='error'&&<p role="status">Worked hours status unavailable. <button type="button" onClick={()=>setRetry(n=>n+1)}>Reload hours status</button></p>}
  {hours&&<>
   <p><strong>{hours.receipt?.decision==='approve'?'Approved':hours.receipt?.decision==='return'?'Returned':'Pending'}</strong></p>
   {hours.canDecide&&!hours.receipt&&<>
    <label htmlFor={id+'-reason'}>Note (required to return)</label>
    <textarea id={id+'-reason'} value={reason} maxLength={500} readOnly={busy||!!pending.current}
     onChange={event=>setReason(event.currentTarget.value)}/>
    {pending.current ? <button type="button" disabled={busy} onClick={()=>void record(pending.current!.decision)}>Retry same decision</button> : <>
     <button type="button" disabled={busy} onClick={()=>void record('approve')}>Approve hours</button>
     <button type="button" disabled={busy||!reason.trim()} onClick={()=>void record('return')}>Return hours</button>
    </>}
    {pending.current&&!busy&&<button type="button" onClick={()=>setRetry(n=>n+1)}>Reload hours status</button>}
   </>}
  </>}
  {notice&&<p role="status">{notice}</p>}
 </section>;
}
