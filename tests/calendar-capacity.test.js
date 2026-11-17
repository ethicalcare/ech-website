import test from 'node:test';
import assert from 'node:assert/strict';
import {focusedCalendarWindow} from '../admin-src/app/shared/schedule-calendar.ts';
test('focused calendar windows narrow dates without increasing server limits',()=>{
 assert.deepEqual(focusedCalendarWindow('2026-11-17','day'),{from:'2026-11-17T07:00:00.000Z',to:'2026-11-18T07:00:00.000Z'});
 assert.deepEqual(focusedCalendarWindow('2026-11-17','week'),{from:'2026-11-17T07:00:00.000Z',to:'2026-11-24T07:00:00.000Z'});
 const dst=focusedCalendarWindow('2025-11-02','day');assert.equal(Date.parse(dst.to)-Date.parse(dst.from),25*3600000);
 assert.throws(()=>focusedCalendarWindow('2026-02-30','day'));
});

test('focused read still rejects over-cap responses instead of silently truncating',async()=>{
 const {createScheduleClient}=await import('../admin-src/app/shared/schedule-client.ts');const actor='10000000-0000-4000-8000-000000000001';
 const client=createScheduleClient(async()=>Response.json({schema:1,mode:'shared',clients:[],staff:[{id:actor,name:'Worker'}],visits:Array(1001).fill({})}),'staff',actor);
 await assert.rejects(client.loadSchedule(focusedCalendarWindow('2026-11-17','day'),new AbortController().signal));
});
