import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const bundle=await build({entryPoints:[fileURLToPath(new URL('../admin-src/app/shared/today-interval.ts',import.meta.url))],bundle:true,write:false,platform:'node',format:'esm'});
import {focusedCalendarWindow,visitsOnDay} from '../admin-src/app/shared/schedule-calendar.ts';
import {scheduleDay} from '../admin-src/app/shared/schedule-window.ts';
const {todayPhase,todayInstantLabel,todayGroupKey}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const todayWindow=day=>focusedCalendarWindow(day,'day'); const todayDay=scheduleDay;
test('Vancouver legal calendar midnight uses historical DST and post-2026 permanent time',()=>{
 assert.deepEqual(todayWindow('2025-03-09'),{from:'2025-03-09T08:00:00.000Z',to:'2025-03-10T07:00:00.000Z'});
 assert.deepEqual(todayWindow('2025-11-02'),{from:'2025-11-02T07:00:00.000Z',to:'2025-11-03T08:00:00.000Z'});
 assert.deepEqual(todayWindow('2026-11-01'),{from:'2026-11-01T07:00:00.000Z',to:'2026-11-02T07:00:00.000Z'});
 assert.equal(todayDay('2026-11-01T07:30:00.000Z'),'2026-11-01');
});
test('existing calendar predicate strictly overlaps including full and multiday records',()=>{
 const mk=(id,start,end)=>({id,start,end});
 const rows=[mk('ends-at-start','2026-11-20T06:00:00.000Z','2026-11-21T07:00:00.000Z'),mk('starts-at-end','2026-11-22T07:00:00.000Z','2026-11-22T08:00:00.000Z'),mk('24h','2026-11-21T07:00:00.000Z','2026-11-22T07:00:00.000Z'),mk('multi','2026-11-19T07:00:00.000Z','2026-11-23T07:00:00.000Z'),mk('overnight','2026-11-21T06:00:00.000Z','2026-11-21T08:00:00.000Z')];
 assert.deepEqual(visitsOnDay(rows,'2026-11-21').map(v=>v.id),['multi','overnight','24h']);
});
test('true instant identity and offsets disambiguate repeated historical local hour',()=>{
 const a='2025-11-02T08:30:00.000Z',b='2025-11-02T09:30:00.000Z';
 assert.match(todayInstantLabel(a),/UTC-07:00/);assert.match(todayInstantLabel(b),/UTC-08:00/);
 assert.notEqual(todayGroupKey({service:'Nursing',start:a,end:b,status:'Assigned'}),todayGroupKey({service:'Nursing',start:b,end:'2025-11-02T10:30:00.000Z',status:'Assigned'}));
});
test('active phase obeys half-open actual interval',()=>{
 const v={start:'2025-11-02T08:30:00.000Z',end:'2025-11-02T09:30:00.000Z'};
 assert.equal(todayPhase(v,'2025-11-02T08:29:59.999Z'),'Later');
 assert.equal(todayPhase(v,v.start),'Active now');assert.equal(todayPhase(v,v.end),'Elapsed');
});
