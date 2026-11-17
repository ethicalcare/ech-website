import type {VisitReport} from './visit-report-client';
// Never substitute scheduled-worker identity for the actor recorded in an event.
export function ReportActor({report,actorId,role}:{report:VisitReport;actorId:string;role:string}) {
 const label=report.authorLabels?.find(entry=>entry.actorId===actorId)?.currentLabel;
 return <>{label && <>{label} (current name) · </>}{role} · <span className="shared-visit-report__actor">{actorId}</span></>;
}
