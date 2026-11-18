import test from 'node:test';
import assert from 'node:assert/strict';
import {reportUtcTime} from '../admin-src/app/shared/visit-time.ts';
import {isVisitAction} from '../lib/operations/visit-action-wire.js';
import {isVisitReport} from '../lib/operations/visit-report-wire.js';

const visitId='20000000-0000-4000-8000-000000000001';
const operationId='30000000-0000-4000-8000-000000000001';
const actorId='10000000-0000-4000-8000-000000000001';
const recordedAt='2026-11-03T12:00:00.000Z';
function verify(from,to,expectedHours,expectedAccepted) {
  const actualStart=reportUtcTime(from), actualEnd=reportUtcTime(to);
  assert.equal((Date.parse(actualEnd)-Date.parse(actualStart))/3600000,expectedHours);
  const common={summary:'Fictional support tasks',issue:'',observations:'',actualStart,actualEnd,completedTasks:['Fictional task']};
  const report={schema:1,visitId,visitRevision:3,reportRevision:1,versions:[{...common,revision:1,version:0,sourceRevision:null,actorId,actorRole:'staff',recordedAt,outcome:'completed',reason:null}],reviews:[]};
  assert.equal(isVisitReport(report,visitId,3,1),expectedAccepted);
  const envelope={schema:1,visitId,operationId,visitRevision:3,membershipRevision:1};
  assert.equal(isVisitAction({...envelope,reportRevision:0,command:{...common,type:'submit',outcome:'completed'}},Date.parse(recordedAt)),expectedAccepted);
  assert.equal(isVisitAction({...envelope,reportRevision:1,command:{...common,type:'correct',reason:'Fictional correction'}},Date.parse(recordedAt)),expectedAccepted);
}

test('8 h and 12 h elapsed overnight survive Vancouver November 2026 cutover date',()=>{
  verify('2026-10-31T22:00','2026-11-01T06:00',8,true);
  verify('2026-10-31T22:00','2026-11-01T10:00',12,true);
});
test('exactly 24 h passes; additional millisecond fails read, submit and correct',()=>{
  verify('2026-10-31T12:00','2026-11-01T11:59:59.999',86399999/3600000,true);
  verify('2026-10-31T12:00','2026-11-01T12:00',24,true);
  verify('2026-10-31T12:00','2026-11-01T12:00:00.001',86400001/3600000,false);
});
test('historical fallback adds one actual hour without inventing a payable classification',()=>{
  verify('2025-11-01T22:00','2025-11-02T06:00',9,true);
  verify('2025-11-01T22:00','2025-11-02T10:00',13,true);
});
test('zero, reverse and future intervals remain rejected',()=>{
  verify('2026-11-01T12:00','2026-11-01T12:00',0,false);
  verify('2026-11-01T12:00','2026-11-01T11:00',-1,false);
  verify('2026-11-04T12:00','2026-11-05T12:00',24,false);
});
test('historical 24 civil hours on fallback day still exceed 24 elapsed hours',()=>{
  verify('2025-11-01T12:00','2025-11-02T12:00',25,false);
  verify('2025-11-01T12:00','2025-11-02T11:00',24,true);
});
