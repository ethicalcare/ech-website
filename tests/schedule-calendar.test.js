import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {calendarDays,calendarReadWindow,visitsOnDay} from '../admin-src/app/shared/schedule-calendar.ts';
test('calendar view dates and bounded read cover day/week/month including leap and month-end',()=>{
 assert.deepEqual(calendarDays('2026-11-17','day'),['2026-11-17']);assert.equal(calendarDays('2026-12-30','week').at(-1),'2027-01-05');
 assert.equal(calendarDays('2024-02-20','month').length,29);assert.equal(calendarDays('2026-02-20','month').length,28);
 assert.deepEqual(calendarReadWindow('2026-12-30'),{from:'2026-12-01T07:00:00.000Z',to:'2027-01-12T07:00:00.000Z'});
 const historical=calendarReadWindow('2025-11-15');assert.ok(Date.parse(historical.to)-Date.parse(historical.from)<43*86400000);
 for(const invalid of ['2026-02-30','bad',''])assert.throws(()=>calendarDays(invalid,'month'));
});
test('overlapping and midnight-spanning visits keep original times and separate stable items',()=>{
 const visits=[{id:'b',start:'2026-11-18T06:30:00.000Z',end:'2026-11-18T07:30:00.000Z'},{id:'a',start:'2026-11-18T06:30:00.000Z',end:'2026-11-18T07:00:00.000Z'}];
 const before=JSON.stringify(visits);assert.deepEqual(visitsOnDay(visits,'2026-11-17').map(v=>v.id),['a','b']);assert.deepEqual(visitsOnDay(visits,'2026-11-18').map(v=>v.id),['b']);assert.equal(JSON.stringify(visits),before);
});
test('calendar overflow stays inside focusable native scroll region without vertical scroll trapping',async()=>{
 const css=await readFile(new URL('../admin-src/app/shared/shared-schedule-calendar.css',import.meta.url),'utf8');assert.match(css,/min-width:0;max-width:100%;max-height:70vh;overflow:auto;overscroll-behavior-x:contain;overscroll-behavior-y:auto/);assert.match(css,/overflow-wrap:anywhere/);assert.doesNotMatch(css,/position:absolute|overflow:hidden|white-space:nowrap/);
 const source=await readFile(new URL('../admin-src/app/shared/SharedScheduleRead.tsx',import.meta.url),'utf8');assert.match(source,/aria-label="Visit calendar" tabIndex=\{0\}/);assert.doesNotMatch(source,/onWheel=|onTouchMove=/);
});
