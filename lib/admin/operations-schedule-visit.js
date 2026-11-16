import { AdminError, UUID } from './shared-commands.js';
import { requireOperational } from './permissions.js';
import { isScheduleVisit } from '../operations/schedule-command-wire.js';

const unavailable = () => new AdminError(503, 'unavailable', 'Current schedule access could not be verified.');

export async function scheduleVisit(current, params, fetcher) {
  requireOperational(current.member);
  const visitId = params.get('scheduleVisit'), text = params.get('membershipRevision'), revision = Number(text);
  if (params.size !== 2 || !visitId || visitId.length !== 36 || !UUID.test(visitId)
    || !text || String(revision) !== text || !Number.isSafeInteger(revision) || revision < 1)
    throw new AdminError(400, 'invalid_request', 'Choose a current schedule visit.');
  if (revision !== current.member.revision)
    throw new AdminError(409, 'scope_changed', 'Account access changed. Reopen the workspace.');
  let response;
  try {
    response = await fetcher(current.config.base + '/rest/v1/rpc/ech_operations_schedule_visit', {
      method: 'POST', redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(10_000),
      headers: { apikey: current.config.key, Authorization: 'Bearer ' + current.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_visit_id: visitId, p_expected_role: current.member.operational_role, p_membership_revision: revision }),
    });
  } catch { throw unavailable(); }
  if (response.status === 401) throw new AdminError(401, 'unauthenticated', 'Sign in to continue.');
  if (response.status === 403) throw new AdminError(403, 'forbidden', 'Current schedule access is unavailable.');
  if (response.status === 409) throw new AdminError(409, 'scope_changed', 'Account access changed. Reopen the workspace.');
  if (response.status !== 200 || response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw unavailable();
  let value;
  try {
    const reader = response.body?.getReader(); if (!reader) throw unavailable();
    const decoder = new TextDecoder('utf-8', { fatal: true }); let size = 0, text = '';
    try {
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength; if (size > 4096) { await reader.cancel(); throw unavailable(); }
        text += decoder.decode(value, { stream: true });
      }
    } finally { reader.releaseLock(); }
    value = JSON.parse(text + decoder.decode());
  } catch { throw unavailable(); }
  if (!isScheduleVisit(value) || value.id !== visitId.toLowerCase()
    || current.member.operational_role === 'staff' && (value.workerId === null || value.status === 'Cancelled')) throw unavailable();
  return { schema: 1, visit: value };
}
