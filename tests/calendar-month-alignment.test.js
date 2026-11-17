import test from 'node:test';
import assert from 'node:assert/strict';
import {calendarDays,calendarWeekday,calendarWeekdays} from '../admin-src/app/shared/schedule-calendar.ts';
test('month first date aligns Sunday through Saturday and retains exact days',()=>{
 const months=['2026-11-01','2027-02-01','2026-12-01','2026-04-01','2024-02-01','2027-01-01','2026-08-01'];
 months.forEach((first,index)=>{assert.equal(calendarWeekday(first),index);const days=calendarDays(first,'month');assert.equal(new Set(days).size,days.length);assert.equal(days[0],first);days.forEach((day,i)=>assert.equal(calendarWeekday(day),(index+i)%7));});
 assert.equal(calendarDays('2024-02-15','month').length,29);assert.equal(calendarWeekdays[calendarWeekday('2024-02-29')],'Thursday');assert.throws(()=>calendarWeekday('2026-02-30'));
});
