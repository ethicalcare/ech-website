import type {ScheduleIdentity} from './schedule-client';
export type ScheduleStaffSelection={ids:string[]|null;unassigned:boolean;query:string};
// Presentation only: roster and visits have already passed the scoped read.
export function ScheduleStaffFilter({staff,value,onChange,disabled=false}:{staff:ScheduleIdentity[];value:ScheduleStaffSelection;onChange:(value:ScheduleStaffSelection)=>void;disabled?:boolean}){
 const shown=staff.filter(person=>person.name.toLocaleLowerCase().includes(value.query.trim().toLocaleLowerCase()));
 const selected=staff.filter(person=>value.ids===null||value.ids.includes(person.id)).length;
 function toggle(id:string){const ids=new Set(value.ids??staff.map(person=>person.id));if(ids.has(id))ids.delete(id);else ids.add(id);onChange({...value,ids:[...ids]});}
 return <fieldset disabled={disabled}><legend>Filter schedule by staff</legend>
  <label>Search permitted staff<input type="search" value={value.query} onChange={event=>onChange({...value,query:event.currentTarget.value})}/></label>
  <p role="status">{shown.length} matching {shown.length===1?'staff choice':'staff choices'} shown. {selected} of {staff.length} permitted staff selected. Search changes the choices shown, not the selected visits.</p>
  <button type="button" onClick={()=>onChange({...value,ids:null})}>All staff</button><button type="button" onClick={()=>onChange({...value,ids:[]})}>Clear staff</button>
  {shown.length?<ul>{shown.map(person=><li key={person.id}><label><input type="checkbox" checked={value.ids===null||value.ids.includes(person.id)} onChange={()=>toggle(person.id)}/>{person.name}</label></li>)}</ul>:<p>No permitted staff match this search.</p>}
  <label><input type="checkbox" checked={value.unassigned} onChange={event=>onChange({...value,unassigned:event.currentTarget.checked})}/>Show unassigned visits</label>
  <p>Selection does not establish staff availability, travel suitability or permission to assign visits.</p>
 </fieldset>;
}
