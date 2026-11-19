import {useId,useLayoutEffect,useRef,useState,type FormEvent} from 'react';
import type {ScheduleIdentity} from './schedule-client';
import {validateStaffMeetingFields,type StaffMeetingFields} from './staff-meeting-draft';
import './shared-schedule-commands.css';

const empty:StaffMeetingFields={title:'',location:'',workerId:'',start:'',end:'',notes:''};

export function StaffMeetingDraft({staff,active,onDirtyChange}:{
  staff:ScheduleIdentity[];active:boolean;onDirtyChange:(dirty:boolean)=>void;
}) {
  const id=useId(),heading=useRef<HTMLHeadingElement>(null);
  const [draft,setDraft]=useState(empty);
  const [checked,setChecked]=useState<{error:string|null}|null>(null);
  const dirty=Object.values(draft).some(Boolean);
  useLayoutEffect(()=>{if(active)heading.current?.focus({preventScroll:true});},[active]);
  useLayoutEffect(()=>onDirtyChange(dirty),[dirty,onDirtyChange]);
  const update=(key:keyof StaffMeetingFields,value:string)=>{
    setDraft(previous=>({...previous,[key]:value}));setChecked(null);
  };
  function check(event:FormEvent) {
    event.preventDefault();
    if(active)setChecked({error:validateStaffMeetingFields(draft)});
  }
  return <section className="shared-schedule-commands" aria-labelledby={`${id}-heading`}>
    <h2 id={`${id}-heading`} ref={heading} tabIndex={-1}>Staff meeting draft</h2>
    <p>This draft stays in this open form. Checking it does not save a meeting, add it to the calendar, send an invitation, or record care or payroll hours.</p>
    {active&&<form onSubmit={check}><fieldset>
      <legend>Meeting details</legend>
      <label htmlFor={`${id}-title`}>Meeting title</label><input id={`${id}-title`} required maxLength={160} value={draft.title} onChange={event=>update('title',event.target.value)}/>
      <label htmlFor={`${id}-location`}>Meeting location</label><input id={`${id}-location`} required maxLength={500} value={draft.location} onChange={event=>update('location',event.target.value)}/>
      <label htmlFor={`${id}-start`}>Meeting start · Vancouver</label><input id={`${id}-start`} type="datetime-local" step="0.001" required value={draft.start} onChange={event=>update('start',event.target.value)}/>
      <label htmlFor={`${id}-end`}>Meeting end · Vancouver</label><input id={`${id}-end`} type="datetime-local" step="0.001" required value={draft.end} onChange={event=>update('end',event.target.value)}/>
      <label htmlFor={`${id}-staff`}>Staff member (optional)</label><select id={`${id}-staff`} value={draft.workerId} onChange={event=>update('workerId',event.target.value)}>
        <option value="">No staff member selected</option>{staff.map(person=><option key={person.id} value={person.id}>{person.name}</option>)}
      </select>
      <label htmlFor={`${id}-notes`}>Meeting notes (optional)</label><input id={`${id}-notes`} maxLength={2000} value={draft.notes} onChange={event=>update('notes',event.target.value)}/>
      <button type="submit">Check meeting draft</button>
    </fieldset>
    {checked&&(checked.error?<p role="alert">{checked.error}</p>:<p role="status">Meeting draft checked. Nothing was saved.</p>)}
    </form>}
  </section>;
}
