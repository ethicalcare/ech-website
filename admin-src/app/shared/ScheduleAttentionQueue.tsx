import type {OperationalRole} from './live-model';
import type {ScheduleIdentity,ScheduleVisit} from './schedule-client';
import {scheduleLabel} from './schedule-window';
import './schedule-attention-queue.css';
// Rows must already be authorized for this session and
// window; this component performs no fetch, write or inferred report check.
export function ScheduleAttentionQueue({role,visits,clients,staff,onOpen}:{role:OperationalRole;visits:ScheduleVisit[];clients:ScheduleIdentity[];staff:ScheduleIdentity[];onOpen:(visit:ScheduleVisit,origin:HTMLButtonElement)=>void}){
 if(role!=='owner'&&role!=='manager')return null;
 const clientNames=new Map(clients.map(v=>[v.id,v.name])),staffNames=new Map(staff.map(v=>[v.id,v.name]));
 const rows=visits.filter(v=>v.status==='Open'||v.status==='Assigned').slice().sort((a,b)=>a.start.localeCompare(b.start)||a.id.localeCompare(b.id));
 return <section className="schedule-attention" aria-label="Schedule attention"><h3>Schedule attention</h3><p>Open visits and assignments awaiting worker confirmation in the current calendar view and staff selection. This is not a report, attendance or worked-time review.</p>
  {rows.length===0?<p>No open or awaiting-confirmation visits were returned for this calendar view and staff selection.</p>:<ul>{rows.map(visit=>{const client=clientNames.get(visit.clientId)||'Client name unavailable',worker=visit.workerId?staffNames.get(visit.workerId)||'Assigned worker name unavailable':'Unassigned',action=visit.status==='Open'?'View open visit':'Review assignment',status=visit.status==='Open'?'Open · unassigned':'Awaiting worker confirmation';return <li key={visit.id}>
   <dl><dt>Client</dt><dd>{client}</dd><dt>Time</dt><dd><time dateTime={visit.start}>{scheduleLabel(visit.start)}</time> – <time dateTime={visit.end}>{scheduleLabel(visit.end)}</time></dd><dt>Worker</dt><dd>{worker}</dd><dt>Status</dt><dd>{status}</dd><dt>Next step</dt><dd>{action}</dd></dl>
   <button type="button" aria-label={`${action} for ${client}, ${scheduleLabel(visit.start)}`} onClick={event=>onOpen(visit,event.currentTarget)}>{action}</button>
  </li>;})}</ul>}
 </section>;
}
