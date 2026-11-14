import { useEffect, useRef, useState } from 'react';
import { mountNamedOperations } from './named-runtime';
import type { OperationsSection } from '../dashboard-navigation';
export function NamedOperations({ section, actor, onSectionChange }: { section: OperationsSection; actor: string; onSectionChange: (next: OperationsSection) => void }) {
 const target=useRef<HTMLDivElement>(null);
 const runtime=useRef<ReturnType<typeof mountNamedOperations>>();
 const notifySection = useRef(onSectionChange);
 notifySection.current = onSectionChange;
 const [failure,setFailure]=useState(false);
 useEffect(()=>{
  setFailure(false);
  try { if(target.current) {runtime.current=mountNamedOperations(target.current,actor,(next: OperationsSection)=>notifySection.current(next));runtime.current.show(section);} }
  catch {runtime.current?.dispose();runtime.current=undefined;setFailure(true);}
  return()=>{runtime.current?.dispose();runtime.current=undefined;};
 },[actor]);
 useEffect(()=>{
  try {runtime.current?.show(section);}
  catch {runtime.current?.dispose();runtime.current=undefined;setFailure(true);}
 },[section]);
 return <section className="named-operations" aria-label="Fictional scheduling and care demonstration">
  <div className="named-demo-notice" role="note"><strong>Fictional scheduling and care demo</strong><span>Sample people only. Changes save on this device for this signed-in account, not to the shared ECH system. Do not enter real care information.</span></div>
  {failure && <p role="alert">The fictional example could not be displayed safely. Existing saved sample data was preserved. Your real inquiries, referral partners and account controls remain available in the main sidebar.</p>}
  <div ref={target} hidden={failure} />
 </section>;
}
