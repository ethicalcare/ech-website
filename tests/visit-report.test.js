import test from 'node:test';
import assert from 'node:assert/strict';
import { handleAdmin } from '../lib/admin/handler.js';
import { isVisitReport, VISIT_REPORT_MAX_BYTES } from '../lib/operations/visit-report-wire.js';
import { createVisitReportClient } from '../admin-src/app/shared/visit-report-client.ts';

const actor = '10000000-0000-4000-8000-000000000001';
const reviewer = '10000000-0000-4000-8000-000000000002';
const visit = '20000000-0000-4000-8000-000000000001';
const env = { ECH_HOSTED_OPERATIONS_READS:'true', ADMIN_ORIGIN: 'https://staff.example.invalid', SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'fixture-key' };

test('report note event time accepts an explicit instant and preserves unknown legacy values', () => {
  const legacy = fictionalReport();
  assert.equal(isVisitReport(legacy, visit, 3), true);
  const withTime = fictionalReport();
  withTime.versions[0].noteEventAt = '2026-11-02T17:00:00.000Z';
  assert.equal(isVisitReport(withTime, visit, 3), true);
  withTime.versions[0].noteEventAt = null;
  assert.equal(isVisitReport(withTime, visit, 3), true);
  withTime.versions[0].noteEventAt = '2026-11-02T17:00:00';
  assert.equal(isVisitReport(withTime, visit, 3), false);
});
const query = `report=${visit}&revision=3`;
export const fictionalReport = () => ({
  schema: 1, visitId: visit, visitRevision: 3, reportRevision: 5,
  versions: [{ revision: 1, version: 0, sourceRevision: null, actorId: actor, actorRole: 'staff',
    recordedAt: '2026-11-01T20:00:01.000Z', outcome: 'completed', summary: ' Original wording.\nSecond line. ', issue: 'Original issue',
    actualStart: '2026-11-01T17:00:00.000Z', actualEnd: '2026-11-01T20:00:00.000Z', completedTasks: ['Actual nonclinical task'], observations: '', reason: null },
  { revision: 3, version: 1, sourceRevision: 1, actorId: actor, actorRole: 'staff',
    recordedAt: '2026-11-02T20:00:01.000Z', outcome: 'completed', summary: 'Corrected wording', issue: 'Corrected issue',
    actualStart: '2026-11-01T17:00:00.000Z', actualEnd: '2026-11-01T19:59:00.000Z', completedTasks: ['Corrected nonclinical task'], observations: 'Factual observation', reason: 'Clarify actual end' }],
  reviews: [{ revision: 2, version: 0, sourceRevision: 1, actorId: reviewer, actorRole: 'manager', recordedAt: '2026-11-02T19:00:00.000Z', decision: 'accepted', note: 'Original version reviewed' },
    { revision: 4, version: 1, sourceRevision: 3, actorId: reviewer, actorRole: 'manager', recordedAt: '2026-11-03T19:00:00.000Z', decision: 'returned', note: 'Clarification requested' },
    { revision: 5, version: 1, sourceRevision: 3, actorId: reviewer, actorRole: 'manager', recordedAt: '2026-11-03T20:00:00.000Z', decision: 'accepted', note: 'Exact correction reviewed' }],
});
function fixture({ role = 'staff', actorId = actor, active = true, data = fictionalReport(), status = 200, raw, contentType = 'application/json' } = {}) {
  const calls = [];
  const provider = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/auth/v1/user')) return Response.json({ id: actorId, email: 'fictional@example.invalid' });
    if (url.includes('/ech_memberships?')) return Response.json([{ user_id: actorId, active: true, operational_role: role, revision: 5 }]);
    if (url.endsWith('/ech_session_active')) return Response.json(active);
    assert.ok(url.endsWith('/ech_operations_visit_report'));
    return raw === undefined ? Response.json(data, { status }) : new Response(raw, { status, headers: { 'Content-Type': contentType } });
  };
  const handle = (params = query, headers = {}, cookie = true, method = 'GET') => handleAdmin('operations', new Request(`${env.ADMIN_ORIGIN}/api/admin/operations?${params}`, {
    method, headers: { ...(cookie ? { Cookie: '__Host-ech-access=fixture-token' } : {}), Origin: env.ADMIN_ORIGIN,
      'X-ECH-Schedule-Actor': actor, 'X-ECH-Schedule-Role': role, ...headers },
  }), env, provider);
  return { calls, handle };
}
test('report reads pass canonical actor/session, exact current membership, visit and optional stream revision without enabling writes', async () => {
  for (const role of ['owner', 'manager', 'staff']) {
    const f = fixture({ role });
    const response = await f.handle(query + '&reportRevision=5');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(await response.json(), fictionalReport());
    const { options } = f.calls.at(-1);
    assert.equal(options.cache, 'no-store'); assert.equal(options.redirect, 'manual');
    assert.equal(options.headers.Authorization, 'Bearer fixture-token');
    assert.deepEqual(JSON.parse(options.body), { p_visit_id: visit, p_expected_visit_revision: 3,
      p_expected_role: role, p_membership_revision: 5, p_expected_report_revision: 5 });
    assert.equal((await f.handle(query, {}, true, 'POST')).status, 405);
    assert.ok(f.calls.every(call => !call.url.includes('commit')));
  }
});
test('actor/role changes, revoked sessions, malformed IDs and unexpected parameters stop before report dispatch', async () => {
  for (const [options, params, headers, cookie, expected] of [
    [{ actorId: reviewer }, query, {}, true, 409], [{}, query, { 'X-ECH-Schedule-Role': 'manager' }, true, 409],
    [{ active: false }, query, {}, true, 401], [{}, query, {}, false, 401],
    [{}, query + '&visit=' + visit, {}, true, 400], [{}, query + '&reportRevision=-1', {}, true, 400],
    [{}, query + '&revision=3', {}, true, 400], [{}, query + '&reportRevision=5&reportRevision=5', {}, true, 400],
    [{}, 'report=bad&revision=3', {}, true, 400], [{}, `report=${visit}&revision=3e0`, {}, true, 400],
    [{}, query + '&reportRevision=9007199254740992', {}, true, 400],
  ]) {
    const f = fixture(options);
    assert.equal((await f.handle(params, headers, cookie)).status, expected);
    assert.ok(!f.calls.some(call => call.url.endsWith('/ech_operations_visit_report')));
  }
});
test('exact content and independent review mapping reject corrupt, reordered and extra fields without leaking content', async () => {
  assert.ok(isVisitReport(fictionalReport(), visit, 3));
  const empty = { schema: 1, visitId: visit, visitRevision: 3, reportRevision: 0, versions: [], reviews: [] };
  assert.ok(isVisitReport(empty, visit, 3));
  for (const corrupt of [
    p => { p.visitId = reviewer; }, p => { p.visitRevision = 2; }, p => { p.reportRevision = 6; },
    p => { p.versions.reverse(); }, p => { p.reviews.reverse(); }, p => { p.versions[1].sourceRevision = 2; },
    p => { p.versions[1].version = 2; }, p => { p.versions[1].outcome = 'follow-up'; },
    p => { p.versions[0].reason = 'Invented'; }, p => { p.reviews[1].version = 0; },
    p => { p.reviews[1].sourceRevision = 1; }, p => { p.reviews[0].actorId = actor; },
    p => { p.reviews[0].actorRole = 'staff'; }, p => { p.versions[1].actorId = reviewer; },
    p => { p.versions[0].actualStart = '2026-02-31T17:00:00.000Z'; }, p => { p.versions[0].summary += '\0'; },
    p => { p.versions[0].clinicalAuthority = 'approved'; }, p => { p.reviews[0].decision = 'closed'; },
    p => { p.versions[0].completedTasks = []; }, p => { p.versions[0].completedTasks = [' ']; },
  ]) {
    const data = fictionalReport(); corrupt(data);
    assert.equal(isVisitReport(data, visit, 3), false);
    const response = await fixture({ data }).handle(); assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /Original|Corrected|issue/);
  }
});
test('provider failures, oversized bodies and unexpected content types fail closed', async () => {
  for (const [status, expected] of [[401, 401], [403, 403], [409, 409], [412, 412], [503, 503], [302, 503]]) {
    const response = await fixture({ status }).handle(); assert.equal(response.status, expected);
    assert.doesNotMatch(await response.text(), /Original|Corrected/);
  }
  assert.equal((await fixture({ raw: ' '.repeat(VISIT_REPORT_MAX_BYTES + 1) }).handle()).status, 503);
  assert.equal((await fixture({ raw: JSON.stringify(fictionalReport()), contentType: 'text/html' }).handle()).status, 503);
  assert.equal((await fixture({ raw: '{' }).handle()).status, 503);
  assert.equal((await fixture().handle(query + '&reportRevision=4')).status, 503);
});
test('report character limits count supplementary Unicode characters as PostgreSQL does', async () => {
  const data = fictionalReport();
  data.versions[0].summary = '🙂'.repeat(1001);
  assert.equal(isVisitReport(data, visit, 3), true);
  assert.equal((await fixture({ data }).handle()).status, 200);
  data.versions[0].summary = '🙂'.repeat(2001);
  assert.equal(isVisitReport(data, visit, 3), false);
  assert.equal((await fixture({ data }).handle()).status, 503);
});

test('report wire rejects whitespace-only required fields using the database trim contract', () => {
  for (const whitespace of ['\uFEFF', '\u00A0', '\u202F', '\u3000']) {
    const data = fictionalReport();
    data.versions[0].summary = whitespace.repeat(3);
    assert.equal(isVisitReport(data, visit, 3), false);
    data.versions[0].summary = `${whitespace}abc${whitespace}`;
    assert.equal(isVisitReport(data, visit, 3), true);
  }
});
test('client reload performs fresh reads and ignores cancelled, out-of-order and mismatching responses', async () => {
  const calls = [];
  const load = createVisitReportClient(async (url, options) => {
    calls.push(url); assert.equal(options.cache, 'no-store'); assert.equal(options.redirect, 'error');
    assert.equal(options.headers['X-ECH-Schedule-Actor'], actor);
    return Response.json(fictionalReport());
  }, actor, 'staff');
  assert.deepEqual(await load(visit, 3, new AbortController().signal), fictionalReport());
  assert.deepEqual(await load(visit, 3, new AbortController().signal, 5), fictionalReport());
  assert.deepEqual(calls, ['/api/admin/operations?' + query, '/api/admin/operations?' + query + '&reportRevision=5']);
  let resolveOld;
  const pending = new Promise(resolve => { resolveOld = resolve; });
  const old = new AbortController();
  let index = 0;
  const racing = createVisitReportClient(async () => ++index === 1 ? pending : Response.json(fictionalReport()), actor, 'staff');
  const oldResult = racing(visit, 3, old.signal); old.abort();
  assert.deepEqual(await racing(visit, 3, new AbortController().signal), fictionalReport());
  resolveOld(Response.json(fictionalReport()));
  await assert.rejects(oldResult, { name: 'AbortError' });
  await assert.rejects(load(visit, 3, new AbortController().signal, 4), { code: 'invalid_response' });
  await assert.rejects(createVisitReportClient(async () => Response.json({}, { status: 412 }), actor, 'staff')(visit, 3, new AbortController().signal), { code: 'stale_visit' });
});
