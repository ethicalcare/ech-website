import test from 'node:test';
import assert from 'node:assert/strict';
import { accountDecisionHistory } from '../lib/admin/account-decision-history.js';
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'node:url';

// Resolve the application's extensionless TS/TSX imports with its installed
// bundler. Keep the fixture entirely in memory; no server or generated files.
const clientBundle = buildSync({
  entryPoints: [fileURLToPath(new URL('../admin-src/app/shared/account-decision-history-client.ts', import.meta.url))],
  bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'silent',
}).outputFiles[0].text;
const { readAccountDecisions } = await import('data:text/javascript;base64,' + Buffer.from(clientBundle).toString('base64'));

const owner = '1fbc76c6-8521-4f9e-b0c9-f174ada676aa';
const target = '20000000-0000-4000-8000-000000000001';
const other = '20000000-0000-4000-8000-000000000002';
const env = { ECH_ACCOUNT_DECISION_HISTORY: 'true' };
const current = { principal: { id: owner, email: 'erick@bloxlabs.tech' }, member: { active: true, application_admin: true, operational_role: 'owner' }, config: { base: 'https://example.invalid', key: 'fixture' }, token: 'fictional' };
const params = () => new URLSearchParams({ userId: target, revision: '4', offset: '0' });
const row = () => ({ at: '2026-11-01T12:00:00Z', action: 'approve', previousState: 'pending', nextState: 'approved', approvedRole: 'manager' });
const page = () => ({ schema: 1, userId: target, revision: 4, items: [row()], nextOffset: null, limitReached: false });
const noNetwork = () => assert.fail('Unexpected request');
const status = expected => error => error.status === expected;

test('history defaults off and requires the exact active owner', async () => {
  await assert.rejects(accountDecisionHistory(current, params(), {}, noNetwork), status(404));
  for (const candidate of [
    { ...current, principal: { ...current.principal, id: other } },
    { ...current, principal: { ...current.principal, email: 'other@example.invalid' } },
    { ...current, member: { ...current.member, active: false } },
    { ...current, member: { ...current.member, application_admin: false } },
    { ...current, member: { ...current.member, operational_role: 'manager' } },
  ]) await assert.rejects(accountDecisionHistory(candidate, params(), env, noNetwork), status(403));
});

test('history sends only the selected target, revision and offset', async () => {
  let calls = 0;
  const value = await accountDecisionHistory(current, params(), env, async (url, init) => {
    calls++;
    assert.ok(url.endsWith('/rpc/ech_account_decision_history'));
    assert.deepEqual(JSON.parse(init.body), { p_target: target, p_revision: 4, p_offset: 0 });
    return Response.json(page());
  });
  assert.equal(calls, 1);
  assert.deepEqual(value, page());
});

test('history rejects malformed or duplicated input before dispatch', async () => {
  for (const change of [p => p.set('userId', 'bad'), p => p.set('revision', '04'), p => p.set('revision', '0'),
    p => p.set('offset', '-1'), p => p.set('offset', '99999'), p => p.set('offset', '100001'), p => p.append('offset', '0'), p => p.set('extra', 'x')]) {
    const p = params(); change(p);
    await assert.rejects(accountDecisionHistory(current, p, env, noNetwork), status(400));
  }
});

test('history rejects wrong scope, oversized pages and extraneous private fields', async () => {
  for (const change of [v => v.userId = other, v => v.revision++, v => v.items.push(...Array.from({ length: 20 }, row)),
    v => v.items[0].fingerprint = 'private', v => v.items[0].action = 'unknown', v => v.items[0].at = 'invalid',
    v => v.nextOffset = 20, v => v.limitReached = true, v => v.items[0].nextState = 'denied', v => v.result = {}]) {
    const value = page(); change(value);
    await assert.rejects(accountDecisionHistory(current, params(), env, async () => Response.json(value)), status(502));
  }
});

test('typed client accepts a minimal page and rejects malformed responses', async () => {
  assert.deepEqual(await readAccountDecisions(async () => Response.json(page()), target, 4), page());
  for (const change of [v => v.userId = other, v => v.revision++, v => v.items[0].result = {}, v => v.items[0].approvedRole = 'owner']) {
    const value = page(); change(value);
    await assert.rejects(readAccountDecisions(async () => Response.json(value), target, 4));
  }
});
