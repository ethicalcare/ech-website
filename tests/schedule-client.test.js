import test from 'node:test';
import assert from 'node:assert/strict';
import { createScheduleClient } from '../admin-src/app/shared/schedule-client.ts';

const actor = '10000000-0000-4000-8000-000000000001';
const createClient = (fetcher, role) => createScheduleClient(fetcher, role, actor);
const from = '2026-11-01T00:00:00.000Z';
const to = '2026-11-08T00:00:00.000Z';
const range = { from, to };
const client = { id: 'ca000000-0000-4000-8000-000000000001', name: 'Fictional client' };
const worker = { id: 'ca000000-0000-4000-8000-000000000002', name: 'Fictional worker' };
const other = { id: 'ca000000-0000-4000-8000-000000000003', name: 'Second fictional worker' };
const assigned = {
  id: 'ca000000-0000-4000-8000-000000000004', clientId: client.id, workerId: worker.id,
  service: 'Home support', start: '2026-11-02T17:00:00.000Z', end: '2026-11-02T20:00:00.000Z',
  status: 'Assigned', revision: 1,
};
const reply = () => ({ schema: 1, mode: 'shared', visits: [{ ...assigned }], clients: [{ ...client }], staff: [{ ...worker }] });
const empty = () => ({ schema: 1, mode: 'shared', visits: [], clients: [], staff: [] });
const load = (value, role = 'manager') => createClient(async () => Response.json(value), role).loadSchedule(range);

test('uses the shared, same-origin GET and returns each fresh manager, owner or staff snapshot', async () => {
  const manager = reply();
  manager.staff.push(other);
  manager.visits.push(
    { ...assigned, id: 'ca000000-0000-4000-8000-000000000005', workerId: other.id, service: 'Nursing', status: 'Cancelled' },
    { ...assigned, id: 'ca000000-0000-4000-8000-000000000006', workerId: null, status: 'Open', start: '2026-10-31T23:00:00.000Z', end: '2026-11-01T01:00:00.000Z' },
  );
  const responses = [manager, empty()];
  const app = createClient(async (url, options) => {
    const parsed = new URL(url, 'https://example.invalid');
    assert.equal(parsed.pathname, '/api/admin/operations');
    assert.deepEqual([...parsed.searchParams.entries()], Object.entries(range));
    assert.deepEqual(options.headers, { Accept: 'application/json', 'X-ECH-Schedule-Actor': actor, 'X-ECH-Schedule-Role': 'manager' });
    assert.equal(options.method, 'GET');
    assert.equal(options.mode, 'same-origin');
    assert.equal(options.credentials, 'same-origin');
    assert.equal(options.redirect, 'error');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.referrerPolicy, 'no-referrer');
    assert.equal(options.body, undefined);
    assert.ok(options.signal instanceof AbortSignal);
    return Response.json(responses.shift());
  }, 'manager');
  assert.deepEqual(await app.loadSchedule(range), manager);
  assert.deepEqual(await app.loadSchedule(range), empty());
  assert.deepEqual(await load(manager, 'owner'), manager);
  assert.deepEqual(await load(reply(), 'staff'), reply());
  const emptyStaff = { ...empty(), staff: [worker] };
  assert.deepEqual(await load(emptyStaff, 'staff'), emptyStaff);
});

test('rejects invalid windows locally and distinguishes HTTP failures without reading their bodies', async () => {
  const neverFetch = createClient(async () => assert.fail('An invalid range must not fetch.'), 'manager');
  for (const bad of [
    { from: to, to: from }, { from, to: from }, { from: '0000-11-01T00:00:00.000Z', to },
    { from: '2026-02-30T00:00:00.000Z', to }, { from: '2026-11-01T00:00:00Z', to },
    { from: `${from}\n`, to }, { from, to: '2026-12-14T00:00:00.001Z' },
  ]) await assert.rejects(neverFetch.loadSchedule(bad), { code: 'invalid_request' });
  await assert.rejects(createClient(async () => assert.fail('Non-operational users must not fetch.'), null).loadSchedule(range), { code: 'forbidden' });

  for (const [status, code] of [[401, 'unauthenticated'], [403, 'forbidden'], [413, 'window_too_large'], [503, 'unavailable']]) {
    const response = new Response('untrusted provider details', { status });
    const app = createClient(async () => response, 'manager');
    await assert.rejects(app.loadSchedule(range), error => error.code === code && !error.message.includes('untrusted'));
    assert.equal(response.bodyUsed, false);
  }
  const offline = createClient(async () => { throw new Error('private network detail'); }, 'manager');
  await assert.rejects(offline.loadSchedule(range), { code: 'unavailable' });
});

test('rejects malformed, excessive or extraneous response data before callers can use it', async t => {
  for (const [label, change] of [
    ['schema', value => { value.schema = 2; }],
    ['mode', value => { value.mode = 'local'; }],
    ['envelope privacy', value => { value.diagnostics = 'private'; }],
    ['visit privacy', value => { value.visits[0].notes = 'private'; }],
    ['identity privacy', value => { value.clients[0].phone = 'private'; }],
    ['UUID with trailing newline', value => { value.visits[0].id += '\n'; }],
    ['identity UUID', value => { value.staff[0].id = 'not-a-uuid'; }],
    ['empty name', value => { value.clients[0].name = '  '; }],
    ['control character in name', value => { value.clients[0].name += '\n'; }],
    ['long name', value => { value.clients[0].name = 'A'.repeat(321); }],
    ['duplicate visit', value => { value.visits.push({ ...assigned, id: assigned.id.toUpperCase() }); }],
    ['duplicate client', value => { value.clients.push({ ...client }); }],
    ['missing client reference', value => { value.clients = []; }],
    ['missing worker reference', value => { value.staff = []; }],
    ['unknown service', value => { value.visits[0].service = 'Other'; }],
    ['unknown status', value => { value.visits[0].status = 'Deleted'; }],
    ['open with assigned worker', value => { value.visits[0].status = 'Open'; }],
    ['assigned without worker', value => { value.visits[0].workerId = null; }],
    ['zero revision', value => { value.visits[0].revision = 0; }],
    ['unsafe revision', value => { value.visits[0].revision = Number.MAX_SAFE_INTEGER + 1; }],
    ['invalid timestamp', value => { value.visits[0].start = '2026-02-30T00:00:00.000Z'; }],
    ['zero duration', value => { value.visits[0].end = assigned.start; }],
    ['ends at window start', value => { Object.assign(value.visits[0], { start: '2026-10-31T00:00:00.000Z', end: from }); }],
    ['starts at window end', value => { Object.assign(value.visits[0], { start: to, end: '2026-11-09T00:00:00.000Z' }); }],
    ['excess visits', value => { value.visits = Array(1001).fill(assigned); }],
    ['excess clients', value => { value.clients = Array(1001).fill(client); }],
    ['excess staff', value => { value.staff = Array(1002).fill(worker); }],
  ]) await t.test(label, async () => {
    const value = reply(); change(value);
    await assert.rejects(load(value), { code: 'invalid_response' });
  });
  await assert.rejects(load(null), { code: 'invalid_response' });
  for (const response of [
    new Response(JSON.stringify(reply()), { headers: { 'Content-Type': 'text/html' } }),
    new Response('{broken', { headers: { 'Content-Type': 'application/json' } }),
    new Response(` ${' '.repeat(2_000_000)}`, { headers: { 'Content-Type': 'application/json' } }),
  ]) await assert.rejects(createClient(async () => response, 'manager').loadSchedule(range), { code: 'invalid_response' });
});

test('staff only accepts a single worker and visits assigned to that worker excluding cancellations', async () => {
  const cancelled = reply(); cancelled.visits[0].status = 'Cancelled';
  const open = reply(); Object.assign(open.visits[0], { status: 'Open', workerId: null });
  const twoWorkers = reply();
  twoWorkers.staff.push(other);
  twoWorkers.visits.push({ ...assigned, id: 'ca000000-0000-4000-8000-000000000005', workerId: other.id });
  for (const value of [cancelled, open, twoWorkers, empty(), { ...reply(), staff: [other] }]) {
    await assert.rejects(load(value, 'staff'), { code: 'invalid_response' });
  }
});

test('honors caller cancellation before fetch, during fetch and while reading the response', async () => {
  const before = new AbortController(); before.abort();
  const idle = createClient(async () => assert.fail('Aborted request must not fetch.'), 'manager');
  await assert.rejects(idle.loadSchedule(range, before.signal), { name: 'AbortError' });

  const inFlight = new AbortController();
  let passedSignal;
  const pending = createClient(async (_url, { signal }) => {
    passedSignal = signal;
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  }, 'manager').loadSchedule(range, inFlight.signal);
  inFlight.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(passedSignal.aborted, true);

  const duringBody = new AbortController();
  let body;
  const bodyStarted = new Promise(resolve => { body = resolve; });
  const reading = createClient(async (_url, { signal }) => {
    const stream = new ReadableStream({
      start(controller) { signal.addEventListener('abort', () => controller.error(signal.reason), { once: true }); },
      pull() { body(); },
    });
    return new Response(stream, { headers: { 'Content-Type': 'application/json' } });
  }, 'manager').loadSchedule(range, duringBody.signal);
  await bodyStarted;
  duringBody.abort();
  await assert.rejects(reading, { name: 'AbortError' });
});

test('calendar loads and errors do not touch browser persistence', async t => {
  for (const name of ['localStorage', 'sessionStorage', 'indexedDB', 'caches']) {
    t.mock.getter(Object.defineProperty(globalThis, name, { configurable: true, get: () => undefined }), name,
      () => assert.fail(`Unexpected ${name} access`));
  }
  assert.deepEqual(await load(reply()), reply());
  await assert.rejects(load({ ...reply(), notes: 'private' }), { code: 'invalid_response' });
});

test('manager roster accepts eligible workers without visits and keeps historical assignment labels', async () => {
  const vacant = { ...empty(), staff: [worker, other] };
  for (const role of ['manager', 'owner']) {
    assert.deepEqual(await load(vacant, role), vacant);
    const historical = reply(); historical.staff.push(other);
    assert.deepEqual(await load(historical, role), historical);
  }
  await assert.rejects(load(vacant, 'staff'), { code: 'invalid_response' });
  const bounded = { ...empty(), staff: Array.from({length: 1001}, (_, n) => ({id: `ca000000-0000-4000-8000-${String(n).padStart(12, '0')}`, name: 'Fictional worker'})) };
  assert.equal((await load(bounded)).staff.length, 1001);
  bounded.staff.push({ id: 'ca000000-0000-4000-8000-999999999999', name: 'Overflow' });
  await assert.rejects(load(bounded), { code: 'invalid_response' });
});
