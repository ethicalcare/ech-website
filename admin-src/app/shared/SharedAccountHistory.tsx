import { useCallback, useId, useLayoutEffect, useRef, useState } from 'react';
import { readAccountDecisions, type AccountDecisionPage, type AccountHistoryProps } from './account-decision-history-client';
import { companyTime } from './time';

type HistoryState = {scope:string;page:AccountDecisionPage|null;busy:boolean;error:boolean;hidden:boolean};
const actions = {approve:'Access approved',deny:'Request denied',revoke:'Access revoked'};

/** Existing owner-only caller and server authorize access; this view grants none. */
export function SharedAccountHistory({userId,revision,fetcher,onClose}:AccountHistoryProps) {
  const scope=JSON.stringify([userId,revision]);
  const heading=useId();
  const generation=useRef(0);
  const controller=useRef<AbortController|null>(null);
  const loading=useRef(false);
  const [state,setState]=useState<HistoryState>({scope,page:null,busy:false,error:false,hidden:true});
  const load=useCallback(async (previous:AccountDecisionPage|null=null)=>{
    if(document.visibilityState!=='visible'||loading.current)return;
    const offset=previous?.nextOffset??0;
    if(previous && (previous.userId!==userId.toLowerCase()||previous.revision!==revision||previous.nextOffset===null))return;
    controller.current?.abort();const request=new AbortController();controller.current=request;
    const ticket=++generation.current;loading.current=true;
    setState({scope,page:previous,busy:true,error:false,hidden:false});
    try {
      const page=await readAccountDecisions(fetcher,userId,revision,offset,request.signal);
      if(request.signal.aborted||ticket!==generation.current||document.visibilityState!=='visible')return;
      // Preserve the server's newest-first order, including ties and page boundaries.
      setState({scope,page:{...page,items:[...(previous?.items??[]),...page.items]},busy:false,error:false,hidden:false});
    } catch {
      if(request.signal.aborted||ticket!==generation.current)return;
      // A failed next-page read can mean access changed: conceal earlier rows too.
      setState({scope,page:null,busy:false,error:true,hidden:false});
    } finally {if(ticket===generation.current)loading.current=false;}
  },[fetcher,userId,revision,scope]);
  useLayoutEffect(()=>{
    function conceal(){++generation.current;controller.current?.abort();loading.current=false;setState({scope,page:null,busy:false,error:false,hidden:true});}
    function visibility(){conceal();if(document.visibilityState==='visible')void load();}
    visibility();document.addEventListener('visibilitychange',visibility);
    return ()=>{++generation.current;controller.current?.abort();loading.current=false;document.removeEventListener('visibilitychange',visibility);};
  },[load,scope]);
  const visible=state.scope===scope&&!state.hidden;
  const page=visible?state.page:null;
  return <section className="panel dashboard-card" aria-labelledby={heading}>
    <div className="prospect-list-head"><h3 id={heading}>Recorded account decisions</h3><button type="button" onClick={onClose}>Close decision history</button></div>
    <p>These are recorded decisions, newest first, not a complete lifetime account audit. Current account state is shown separately on the account card. Historical decision-maker names are not provided.</p>
    {!visible && <p>History is concealed until current access is checked again.</p>}
    {visible&&state.busy&&<p role="status">Checking recorded decisions…</p>}
    {visible&&state.error&&<><p role="alert">Decision history could not be verified. No previous rows are shown; the history may be unavailable or the account may have changed.</p><button type="button" onClick={()=>void load()}>Reload decision history</button></>}
    {page&&<><p>{page.items.length} recorded decision{page.items.length===1?'':'s'} loaded for account revision {page.revision}.</p>
      {page.items.length===0?<p>No recorded decisions were returned. This does not establish that no earlier account changes occurred.</p>:<ol>{page.items.map((item,index)=><li key={`${index}:${item.at}:${item.action}`}>
        <strong>{actions[item.action]}</strong><p><time dateTime={item.at}>{companyTime(item.at)}</time></p>
        <p>Recorded state: {item.previousState} → {item.nextState}.</p>
        {item.approvedRole&&<p>Role recorded with this decision: {item.approvedRole}. This is not a statement of current access.</p>}
      </li>)}</ol>}
      {page.nextOffset!==null&&<button type="button" disabled={state.busy} onClick={()=>void load(page)}>Load older recorded decisions</button>}
      {page.limitReached&&<p>More recorded decisions exist beyond the current display limit.</p>}
    </>}
  </section>;
}
