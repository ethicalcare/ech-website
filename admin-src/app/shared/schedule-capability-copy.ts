import type {OperationalRole,OperationsFeatures} from './live-model';
// Feature flags describe potential UI availability, not authorization or proof
// that a particular action is enabled for this visit or has been saved.
export function scheduleCapabilityCopy(role:OperationalRole,features:Pick<OperationsFeatures,'scheduleCommands'|'visitActions'|'taskResults'>):string {
 const mayOfferAction=features.scheduleCommands===true || features.visitActions===true || role==='staff'&&features.taskResults===true;
 return mayOfferAction
  ? 'Shared visit records. Available actions depend on your access and the visit; saves require server confirmation.'
  : 'Shared visit records are read-only in this workspace. No schedule or visit changes can be saved here.';
}
