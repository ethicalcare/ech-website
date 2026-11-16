import { AdminError, UUID } from './shared-commands.js';
import { requireOperational } from './permissions.js';
import { isVisitDetail, VISIT_DETAIL_MAX_BYTES } from '../operations/visit-detail-wire.js';

const unavailable = () => new AdminError(503, 'unavailable', 'Visit details could not be verified.');

async function readDetail(response) {
  const reader = response.body?.getReader();
  if (!reader) throw unavailable();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let decoded = '';
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return JSON.parse(decoded + decoder.decode());
      size += value.byteLength;
      if (size > VISIT_DETAIL_MAX_BYTES) {
        await reader.cancel();
        throw unavailable();
      }
      decoded += decoder.decode(value, { stream: true });
    }
  } catch {
    throw unavailable();
  } finally {
    reader.releaseLock();
  }
}

export async function visitDetail(current, params, fetcher) {
  requireOperational(current.member);
  const visitId = params.get('visit');
  const revisionText = params.get('revision');
  const revision = Number(revisionText);
  const membershipRevision = current.member.revision;
  if (params.size !== 2 || !visitId || visitId.length !== 36 || !UUID.test(visitId)
    || !revisionText || String(revision) !== revisionText || !Number.isSafeInteger(revision) || revision < 1) {
    throw new AdminError(400, 'invalid_request', 'Choose a current visit.');
  }
  if (!Number.isSafeInteger(membershipRevision) || membershipRevision < 1) throw unavailable();

  let response;
  try {
    response = await fetcher(current.config.base + '/rest/v1/rpc/ech_operations_visit_detail', {
      method: 'POST',
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
      headers: { apikey: current.config.key, Authorization: 'Bearer ' + current.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        p_visit_id: visitId,
        p_expected_revision: revision,
        p_expected_role: current.member.operational_role,
        p_membership_revision: membershipRevision,
      }),
    });
  } catch {
    throw unavailable();
  }
  if (response.status === 401) throw new AdminError(401, 'unauthenticated', 'Sign in to continue.');
  if (response.status === 403) throw new AdminError(403, 'forbidden', 'Visit details are unavailable for this account.');
  if (response.status === 409) throw new AdminError(409, 'conflict', 'Account access changed. Reload the workspace.');
  if (response.status === 412) throw new AdminError(412, 'stale_visit', 'The visit changed. Reload the schedule.');
  if (response.status !== 200) throw unavailable();
  const detail = await readDetail(response);
  if (!isVisitDetail(detail, visitId.toLowerCase(), revision)) throw unavailable();
  return detail;
}
