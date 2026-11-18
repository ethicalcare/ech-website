import type {Session,OperationsFeatures} from './live-model';
// Accept only sessions that have passed parseSession. Defaults support old servers.
// Presentation flags never substitute for current per-request authorization.
const disabled:Readonly<OperationsFeatures>=Object.freeze({reads:false,scheduleCommands:false,scheduleRecurrence:false,visitActions:false});
export function operationsFeatures(session:Session|null):Readonly<OperationsFeatures>{
  if(!session?.authenticated || !session.principal.operationalRole || !session.operationsFeatures)return disabled;
  return Object.freeze({...session.operationsFeatures});
}
export function operationsFeatureScope(session:Session|null):string{
  if(!session?.authenticated)return 'disabled';
  const f=operationsFeatures(session);
  return JSON.stringify([session.principal.id,session.principal.operationalRole,f.reads,f.scheduleCommands,f.scheduleRecurrence,f.visitActions,f.taskResults===true,f.visitAttendance===true]);
}
