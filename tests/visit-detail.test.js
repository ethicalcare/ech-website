import test from 'node:test';
import assert from 'node:assert/strict';
import { handleAdmin } from '../lib/admin/handler.js';
import { createVisitDetailClient } from '../admin-src/app/shared/visit-detail-client.ts';

const actor = '10000000-0000-4000-8000-000000000001';
const other = '10000000-0000-4000-8000-000000000002';
const visit = '20000000-0000-4000-8000-000000000001';
const env = {
  ECH_HOSTED_OPERATIONS_READS: 'true',
  ADMIN_ORIGIN: 'https://staff.example.invalid',
  SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'fixture-key',
};
const query = `visit=${visit}&revision=3`;
const payload = () => ({
  visitId: visit, revision: 3, contactAuthority: 'unknown', allergyStatus: 'unknown',
  fields: { address: '123 Sample Street', contact: { name: 'Sample contact', phone: '+16045550199', purpose: 'visit_logistics' } },
});
function setup({ role = 'staff', actorId = actor, active = true, data = payload(), status = 200, raw } = {}) {
  const calls = [];
  async function provider(url, options) {
    calls.push({ url, options });
    if (url.endsWith('/auth/v1/user')) return Response.json({ id: actorId, email: 'worker@example.invalid' });
    if (url.includes('/ech_memberships?')) return Response.json([
      { user_id: actorId, active: true, operational_role: role, revision: 5 },
    ]);
    if (url.endsWith('/ech_session_active')) return Response.json(active);
    assert.ok(url.endsWith('/ech_operations_visit_detail'));
    return raw === undefined ? Response.json(data, { status }) : new Response(raw, { status });
  }
  function handle(params = query, headers = {}, cookie = true) {
    return handleAdmin('operations', new Request(`${env.ADMIN_ORIGIN}/api/admin/operations?${params}`, {
      headers: { ...(cookie ? { Cookie: '__Host-ech-access=fixture-token' } : {}),
        'X-ECH-Schedule-Actor': actor, 'X-ECH-Schedule-Role': role, ...headers },
    }), env, provider);
  }
  return { calls, handle };
}

test('details use the canonical session and exact membership and visit revision, with no-store on both hops', async () => {
  for (const role of ['owner', 'manager', 'staff']) {
    const fixture = setup({ role });
    const response = await fixture.handle();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(await response.json(), payload());
    const { options } = fixture.calls.at(-1);
    assert.equal(options.headers.Authorization, 'Bearer fixture-token');
    assert.equal(options.redirect, 'manual');
    assert.equal(options.cache, 'no-store');
    assert.deepEqual(JSON.parse(options.body), {
      p_visit_id: visit, p_expected_revision: 3, p_expected_role: role, p_membership_revision: 5,
    });
  }
});

test('actor and role changes, revoked sessions and invalid requests stop before dispatch', async () => {
  for (const [options, request, status] of [
    [{ actorId: other }, [query], 409],
    [{ role: 'staff' }, [query, { 'X-ECH-Schedule-Role': 'manager' }], 409],
    [{ active: false }, [query], 401],
    [{}, [query, {}, false], 401],
    [{}, [query + '&diagnostics=private'], 400],
    [{}, [query + '&revision=3'], 400],
    [{}, [`visit=${visit}&revision=3e0`], 400],
    [{}, [`visit=${visit}&revision=9007199254740992`], 400],
    [{}, ['visit=bad&revision=3'], 400],
  ]) {
    const fixture = setup(options);
    assert.equal((await fixture.handle(...request)).status, status);
    assert.ok(!fixture.calls.some(call => call.url.endsWith('/ech_operations_visit_detail')));
  }
});

test('provider failures and malformed responses do not expose any detail', async () => {
  for (const [status, expected] of [[401,401],[403,403],[409,409],[412,412],[503,503],[302,503]]) {
    const response = await setup({ status }).handle();
    assert.equal(response.status, expected);
    assert.doesNotMatch(await response.text(), /Sample|6045550199/);
  }
  const corruptions = [
    value => { value.visitId = other; },
    value => { value.revision = 2; },
    value => { value.allergyStatus = 'none'; },
    value => { value.contactAuthority = 'authorized'; },
    value => { value.fields.allergies = 'Private'; },
    value => { value.fields.entry = 'Private\ncontent'; },
    value => { value.fields.contact.phone = '+16045550199;ext=9'; },
    value => { value.fields.contact.phone = '+16045550199\n'; },
    value => { value.fields.contact.phone = 'javascript:private'; },
    value => { value.fields.contact.purpose = 'anything'; },
    value => { value.fields.contact.sourceReference = 'Private'; },
  ];
  for (const corrupt of corruptions) {
    const data = payload();
    corrupt(data);
    const response = await setup({ data }).handle();
    assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /Sample|Private|6045550199/);
  }
  assert.equal((await setup({ raw: ' '.repeat(16_385) }).handle()).status, 503);
});

test('client rejects nonmatching fields and stale results, accepts an explicitly empty detail and accepts only canonical phone values', async () => {
  const controller = new AbortController();
  const data = { ...payload(), fields: {} };
  const load = createVisitDetailClient(async (url, options) => {
    assert.equal(url, '/api/admin/operations?' + query);
    assert.equal(options.headers['X-ECH-Schedule-Actor'], actor);
    assert.equal(options.headers['X-ECH-Schedule-Role'], 'staff');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.redirect, 'error');
    return Response.json(data);
  }, actor, 'staff');
  assert.deepEqual(await load(visit, 3, controller.signal), data);
  const bad = payload();
  bad.fields.contact.phone = 'tel:+16045550199';
  await assert.rejects(createVisitDetailClient(async () => Response.json(bad), actor, 'staff')(visit, 3, controller.signal),
    { code: 'invalid_response' });
  const stale = createVisitDetailClient(async () => Response.json(payload(), { status: 412 }), actor, 'staff');
  await assert.rejects(stale(visit, 3, controller.signal), { code: 'stale_visit' });
  const aborted = createVisitDetailClient(async () => {
    controller.abort();
    return Response.json(payload());
  }, actor, 'staff');
  await assert.rejects(aborted(visit, 3, controller.signal), { name: 'AbortError' });
});
