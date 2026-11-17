import assert from 'node:assert/strict';
import test from 'node:test';
import { handleAdmin } from '../lib/admin/handler.js';
import { ACCESS_REVIEWER_ID } from '../lib/admin/access-requests.js';
import { commandFingerprint } from '../lib/admin/shared-commands.js';

const partner = '20000000-0000-4000-8000-000000000001';
const peer = '20000000-0000-4000-8000-000000000002';
const env = { ADMIN_ORIGIN: 'https://staff.example.test', SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'fixture-only', ECH_GOOGLE_SIGN_IN_ENABLED: 'true' };

function provider({ id = partner, role = 'manager', delegated = true, revoked = false } = {}) {
  const owner = id === ACCESS_REVIEWER_ID;
  const calls = [];
  return { calls, fetcher: async (url, options) => {
    const path = new URL(url).pathname.split('/').at(-1);
    calls.push(path);
    if (path === 'user') return Response.json({ id, email: owner ? 'erick@bloxlabs.tech' : 'actor@example.test' });
    if (path === 'ech_memberships') return Response.json([{ user_id: id, active: true,
      operational_role: role, application_admin: owner, technical_admin: false, delegated_user_admin: delegated }]);
    if (path === 'ech_session_active') return Response.json(!revoked);
    if (path === 'ech_access_requests' || path === 'ech_membership_list') return Response.json([]);
    if (path === 'ech_review_access' || path === 'ech_membership_commit') {
      const body = JSON.parse(options.body).p_envelope;
      const { command, operationId, expectedRevision } = body;
      const revision = expectedRevision + 1;
      const receipt = { operationId, expectedRevision, revision, commandFingerprint: await commandFingerprint(body) };
      if (path === 'ech_membership_commit') return Response.json({
        member: { userId: command.userId, email: command.email, revision, ...command.fields }, receipt,
      });
      return Response.json({ request: { userId: command.userId, role: command.role, revision,
        state: { approve: 'approved', deny: 'denied', revoke: 'revoked' }[command.type],
        ...(command.delegatedUserAdmin ? { delegatedUserAdmin: true } : {}) }, receipt });
    }
    throw new Error('Unexpected fictional provider route: ' + path);
  } };
}
const action = (type, role = null, userId = peer, extra = {}) => ({
  schema: 1, operationId: crypto.randomUUID(), expectedRevision: 2, command: { type, role, userId, ...extra },
});
const membership = (fields = {}, userId = peer) => ({
  schema: 1, operationId: crypto.randomUUID(), expectedRevision: 2,
  command: { type: 'upsert', email: 'peer@example.test', userId, fields: {
    displayName: 'Fictional peer', active: true, operationalRole: 'staff', applicationAdmin: false, technicalAdmin: false, ...fields,
  } },
});
function call(path, fixture, body) {
  const url = env.ADMIN_ORIGIN + '/api/admin/' + path;
  return handleAdmin(path, new Request(url, {
    method: body ? 'POST' : 'GET',
    headers: { cookie: '__Host-ech-access=fixture', 'Content-Type': 'application/json', origin: env.ADMIN_ORIGIN },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }), env, fixture.fetcher);
}
test('partner can approve a manager, change role and revoke without receiving full-admin tools', async () => {
  const fixture = provider();
  const session = await (await call('session', fixture)).json();
  assert.equal(session.principal.delegatedUserAdmin, true);
  assert.ok(session.capabilities.includes('users.manage'));
  assert.ok(session.capabilities.includes('access.review'));
  assert.ok(!session.capabilities.includes('backup.export'));
  for (const command of [action('approve', 'manager'), action('approve', 'staff'), action('revoke')]) {
    assert.equal((await call('access-requests', fixture, command)).status, 200);
  }
  assert.equal((await call('memberships', fixture, membership())).status, 200);
  assert.equal((await call('backup', fixture)).status, 403);
});
test('direct API denies invented partner grants, self edits, protected owner and unprivileged roles', async () => {
  const fixture = provider();
  assert.equal((await call('access-requests', fixture, action('approve', 'manager', peer, { delegatedUserAdmin: true }))).status, 403);
  assert.equal((await call('access-requests', fixture, action('revoke', null, partner))).status, 403);
  assert.equal((await call('memberships', fixture, membership({ applicationAdmin: true }))).status, 403);
  assert.ok((await call('access-requests', fixture, action('revoke', null, ACCESS_REVIEWER_ID))).status >= 400);
  assert.ok(!fixture.calls.includes('ech_review_access'));
  assert.ok(!fixture.calls.includes('ech_membership_commit'));
  for (const configuration of [{ role: 'staff', delegated: false }, { delegated: false }, { revoked: true }]) {
    const blocked = provider(configuration);
    assert.ok((await call('access-requests', blocked, action('approve', 'manager'))).status >= 400);
    assert.ok(!blocked.calls.includes('ech_review_access'));
  }
});
test('named owner can explicitly approve a partner administrator', async () => {
  const fixture = provider({ id: ACCESS_REVIEWER_ID, role: 'owner', delegated: false });
  const response = await call('access-requests', fixture, action('approve', 'manager', peer, { delegatedUserAdmin: true }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).request.delegatedUserAdmin, true);
});
