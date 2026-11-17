'use client';
import {useCallback,useMemo,useState} from 'react';
import {SharedVisitActions,type VisitLeaveState} from './SharedVisitActions';
import {SharedScheduleCommands} from './SharedScheduleCommands';
import {createVisitActionsClient} from './visit-action-client';
import {createScheduleCommandClient} from './schedule-command-client';
import {createScheduleClient,type ScheduleVisit} from './schedule-client';
import {createVisitDetailClient} from './visit-detail-client';
import {createVisitReportClient} from './visit-report-client';

// Presentation for the assigned-staff journey only. RPCs recheck assignment;
// client visibility never establishes permission or confirms attendance.
export function StaffVisitWorkflow({visit:initialVisit,actor,role,fetcher,active,schedulingEnabled,actionsEnabled,onConfirmed,onScopeFailure,onLeaveStateChange}:{
 visit:ScheduleVisit;actor:string;role:'owner'|'manager'|'staff';fetcher:typeof fetch;active:boolean;schedulingEnabled:boolean;actionsEnabled:boolean;
 onConfirmed:(visit:ScheduleVisit)=>void;onScopeFailure:()=>void;onLeaveStateChange:(state:VisitLeaveState)=>void;
}){
 const [visit,setVisit]=useState(initialVisit);
 const clients=useMemo(()=>({actions:createVisitActionsClient(fetcher,actor,role),schedule:createScheduleCommandClient(fetcher,actor,role),read:createScheduleClient(fetcher,role,actor),detail:createVisitDetailClient(fetcher,actor,role),report:createVisitReportClient(fetcher,actor,role)}),[fetcher,actor,role]);
 const scopeFailure=useCallback(()=>onScopeFailure(),[onScopeFailure]);
 const confirmed=useCallback((current:ScheduleVisit)=>{setVisit(current);onConfirmed(current);},[onConfirmed]);
 const reconcile=useCallback((current:ScheduleVisit)=>setVisit(current),[]);
 if(role!=='staff')return null;
 return <section aria-label="Staff visit workflow">
  {visit.status==='Assigned'&&schedulingEnabled&&<SharedScheduleCommands visit={visit} active={active} role={role} staff={[]} client={clients.schedule} onConfirmed={confirmed} onScopeFailure={scopeFailure} onLeaveStateChange={onLeaveStateChange} onStale={()=>onLeaveStateChange({dirty:false,pending:true,retained:true})}/>}
  {['Confirmed','In progress'].includes(visit.status)&&actionsEnabled&&<SharedVisitActions visit={visit} active={active} client={clients.actions} loadDetail={clients.detail} loadReport={clients.report} loadCurrentVisit={clients.read.loadVisit} onConfirmed={confirmed} onReconciled={reconcile} onReconciliationFailure={scopeFailure} onScopeFailure={scopeFailure} onLeaveStateChange={onLeaveStateChange} reconciliationEnabled={false}/>}
 </section>;
}
