import {adjacentCalendarDate} from './calendar-adjacent-navigation';
import type {CalendarView} from './schedule-calendar';
// Parent remains responsible for draft/leave checks before accepting a date.
export function CalendarAdjacentButtons({day,view,disabled=false,onNavigate}:{day:string;view:CalendarView;disabled?:boolean;onNavigate:(day:string)=>void}){
 function target(direction:-1|1){try{return adjacentCalendarDate(day,view,direction);}catch{return null;}}
 const previous=target(-1),next=target(1);
 return <span role="group" aria-label="Adjacent calendar dates"><button type="button" aria-label={`Previous ${view}`} disabled={disabled||previous===null} onClick={()=>{if(previous)onNavigate(previous);}}>Previous</button><button type="button" aria-label={`Next ${view}`} disabled={disabled||next===null} onClick={()=>{if(next)onNavigate(next);}}>Next</button></span>;
}
