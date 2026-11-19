import test from 'node:test';
import assert from 'node:assert/strict';
import {appointmentKinds,isAppointmentDraft} from '../lib/operations/appointment-draft-wire.js';
import {isScheduleCreation} from '../lib/operations/schedule-create-wire.js';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const common={workerId:id(1),start:'2026-11-18T17:00:00.000Z',end:'2026-11-18T17:30:00.000Z',notes:''};
const source={clientId:id(2),clientName:'Fictional client',service:'Home support',area:'Fictional area',instructionsVersion:1,instructionsSavedAt:'2026-11-01T00:00:00.000001Z',confirmedAt:'2026-11-01T00:01:00.000001Z',inquiryId:null,inquiryRevision:null,sourceToken:'a'.repeat(64)};
const request={schema:1,operationId:id(3),visitId:id(4),visitRevision:0,membershipRevision:1,command:{type:'create',clientId:id(2),workerId:id(1),service:'Home support',source,start:common.start,end:common.end}};
const meetings=[{kind:'Referral partner meeting',...common,organization:'Fictional partner',location:'Fictional office'},{kind:'Staff meeting',...common,title:'Fictional team check-in',location:'Fictional office'}];
test('four distinct draft kinds keep care behind its unchanged creation contract',()=>{
 assert.deepEqual(appointmentKinds,['Care visit','Assessment','Referral partner meeting','Staff meeting']);assert(Object.isFrozen(appointmentKinds));
 const valid={kind:'Care visit',request};const before=JSON.stringify(valid);assert(isAppointmentDraft(valid));assert.equal(JSON.stringify(valid),before);
 for(const c of [{...request.command,source:null},{...request.command,clientId:null},{...request.command,service:'Staff meeting'}])assert.equal(isAppointmentDraft({kind:'Care visit',request:{...request,command:c}}),false);
 const planned={...request,command:{...request.command,taskPlanToken:'b'.repeat(64)}};
 assert.equal(isAppointmentDraft({kind:'Care visit',request:planned}),false);assert.equal(isAppointmentDraft({kind:'Care visit',request:planned},{allowTaskPlan:true}),true);
});
test('meetings require their own context, no fake client or care-hour/report fields',()=>{
 for(const meeting of meetings){assert(isAppointmentDraft(meeting));assert.equal(isScheduleCreation(meeting),false);
  for(const field of ['clientId','service','source','careHours','actualStart','completedTasks','clinicalPermission'])assert.equal(isAppointmentDraft({...meeting,[field]:null}),false,field);
  assert.equal(isAppointmentDraft({...meeting,location:''}),false);assert(isAppointmentDraft({...meeting,workerId:null}));
 }
 assert.equal(isAppointmentDraft({...meetings[0],organization:''}),false);assert.equal(isAppointmentDraft({...meetings[1],title:''}),false);
});
test('assessment retains its client and explicit purpose without implying clinical authority',()=>{
 for(const purpose of ['Clinical assessment','Management introduction']){const draft={kind:'Assessment',...common,clientId:id(2),purpose};assert(isAppointmentDraft(draft));assert.equal(isScheduleCreation(draft),false);assert.equal(isAppointmentDraft({...draft,clientId:null}),false);assert.equal(isAppointmentDraft({...draft,permission:true}),false);}
 assert.equal(isAppointmentDraft({kind:'Assessment',...common,clientId:id(2),purpose:'Care visit'}),false);
});
test('non-care draft validation rejects malformed times, extra fields and unbounded text',()=>{
 for(const draft of meetings){for(const change of [{start:common.end},{end:'2026-02-30T17:00:00.000Z'},{start:'2026-11-18T17:00:00-07:00'},{workerId:'fictional-name'},{notes:'x'.repeat(2001)},{notes:'hidden\u0000data'},{location:'x'.repeat(501)},{kind:'Meeting'}])assert.equal(isAppointmentDraft({...draft,...change}),false);}
 for(const value of [null,[],{},'Staff meeting'])assert.equal(isAppointmentDraft(value),false);
});
