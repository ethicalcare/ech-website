import { companyDate } from './time.ts';

// Callers pass authorized events in their established event-time order. Only
// explicit event instants determine the Vancouver day, never recorded-at time.
export function activityDayGroups<T>(events:readonly T[],eventTime:(event:T)=>string):{day:string;events:T[]}[]{
  const days=new Map<string,T[]>();
  for(const event of events){const day=companyDate(eventTime(event));const group=days.get(day)??[];group.push(event);days.set(day,group);}
  return [...days].sort(([a],[b])=>a.localeCompare(b)).map(([day,events])=>({day,events}));
}
