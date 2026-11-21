import assert from 'node:assert/strict';
import test from 'node:test';
import {formatReportedElapsed} from '../admin-src/app/shared/visit-time.ts';

test('reported elapsed time uses the exact saved instants without rounding',()=>{
 assert.equal(formatReportedElapsed('2026-11-19T17:00:00.000Z','2026-11-19T18:45:00.000Z'),'1 h 45 min');
 assert.equal(formatReportedElapsed('2026-11-19T17:00:10.000Z','2026-11-19T17:00:10.015Z'),'0.015 sec');
 assert.equal(formatReportedElapsed('2026-11-19T17:00:10.003Z','2026-11-19T17:01:39.503Z'),'1 min 29.5 sec');
 assert.equal(formatReportedElapsed('2026-11-19T17:00:00.000Z','2026-11-20T16:59:59.999Z'),'23 h 59 min 59.999 sec');
 assert.equal(formatReportedElapsed('2026-11-19T17:00:00.000Z','2026-11-20T17:00:00.000Z'),'24 h');
});

test('reported elapsed time is independent of the local date or clock-change boundary',()=>{
 assert.equal(formatReportedElapsed('2026-11-20T06:55:00.000Z','2026-11-20T07:20:00.000Z'),'25 min');
 assert.equal(formatReportedElapsed('2025-11-02T08:30:00.000Z','2025-11-02T09:30:00.000Z'),'1 h');
});

test('missing, invalid, noncanonical, reversed or excessive report instants never become zero hours',()=>{
 const start='2026-11-19T17:00:00.000Z';
 for(const end of [undefined,null,'','2026-11-19T18:00:00Z','2026-11-19T18:00:00.000-08:00',
  '2026-02-30T18:00:00.000Z',start,'2026-11-19T16:59:59.999Z','2026-11-20T17:00:00.001Z'])
  assert.equal(formatReportedElapsed(start,end),null);
 assert.equal(formatReportedElapsed(undefined,start),null);
});
