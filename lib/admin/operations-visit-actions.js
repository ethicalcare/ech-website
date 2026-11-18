import { AdminError } from './shared-commands.js';
import { requireOperational } from './permissions.js';
import { isVisitAction, isVisitActionReceipt, isStartResult } from '../operations/visit-action-wire.js';

// Boolean, in-process opt-in only. Deployment string variables never enable it.
// The fictional test adapter is the only caller that supplies this capability.
export const visitActionsEnabled = env => env.ECH_LOCAL_VISIT_ACTIONS === true;
export function visitActionAvailability(current, env, {noteEventTime=false}={}) {
  requireOperational(current.member);
  if (!Number.isSafeInteger(current.member.revision) || current.member.revision < 1)
    throw new AdminError(503, 'unavailable', 'Visit command access could not be verified.');
  return { schema: 1, enabled: visitActionsEnabled(env), membershipRevision: current.member.revision,
    ...(noteEventTime ? {noteEventTime:visitActionsEnabled(env) && env.ECH_REPORT_NOTE_EVENT_TIME===true} : {}) };
}
const unknown = () => new AdminError(502, 'write_unconfirmed', 'The result is unknown. Keep this draft and retry the exact request to check its receipt.');
export async function commitVisitAction(current, raw, env, fetcher) {
  requireOperational(current.member);
  if (!visitActionsEnabled(env)) throw new AdminError(405, 'disabled', 'Visit commands are not enabled here.');
  if (!isVisitAction(raw)) throw new AdminError(400, 'invalid_request', 'Use a factual summary of 3–2000 characters, valid past UTC times no longer than 24 hours, and only completed tasks. Corrections and reviews need a reason or note of 3–500 characters.');
  if (raw.membershipRevision !== current.member.revision)
    throw new AdminError(409, 'scope_changed', 'Account access changed. Reopen the workspace to check access.');
  const start = raw.command.type === 'start';
  const envelope = start ? { schema: 1, operationId: raw.operationId, expectedRevision: raw.visitRevision,
    command: { type: 'start', visitId: raw.visitId, expectedRole: current.member.operational_role, membershipRevision: raw.membershipRevision } }
    : { schema: 1, operationId: raw.operationId, visitId: raw.visitId, expectedVisitRevision: raw.visitRevision,
      expectedReportRevision: raw.reportRevision, expectedRole: current.member.operational_role,
      membershipRevision: raw.membershipRevision, command: raw.command };
  let response;
  try {
    response = await fetcher(current.config.base + '/rest/v1/rpc/' + (start ? 'ech_operations_visit_commit' : 'ech_operations_visit_report_commit'), {
      method: 'POST', redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(10_000),
      headers: { apikey: current.config.key, Authorization: 'Bearer ' + current.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_envelope: envelope }),
    });
  } catch { throw unknown(); }
  const failures = {
    400: ['invalid_request', 'The request was rejected. Check the report fields, completed tasks and actual times.'],
    401: ['unauthenticated', 'Sign in again before checking the saved result.'],
    403: ['forbidden', 'This request is not allowed. Starting and submitting require the assigned worker. Reviews require an independent manager.'],
    409: ['action_conflict', 'The visit, report, access or actual-time interval conflicts with this request. Keep the draft. Reload before preparing a new request; retry the exact request only to check its result.'],
    412: ['stale_visit', 'The visit changed. Keep the draft and reload before preparing a new request.'],
  };
  if (failures[response.status]) throw new AdminError(response.status, ...failures[response.status]);
  if (response.status !== 200 || response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw unknown();
  let result;
  try {
    const reader = response.body?.getReader(); if (!reader) throw unknown();
    let data = '', bytes = 0; const decoder = new TextDecoder('utf-8', { fatal: true });
    try { for (;;) { const {done,value} = await reader.read(); if (done) break;
      bytes += value.byteLength; if (bytes > 16_384) { await reader.cancel(); throw unknown(); }
      data += decoder.decode(value, {stream:true});
    } } finally { reader.releaseLock(); }
    result = JSON.parse(data + decoder.decode());
  } catch { throw unknown(); }
  if (start) {
    if (!isStartResult(result, raw)) throw unknown();
    // The private start receipt has no timestamp. Do not invent one.
    return { schema: 1, operationId: raw.operationId, visitId: raw.visitId, visitRevision: result.visit.revision,
      reportRevision: null, reportVersion: null, action: 'start', recordedAt: null };
  }
  const receipt = { schema: 1, ...result };
  if (!isVisitActionReceipt(receipt, raw)) throw unknown();
  return receipt;
}
