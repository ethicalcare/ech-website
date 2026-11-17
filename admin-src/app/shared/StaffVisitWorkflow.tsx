'use client';
import {useCallback,useMemo,useState} from 'react';
import {SharedVisitActions,type VisitLeaveState} from './SharedVisitActions';
import {SharedScheduleCommands} from './SharedScheduleCommands';
import {createVisitActionsClient} from './visit-action-client';
import {createScheduleCommandClient} from './schedule-command-client';
import {createScheduleClient,type ScheduleIdentity,type ScheduleVisit} from './schedule-client';
import {createVisitDetailClient} from './visit-detail-client';
import {createVisitReportClient} from './visit-report-client';

// Staff visit journey and manager scheduling presentation. RPCs recheck assignment;
// client visibility never establishes permission or confirms attendance.
export function StaffVisitWorkflow({visit:initialVisit,actor,role,fetcher,active,staff=[],schedulingEnabled,actionsEnabled,onConfirmed,onScopeFailure,onLeaveStateChange,onReconciled,onReconciliationFailure}:{
 visit:ScheduleVisit;staff?:ScheduleIdentity[];actor:string;role:'owner'|'manager'|'staff';fetcher:typeof fetch;active:boolean;schedulingEnabled:boolean;actionsEnabled:boolean;
 onReconciled?:(visit:ScheduleVisit)=>void;onReconciliationFailure?:()=>void;onConfirmed:(visit:ScheduleVisit)=>void;onScopeFailure:()=>void;onLeaveStateChange:(state:VisitLeaveState)=>void;
}){
 const [visit,setVisit]=useState(initialVisit);
 const clients=useMemo(()=>({actions:createVisitActionsClient(fetcher,actor,role),schedule:createScheduleCommandClient(fetcher,actor,role),read:createScheduleClient(fetcher,role,actor),detail:createVisitDetailClient(fetcher,actor,role),report:createVisitReportClient(fetcher,actor,role)}),[fetcher,actor,role]);
 const scopeFailure=useCallback(()=>onScopeFailure(),[onScopeFailure]);
 const confirmed=useCallback((current:ScheduleVisit)=>{
  // Confirmed assignments and completed staff actions unmount their form before
  // its leave-state effect can run. Clear only these acknowledged transitions,
  // never an uncertain request or an unrelated manager draft.
  if(role==='staff'&&((visit.status==='Assigned'&&current.status==='Confirmed')||(visit.status!=='Completed'&&current.status==='Completed')))onLeaveStateChange({dirty:false,pending:false,retained:false});
  setVisit(current);onConfirmed(current);
 },[onConfirmed,onLeaveStateChange,role,visit.status]);
 const reconcile=useCallback((current:ScheduleVisit)=>{setVisit(current);onReconciled?.(current);},[onReconciled]);
 const manager=role==='owner'||role==='manager';
 return <section aria-label={manager?"Manager scheduling workflow":"Staff visit workflow"}>
  {(manager?visit.status!=='Completed':visit.status==='Assigned')&&schedulingEnabled&&<SharedScheduleCommands visit={visit} active={active} role={role} staff={staff} client={clients.schedule} onConfirmed={confirmed} onScopeFailure={scopeFailure} onLeaveStateChange={onLeaveStateChange} onStale={()=>onLeaveStateChange({dirty:false,pending:true,retained:true})}/>}
  {(visit.status==='Completed'||role==='staff'&&['Confirmed','In progress'].includes(visit.status))&&actionsEnabled&&<SharedVisitActions visit={visit} active={active} client={clients.actions} loadDetail={clients.detail} loadReport={clients.report} loadCurrentVisit={clients.read.loadVisit} onConfirmed={confirmed} onReconciled={reconcile} onReconciliationFailure={onReconciliationFailure} onScopeFailure={scopeFailure} onLeaveStateChange={onLeaveStateChange} reconciliationEnabled={true}/>}
 </section>;
}
