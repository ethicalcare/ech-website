import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const { build } = createRequire(import.meta.url)('esbuild');
const directory = await mkdtemp(join(tmpdir(), 'ech-task-timeline-'));
after(() => rm(directory, { recursive: true, force: true }));
const bundle = join(directory, 'timeline.mjs');
await build({ entryPoints: [new URL('../admin-src/app/shared/visit-task-timeline.ts', import.meta.url).pathname], bundle: true, platform: 'node', format: 'esm', outfile: bundle, logLevel: 'silent' });
const { orderedTaskEvents, taskEventLocalTime } = await import(pathToFileURL(bundle));
const event = (taskId, actualAt, recordedAt = '2026-11-16T18:00:00Z', version = 1) => ({ taskId, actualAt, recordedAt, version, outcome: 'done', observation: '', actorId: 'actor', reason: null });
test('actual microsecond chronology takes priority over when an entry was recorded', () => {
  const earlier = event('earlier', '2026-11-16T17:00:00.123001Z', '2026-11-16T19:00:00Z');
  const later = event('later', '2026-11-16T17:00:00.123999Z', '2026-11-16T18:00:00Z');
  const input = [later, earlier];
  assert.deepEqual(orderedTaskEvents(input), [earlier, later]);
  assert.deepEqual(input, [later, earlier]);
});
test('equivalent offset instants use full recorded time as the tie-breaker', () => {
  const earlier = event('z', '2026-11-16T10:00:00.1-07:00', '2026-11-16T18:00:00.000001Z');
  const later = event('a', '2026-11-16T17:00:00.100000Z', '2026-11-16T18:00:00.000002Z');
  assert.deepEqual(orderedTaskEvents([later, earlier]), [earlier, later]);
});
test('different fractional widths and second boundaries remain chronological', () => {
  const events = ['2026-11-16T17:00:01Z', '2026-11-16T17:00:00.999999Z', '2026-11-16T17:00:00.01Z', '2026-11-16T17:00:00.001001Z'].map((time, index) => event(String(index), time));
  assert.deepEqual(orderedTaskEvents(events), [...events].reverse());
});
test('equal instants retain every correction with deterministic task and version ordering', () => {
  const time = '2026-11-16T17:00:00Z';
  const original = event('a', time), correction = event('a', time, undefined, 2), other = event('b', time);
  assert.deepEqual(orderedTaskEvents([other, correction, original]), [original, correction, other]);
  assert.deepEqual(orderedTaskEvents([]), []);
});
test('visible Vancouver timestamps preserve database fractional precision', () => {
  assert.equal(taskEventLocalTime('2026-11-16T17:00:00.123001Z'), '2026-11-16 10:00:00.123001');
  assert.equal(taskEventLocalTime('2026-11-16T10:00:00.123999-07:00'), '2026-11-16 10:00:00.123999');
  assert.equal(taskEventLocalTime('2026-11-16T17:00:00.1Z'), '2026-11-16 10:00:00.100');
  assert.equal(taskEventLocalTime('2025-01-15T17:00:00.123456Z'), '2025-01-15 09:00:00.123456');
});
