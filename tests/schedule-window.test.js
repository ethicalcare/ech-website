import test from 'node:test';
import assert from 'node:assert/strict';
import {scheduleWeek,scheduleDay,scheduleLabel} from '../admin-src/app/shared/schedule-window.ts';
import {reportLocalTime,reportUtcTime} from '../admin-src/app/shared/visit-time.ts';
test('calendar week uses Vancouver civil midnights and preserves original instants',()=>{
 assert.deepEqual(scheduleWeek('2026-11-17'),{from:'2026-11-17T07:00:00.000Z',to:'2026-11-24T07:00:00.000Z'});
 const night=['2026-11-18T06:30:00.000Z','2026-11-18T07:30:00.000Z'];
 assert.equal(scheduleLabel(night[0]),'2026-11-17 23:30 Vancouver');assert.equal(scheduleLabel(night[1]),'2026-11-18 00:30 Vancouver');
 assert.equal(scheduleDay(night[0]),'2026-11-17');assert.equal(scheduleDay(night[1]),'2026-11-18');
 for(const instant of night)assert.equal(reportUtcTime(reportLocalTime(instant)),instant);
});
test('historical clock changes retain seven civil dates, not fixed elapsed hours',()=>{
 assert.deepEqual(scheduleWeek('2025-10-30'),{from:'2025-10-30T07:00:00.000Z',to:'2025-11-06T08:00:00.000Z'});
 assert.deepEqual(scheduleWeek('2025-03-06'),{from:'2025-03-06T08:00:00.000Z',to:'2025-03-13T07:00:00.000Z'});
 for(const bad of ['2026-02-30','2026-1-01','','2026-11-17T00:00','not a date'])assert.throws(()=>scheduleWeek(bad));
});
