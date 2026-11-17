import {useLayoutEffect,useState} from 'react';
import type {VisitTiming,TimingBoundary} from './visit-timing-client';
// This immutable operational snapshot is not a clinical order or a task result.
export function SharedVisitTiming({visitId,revision,load,onFailure}:{visitId:string;revision:number;load:(id:string,revision:number,signal:AbortSignal)=>Promise<VisitTiming>;onFailure:()=>void}) {
 const [data,setData]=useState<VisitTiming|null>(null),[error,setError]=useState(false);
 const [paused,setPaused]=useState(false);
 useLayoutEffect(()=>{let controller:AbortController|undefined;
  const focused=()=>document.visibilityState==='visible'&&document.hasFocus();
  function clear(){controller?.abort();setData(null);setError(false);setPaused(true);}
  function check(){clear();if(!focused())return;const request=new AbortController();controller=request;setPaused(false);
   load(visitId,revision,request.signal).then(value=>{if(!request.signal.aborted&&focused())setData(value);}).catch(()=>{if(!request.signal.aborted&&focused()){setData(null);setError(true);onFailure();}});
  }
  check();document.addEventListener('visibilitychange',check);window.addEventListener('blur',clear);window.addEventListener('focus',check);
  const timer=window.setInterval(check,60000);
  return()=>{controller?.abort();document.removeEventListener('visibilitychange',check);window.removeEventListener('blur',clear);window.removeEventListener('focus',check);window.clearInterval(timer);};
 },[visitId,revision,load,onFailure]);
 const time=(at:TimingBoundary)=><time dateTime={at.instant}>{at.local.replace('T',' ')}</time>;
 return <section aria-label="Operational task timing"><h3>Operational task timing</h3>
  <p>Suggested timing is guidance, not a strict deadline. This does not establish completion, missed care or clinical authority.</p>
  {paused?<p role="status">Task timing is hidden. Access will be checked when you return.</p>:error?<p role="alert">Task timing could not be verified.</p>:!data?<p role="status">Checking task timing…</p>:data.state==='unknown'?<p>No timing snapshot was recorded. Timing is unknown, not flexible by default.</p>:<>
   {data.entries.length===0&&<p>No operational timing entries are recorded.</p>}
   {data.entries.map(category=><section key={category.id}><h4>{category.label}</h4><ul>{category.tasks.map(task=><li key={task.id}><strong>{task.text}</strong>{task.timing.kind==='flexible'?<p>Flexible operational timing</p>:<p>Suggested {task.timing.target.kind==='point'?'time':'window'} · Vancouver: {task.timing.target.kind==='point'?time(task.timing.target.at):<>{time(task.timing.target.start)} – {time(task.timing.target.end)}</>}</p>}</li>)}</ul></section>)}
  </>}
 </section>;
}
