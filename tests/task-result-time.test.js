import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const dir=await mkdtemp(join(tmpdir(),'ech-task-result-time-'));
after(()=>rm(dir,{recursive:true,force:true}));
const bundle=join(dir,'time.mjs');
await build({entryPoints:[new URL('../admin-src/app/shared/task-result-time.ts',import.meta.url).pathname],bundle:true,platform:'node',format:'esm',outfile:bundle,logLevel:'silent'});
const {taskResultActualTime,sameTaskResultInstant}=await import(pathToFileURL(bundle));
test('unchanged correction preserves exact database precision and offset',()=>{
 assert.equal(taskResultActualTime('2026-11-16T10:00:00.123','2026-11-16T17:00:00.123456Z'),'2026-11-16T17:00:00.123456Z');
 assert.equal(taskResultActualTime('2026-11-16T10:00:00.123','2026-11-16T10:00:00.123456-07:00'),'2026-11-16T10:00:00.123456-07:00');
});
test('either saved historical repeated-hour instant can be corrected without changing time',()=>{
 for(const original of ['2025-11-02T08:30:00.000Z','2025-11-02T09:30:00.000Z'])assert.equal(taskResultActualTime('2025-11-02T01:30:00.000',original),original);
});
test('new or intentionally edited times still use strict Vancouver validation',()=>{
 assert.equal(taskResultActualTime('2026-11-16T10:01','2026-11-16T17:00:00.123456Z'),'2026-11-16T17:01:00.000Z');
 assert.equal(taskResultActualTime('2026-11-16T10:01'),'2026-11-16T17:01:00.000Z');
 for(const value of ['2025-11-02T01:31','2025-03-09T02:30','invalid',''])assert.throws(()=>taskResultActualTime(value,'2025-11-02T08:30:00.000Z'),RangeError);
});
test('readback rejects distinct microseconds but accepts equivalent offset and precision representations',()=>{
 assert.equal(sameTaskResultInstant('2026-11-16T17:00:00.123456Z','2026-11-16T17:00:00.123457Z'),false);
 assert.equal(sameTaskResultInstant('2026-11-16T17:00:00.123456Z','2026-11-16T10:00:00.123456-07:00'),true);
 assert.equal(sameTaskResultInstant('2026-11-16T17:00:00.1Z','2026-11-16T17:00:00.100000Z'),true);
 assert.equal(sameTaskResultInstant('2026-11-16T17:00:00Z','2026-11-16T17:00:00.000001Z'),false);
 assert.equal(sameTaskResultInstant('invalid','invalid'),false);
});
test('component pins original time into correction draft and applies exact comparison to actual and recorded times',async()=>{
 const source=await readFile(new URL('../admin-src/app/shared/SharedVisitTaskResults.tsx',import.meta.url),'utf8');
 assert.match(source,/originalActualAt:result\?\.actualAt/);
 assert.match(source,/actualAt:taskResultActualTime\(draft.actualAt,draft.originalActualAt\)/);
 assert.match(source,/!sameTaskResultInstant\(result.actualAt,request.actualAt\)/);
 assert.match(source,/!sameTaskResultInstant\(result.recordedAt,receipt.recordedAt\)/);
});
