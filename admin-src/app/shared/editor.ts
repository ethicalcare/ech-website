import { can, type Session, type SharedRecord, type Assignee, type RecordKind } from './live-model.ts';
export type RetainedDraft = { base?: Record<string, unknown>; fields: Record<string, unknown>; pending?: import('./live-model.ts').Command; uncertain?: boolean; needsReview?: boolean; activity?: { note: string; outcome: string; date: string; channel: string; madeContact: boolean }; followUp?: import('../intake/model.ts').FollowUpInput; referral?: import('../intake/model.ts').InquiryReferral; person?: import('../prospects/model.ts').PartnerPerson };
export const inquiryFields = ['name','phone','email','city','relationship','careRecipient','need','source','status','next','followUpAt','details','careRecipientPhone','careRecipientEmail','preferredContact'] as const;
export const partnerFields = ['organization','category','geography','contactRoute','stage','nextAction','nextDate','notes','openingAsk','materials','lastTouch','callScript','contacted','sprint'] as const;
export function editableFields(kind: 'inquiry' | 'partner', record?: SharedRecord): Record<string, unknown> {
  return Object.fromEntries((kind === 'inquiry' ? inquiryFields : partnerFields).map(field => [field, record && field in record ? (record as unknown as Record<string, unknown>)[field] : field === 'status' ? 'New' : field === 'stage' ? 'Not contacted' : field === 'followUpAt' ? null : field === 'contacted' ? false : field === 'materials' ? 'None' : field === 'sprint' ? 'Later list' : field === 'preferredContact' ? 'Phone' : '']));
}
export function mayEdit(session: Session | null, record?: SharedRecord): boolean {
  if (!session?.authenticated) return false;
  if (!record) return can(session, 'leads.create');
  return can(session, 'leads.update_all') || can(session, 'leads.update_assigned') && record.ownerId === session.principal.id;
}
export function draftIdentity(session: Session, kind: string, id: string): string {
  if (!session.authenticated) throw new TypeError('Verified session required.');
  return `${session.principal.id}:${kind}:${id}`;
}

export function mayRead(session: Session | null, record: SharedRecord): boolean {
  return session?.authenticated === true && (can(session, 'leads.read_all') || can(session, 'leads.read_assigned') && record.ownerId === session.principal.id);
}

export function rebaseEditableFields(base: Record<string, unknown>, draft: Record<string, unknown>, saved: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.keys(saved).map(field => [field, Object.hasOwn(draft, field) && !Object.is(draft[field], base[field]) ? draft[field] : saved[field]]));
}

export function assignedOwnerLabel(ownerId: string | null, assignees: Assignee[], currentViewerId?: string): string {
  if (!ownerId) return 'Unassigned';
  if (currentViewerId && ownerId === currentViewerId) return 'You';
  return assignees.find(person => person.id === ownerId)?.label || 'Assigned team member';
}
export function historyActionLabel(action: string, kind: RecordKind): string {
  const labels: Record<string, string> = {
    create: kind === 'inquiry' ? 'Inquiry recorded' : 'Partner added',
    update: kind === 'inquiry' ? 'Inquiry updated' : 'Partner updated',
    assign: 'Assignment changed', attribute_referral: 'Referral confirmed',
    follow_up: 'Follow-up recorded', record_note: 'Note added',
    save_person: 'Contact person saved', record_activity: 'Activity recorded',
  };
  return labels[action] || 'Record updated';
}
