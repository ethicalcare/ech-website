import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const { build } = createRequire(import.meta.url)('esbuild');
const directory = await mkdtemp(join(tmpdir(), 'ech-visit-time-'));
after(() => rm(directory, {recursive:true, force:true}));
const bundle = join(directory, 'time.mjs');
await build({entryPoints:[new URL('../admin-src/app/shared/visit-time.ts', import.meta.url).pathname], bundle:true, platform:'node', format:'esm', outfile:bundle, logLevel:'silent'});
const {reportLocalTime, reportUtcTime} = await import(pathToFileURL(bundle));

test('Vancouver entry converts to UTC and preserves precise saved timestamps', () => {
  assert.equal(reportUtcTime('2026-11-01T10:00'), '2026-11-01T17:00:00.000Z');
  assert.equal(reportLocalTime('2026-11-01T17:00:34.123Z'), '2026-11-01T10:00:34.123');
  assert.equal(reportUtcTime(reportLocalTime('2025-01-15T17:30:34.123Z')), '2025-01-15T17:30:34.123Z');
  assert.equal(reportUtcTime('2026-03-08T03:00'), '2026-03-08T10:00:00.000Z');
});

test('invalid and historically ambiguous or missing Vancouver times are rejected', () => {
  for (const local of ['2026-02-30T10:00', '2025-11-02T01:30', '2025-03-09T02:30', 'bad']) {
    assert.throws(() => reportUtcTime(local), RangeError);
  }
});
