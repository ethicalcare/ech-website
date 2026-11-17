import { accountApi } from './AccessRequests';
import { uuid } from './live-model';

export type AccountDecision = { at: string; action: 'approve' | 'deny' | 'revoke'; previousState: 'pending' | 'approved' | 'denied' | 'revoked'; nextState: 'approved' | 'denied' | 'revoked'; approvedRole: 'staff' | 'manager' | null };
export type AccountDecisionPage = { schema: 1; userId: string; revision: number; items: AccountDecision[]; nextOffset: number | null; limitReached: boolean };
export type AccountHistoryProps = { userId: string; revision: number; fetcher: typeof fetch; onClose: () => void };
export async function readAccountDecisions(fetcher: typeof fetch, userId: string, revision: number, offset = 0, signal?: AbortSignal): Promise<AccountDecisionPage> {
  if (!uuid(userId) || !Number.isSafeInteger(revision) || revision < 1 || !Number.isSafeInteger(offset) || offset < 0 || offset > 100000 || offset % 20 !== 0) throw new Error('Invalid account history request.');
  const query = new URLSearchParams({userId,revision:String(revision),offset:String(offset)});
  const value = await accountApi(fetcher, `account-decision-history?${query}`, undefined, 32000, signal) as AccountDecisionPage;
  const keys = (v: unknown) => v && typeof v === 'object' && !Array.isArray(v) ? Object.keys(v).sort().join(',') : '';
  if (keys(value) !== 'items,limitReached,nextOffset,revision,schema,userId' || value.schema !== 1 || value.userId !== userId.toLowerCase() || value.revision !== revision ||
      !Array.isArray(value.items) || value.items.length > 20 || (value.nextOffset !== null && (value.nextOffset !== offset + 20 || value.items.length !== 20)) ||
      typeof value.limitReached !== 'boolean' || (value.limitReached && (offset !== 100000 || value.nextOffset !== null || value.items.length !== 20)) ||
      (offset === 100000 && value.nextOffset !== null) ||
      value.items.some(row => keys(row) !== 'action,approvedRole,at,nextState,previousState' || !['approve','deny','revoke'].includes(row.action) ||
        !['pending','approved','denied','revoked'].includes(row.previousState) || !['approved','denied','revoked'].includes(row.nextState) ||
        (row.approvedRole !== null && !['staff','manager'].includes(row.approvedRole)) ||
        row.nextState !== ({approve:'approved',deny:'denied',revoke:'revoked'} as const)[row.action] || (row.nextState === 'approved') !== (row.approvedRole !== null) ||
        typeof row.at !== 'string' || !Number.isFinite(Date.parse(row.at))))
    throw new Error('Recorded decisions could not be verified.');
  return value;
}
