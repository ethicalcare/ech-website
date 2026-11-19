import test from 'node:test';
import assert from 'node:assert/strict';
import {validateStaffMeetingFields} from '../admin-src/app/shared/staff-meeting-draft.ts';

const draft={title:' Fictional team meeting ',location:'Fictional office',workerId:'',
  start:'2026-11-19T09:00',end:'2026-11-19T09:30',notes:''};
test('local meeting draft needs no client and accepts Vancouver times without requiring staff',()=>{
  assert.equal(validateStaffMeetingFields(draft),null);
  assert.equal(validateStaffMeetingFields({...draft,workerId:'00000000-0000-4000-8000-000000000001'}),null);
});
test('local meeting draft rejects invalid details and reverse or malformed times',()=>{
  assert.match(validateStaffMeetingFields({...draft,title:' '}),/title and location/);
  assert.match(validateStaffMeetingFields({...draft,location:''}),/title and location/);
  assert.match(validateStaffMeetingFields({...draft,workerId:'not-an-id'}),/review the other draft fields/);
  assert.match(validateStaffMeetingFields({...draft,end:draft.start}),/after its start/);
  assert.match(validateStaffMeetingFields({...draft,start:'2026-02-30T09:00'}),/valid Vancouver/);
});
