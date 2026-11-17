import type {VisitReport} from './visit-report-client';
import type {CompletedTaskHistory} from './completed-task-history-client';
export type CareLogEvent={key:string;kind:'task'|'note';eventAt:string|null;recordedAt:string;actorId:string;role:string;title:string;detail:string;issue:string;observation:string;reason:string|null;version:number;original:boolean;latestVisible:boolean;sourceRevision:number|null};
const compareInstant=(a:string,b:string)=>Date.parse(a)-Date.parse(b)||Number((a.match(/\.(\d{1,6})(?:Z|[+-]\d\d:\d\d)$/)?.[1]??'').padEnd(6,'0').slice(3))-Number((b.match(/\.(\d{1,6})(?:Z|[+-]\d\d:\d\d)$/)?.[1]??'').padEnd(6,'0').slice(3));
export function joinedCareLog(report:VisitReport,history:CompletedTaskHistory){
 if(report.visitId!==history.visitId||report.visitRevision!==history.visitRevision||report.reportRevision!==history.reportRevision||report.versions.length===0)throw new Error('Care log revisions do not match.');
 const latestTasks=new Map<string,number>();
 for(const row of history.results)latestTasks.set(row.taskId,Math.max(latestTasks.get(row.taskId)??0,row.version));
 const latestNote=Math.max(...report.versions.map(row=>row.version));
 const outcomes={done:'Done',declined:'Declined',unable:'Unable','not-required':'Not required'};
 const events:CareLogEvent[]=[...history.results.map(row=>({key:`task:${row.taskId}:${row.version}`,kind:'task' as const,eventAt:row.actualAt,recordedAt:row.recordedAt,actorId:row.actorId,role:'staff',title:row.taskLabel,detail:outcomes[row.outcome],issue:'',observation:row.observation,reason:row.reason,version:row.version,original:row.version===1,latestVisible:row.version===latestTasks.get(row.taskId),sourceRevision:null})),...report.versions.map(row=>({key:`note:${row.revision}`,kind:'note' as const,eventAt:row.noteEventAt??null,recordedAt:row.recordedAt,actorId:row.actorId,role:row.actorRole,title:'Visit report note',detail:row.summary,issue:row.issue,observation:row.observations,reason:row.reason,version:row.version,original:row.version===0,latestVisible:row.version===latestNote,sourceRevision:row.sourceRevision}))];
 return {known:events.filter(e=>e.eventAt!==null).sort((a,b)=>compareInstant(a.eventAt!,b.eventAt!)||compareInstant(a.recordedAt,b.recordedAt)||a.key.localeCompare(b.key)),unknown:events.filter(e=>e.eventAt===null)};
}
