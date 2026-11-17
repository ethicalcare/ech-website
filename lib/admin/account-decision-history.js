import { AdminError, UUID } from './shared-commands.js';
import { isMainAccessReviewer } from './access-requests.js';
import { rpc } from './shared-repository.js';

export async function accountDecisionHistory(current, params, env, fetcher) {
  if (!Object.hasOwn(env,'ECH_ACCOUNT_DECISION_HISTORY') || env.ECH_ACCOUNT_DECISION_HISTORY !== 'true') throw new AdminError(404, 'disabled', 'Account decision history is unavailable.');
  if(!isMainAccessReviewer(current)) throw new AdminError(403,'forbidden','Only the main administrator can read account history.');
  if ([...params.keys()].some(key => !['userId','revision','offset'].includes(key)) ||
      ['userId','revision','offset'].some(key => params.getAll(key).length !== 1)) throw new AdminError(400, 'invalid_request', 'Choose a current account.');
  const userId = params.get('userId'), revisionText = params.get('revision'), offsetText = params.get('offset');
  const revision = Number(revisionText), offset = Number(offsetText);
  if (!userId || !UUID.test(userId) || !Number.isSafeInteger(revision) || revision < 1 || String(revision) !== revisionText ||
      !Number.isSafeInteger(offset) || offset < 0 || offset > 100000 || offset % 20 !== 0 || String(offset) !== offsetText)
    throw new AdminError(400, 'invalid_request', 'Choose a current account.');
  const value = await rpc(current, 'ech_account_decision_history', {p_target:userId,p_revision:revision,p_offset:offset}, fetcher);
  const keys = object => object && typeof object === 'object' && !Array.isArray(object) ? Object.keys(object).sort().join(',') : '';
  if (keys(value) !== 'items,limitReached,nextOffset,revision,schema,userId' || value.schema !== 1 || value.userId !== userId.toLowerCase() || value.revision !== revision ||
      !Array.isArray(value.items) || value.items.length > 20 || (value.nextOffset !== null && (value.nextOffset !== offset + 20 || value.items.length !== 20)) ||
      typeof value.limitReached !== 'boolean' || (value.limitReached && (offset !== 100000 || value.nextOffset !== null || value.items.length !== 20)) ||
      (offset === 100000 && value.nextOffset !== null) ||
      value.items.some(row => keys(row) !== 'action,approvedRole,at,nextState,previousState' ||
        !['approve','deny','revoke'].includes(row.action) || !['pending','approved','denied','revoked'].includes(row.previousState) ||
        !['approved','denied','revoked'].includes(row.nextState) || (row.approvedRole !== null && !['staff','manager'].includes(row.approvedRole)) ||
        row.nextState !== {approve:'approved',deny:'denied',revoke:'revoked'}[row.action] || (row.nextState === 'approved') !== (row.approvedRole !== null) ||
        typeof row.at !== 'string' || !Number.isFinite(Date.parse(row.at))))
    throw new AdminError(502, 'unavailable', 'Recorded decisions could not be verified.');
  return value;
}
