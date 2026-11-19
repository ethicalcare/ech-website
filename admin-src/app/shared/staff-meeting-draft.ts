import {isAppointmentDraft} from '../../../lib/operations/appointment-draft-wire.js';
import {reportUtcTime} from './visit-time.ts';

export type StaffMeetingFields={title:string;location:string;workerId:string;start:string;end:string;notes:string};

// This is a local draft only. Never give it to the shared visit writer.
export function validateStaffMeetingFields(fields:StaffMeetingFields) {
  let start:string,end:string;
  try {
    start=reportUtcTime(fields.start);
    end=reportUtcTime(fields.end);
  } catch {
    return 'Enter valid Vancouver start and end times.';
  }
  if(start>=end)return 'The meeting end must be after its start.';
  const draft={kind:'Staff meeting',title:fields.title.trim(),location:fields.location.trim(),
    workerId:fields.workerId||null,start,end,notes:fields.notes.trim()};
  return isAppointmentDraft(draft)?null:'Enter a meeting title and location and review the other draft fields.';
}
