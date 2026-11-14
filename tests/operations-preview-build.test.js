import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('standalone preview builds matching scripts with its own storage key', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ech-preview-build-'));
  try {
    execFileSync(process.execPath, ['scripts/build-operations-preview.mjs', directory]);
    const files = ['prototype.js', 'schedule-review.js', 'demo-persistence-core.js', 'demo-persistence.js'];
    for (const file of files) execFileSync(process.execPath, ['--check', join(directory, file)]);
    const source = name => readFileSync(join(directory, name), 'utf8');
    assert.match(source('prototype.js'), /let reportSavePending=false/);
    assert.match(source('schedule-review.js'), /if\(reportSavePending\)return/);
    assert.match(source('demo-persistence.js'), /persistReport=async update/);
    for (const file of ['demo-persistence-core.js', 'demo-persistence.js']) {
      assert.match(source(file), /ech-named-design:fictional-saved-v1/);
      assert.doesNotMatch(source(file), /(?:KEY|key)=storageKey/);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
