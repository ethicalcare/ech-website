import { SharedError } from './live-model.ts';
import type { ScheduleIdentity, ScheduleVisit } from './schedule-client.ts';

export type CreationReview = { operationId: string; visits: { original: ScheduleVisit; current: ScheduleVisit }[] };
const keys = ['id','clientId','workerId','service','start','end','status','revision'] as const;
export const sameCreationVisit = (a: ScheduleVisit, b: ScheduleVisit) => keys.every(key => a[key] === b[key]);
export const sameCreationReview = (a: CreationReview, b: CreationReview) => a.operationId === b.operationId
  && a.visits.length === b.visits.length && a.visits.every((row, i) => sameCreationVisit(row.original, b.visits[i].original)
    && sameCreationVisit(row.current, b.visits[i].current));

export const creationStaffLabel = (workerId: string | null, roster: ScheduleIdentity[]) => workerId === null
  ? 'Unassigned' : roster.find(worker => worker.id === workerId)?.name ?? 'Staff name unavailable';

// A validated receipt establishes a committed operation even if later reads fail.
// Carry no protected receipt or visit data in the error.
export class CreationReceiptError extends SharedError {
  readonly receiptValidated = true;
}
export async function readCreationReview(operationId: string, originals: ScheduleVisit[],
  load: (id: string) => Promise<ScheduleVisit>, signal: AbortSignal): Promise<CreationReview> {
  const visits: CreationReview['visits'] = [];
  try {
    for (const original of originals) {
      const current = await load(original.id);
      signal.throwIfAborted();
      if (current.revision < original.revision || current.revision === original.revision && !sameCreationVisit(original, current))
        throw new Error('Inconsistent current revision');
      visits.push({ original, current });
    }
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof SharedError && ['unauthenticated','forbidden','conflict','scope_changed'].includes(error.code))
      throw new SharedError('scope_changed','Current scheduling access could not be confirmed. Reopen the workspace.');
    throw new CreationReceiptError('write_unconfirmed','A valid creation receipt was found, but all current visits could not be verified. The exact request is retained. Retry the receipt review.');
  }
  return { operationId, visits };
}
export function requireUnchangedCreation(review: CreationReview) {
  if (review.visits.some(row => !sameCreationVisit(row.original, row.current)))
    throw new CreationReceiptError('receipt_changed','Creation is recorded, and the schedule has changed since then. Review the saved receipt alongside all current visits before resolving this request.');
}
