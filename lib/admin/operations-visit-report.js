import { AdminError, UUID } from './shared-commands.js';
import { requireOperational } from './permissions.js';
import { isVisitReport, VISIT_REPORT_MAX_BYTES } from '../operations/visit-report-wire.js';

const unavailable = () => new AdminError(503, 'unavailable', 'Visit reports could not be verified.');
async function readReport(response) {
  if (response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw unavailable();
  const reader = response.body?.getReader();
  if (!reader) throw unavailable();
  let decoded = '', size = 0;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return JSON.parse(decoded + decoder.decode());
      size += value.byteLength;
      if (size > VISIT_REPORT_MAX_BYTES) { await reader.cancel(); throw unavailable(); }
      decoded += decoder.decode(value, { stream: true });
    }
  } catch { throw unavailable(); } finally { reader.releaseLock(); }
}
export async function visitReport(current, params, fetcher) {
  requireOperational(current.member);
  const visitId = params.get('report'), revisionText = params.get('revision');
  const revision = Number(revisionText), expectedText = params.get('reportRevision');
  const expected = expectedText === null ? null : Number(expectedText);
  if (![...params.keys()].every(key => ['report', 'revision', 'reportRevision'].includes(key))
    || params.getAll('report').length !== 1 || params.getAll('revision').length !== 1 || params.getAll('reportRevision').length > 1
    || !visitId || visitId.length !== 36 || !UUID.test(visitId)
    || !revisionText || String(revision) !== revisionText || !Number.isSafeInteger(revision) || revision < 1
    || expected !== null && (String(expected) !== expectedText || !Number.isSafeInteger(expected) || expected < 0)) {
    throw new AdminError(400, 'invalid_request', 'Choose a current visit report.');
  }
  if (!Number.isSafeInteger(current.member.revision) || current.member.revision < 1) throw unavailable();
  let response;
  try {
    response = await fetcher(current.config.base + '/rest/v1/rpc/ech_operations_visit_report', {
      method: 'POST', redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(10_000),
      headers: { apikey: current.config.key, Authorization: 'Bearer ' + current.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_visit_id: visitId, p_expected_visit_revision: revision,
        p_expected_role: current.member.operational_role, p_membership_revision: current.member.revision,
        p_expected_report_revision: expected }),
    });
  } catch { throw unavailable(); }
  if (response.status === 401) throw new AdminError(401, 'unauthenticated', 'Sign in to continue.');
  if (response.status === 403) throw new AdminError(403, 'forbidden', 'Visit reports are unavailable for this account.');
  if (response.status === 409) throw new AdminError(409, 'conflict', 'Account access changed. Reload the workspace.');
  if (response.status === 412) throw new AdminError(412, 'stale_visit', 'The visit or report changed. Reload the schedule.');
  if (response.status !== 200) throw unavailable();
  const report = await readReport(response);
  if (!isVisitReport(report, visitId.toLowerCase(), revision, expected)) throw unavailable();
  return report;
}
