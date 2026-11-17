'use client';
import {SharedVisitTiming} from './SharedVisitTiming';
import {createVisitTimingClient} from './visit-timing-client';
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {SharedVisitTaskResults,discardUnsentVisitTaskDraft,hasUnresolvedTaskMembership} from './SharedVisitTaskResults';
import {createVisitTaskAvailabilityClient} from './visit-task-availability-client';
import {createVisitTaskClient} from './visit-task-client';
import type {ScheduleVisit} from './schedule-client';
import type {VisitLeaveState} from './SharedVisitActions';
export function VisitTaskWorkflow({enabled=false,scope,actor,role,visit,fetcher,active,blocked,onLeave,onFailure}:{enabled?:boolean;scope:string;actor:string;role:'owner'|'manager'|'staff';visit:ScheduleVisit;fetcher:typeof fetch;active:boolean;blocked:boolean;onLeave:(state:VisitLeaveState)=>void;onFailure:()=>void}){
 const clients=useMemo(()=>({availability:createVisitTaskAvailabilityClient(fetcher,actor,role),tasks:createVisitTaskClient(fetcher,actor,role),timing:createVisitTimingClient(fetcher,actor,role)}),[fetcher,actor,role]);
 const availabilityKey=JSON.stringify([scope,actor,role,visit.id,visit.revision,visit.status,active,enabled]);
 const [access,setAccess]=useState<{key:string;clients:typeof clients;membership:number;timing:boolean}|null>(null);
 const membership=access?.key===availabilityKey&&access.clients===clients?access.membership:null;
 const timing=membership!==null&&access?.timing===true;
 const [error,setError]=useState(false),[unresolved,setUnresolved]=useState(false);
 const callbacks=useRef({onFailure,onLeave});callbacks.current={onFailure,onLeave};
 const lastMembership=useRef<number|null>(null);
 const permitted=enabled&&!['Completed','Cancelled'].includes(visit.status);
 useEffect(()=>{let current=true;const controller=new AbortController();setAccess(null);setError(false);setUnresolved(false);
  if(permitted&&active)void clients.availability(controller.signal).then(value=>{if(!current||controller.signal.aborted)return;if(!value.enabled){callbacks.current.onFailure();return;}if(hasUnresolvedTaskMembership(scope,visit.id,role,actor,value.membershipRevision)){setUnresolved(true);callbacks.current.onLeave({dirty:true,pending:true,retained:true});return;}lastMembership.current=value.membershipRevision;setAccess({key:availabilityKey,clients,membership:value.membershipRevision,timing:value.timing===true});}).catch(()=>{if(current&&!controller.signal.aborted){setError(true);callbacks.current.onFailure();}});
  return()=>{current=false;controller.abort();};
 },[clients,permitted,active,visit.id,visit.revision,scope,actor,role,availabilityKey]);
 useEffect(()=>()=>{if(lastMembership.current!==null)discardUnsentVisitTaskDraft(scope,visit.id,role,lastMembership.current,actor);},[scope,visit.id,role,actor]);
 const timingFailure=useCallback(()=>callbacks.current.onFailure(),[]);
 if(!permitted)return null;
 return <section aria-label="Visit task workflow">{active&&membership!==null&&timing&&<SharedVisitTiming key={`${scope}:${actor}:${role}:${visit.id}:${visit.revision}:${membership}`} visitId={visit.id} revision={visit.revision} load={clients.timing} onFailure={timingFailure}/>}{unresolved&&<p role="alert">An earlier task request has an unknown outcome under a different membership revision. It is retained for reconciliation; no replacement task request is allowed.</p>}{error&&<p role="alert">Task access could not be verified.</p>}{membership!==null&&<SharedVisitTaskResults enabled actorId={actor} scopeKey={scope} visitId={visit.id} visitRevision={visit.revision} visitStatus={visit.status} membershipRevision={membership} role={role} active={active} client={clients.tasks} mutationsBlocked={blocked} onScopeFailure={()=>callbacks.current.onFailure()} onStale={()=>callbacks.current.onFailure()} onLeaveStateChange={value=>callbacks.current.onLeave(value)}/>}</section>;
}
