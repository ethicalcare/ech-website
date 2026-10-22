'use client';
import { useEffect, useRef, useState } from 'react';
import type { SharedPartner } from './live-model';
import { companyDate } from './time';
import { useDashboardNavigation } from '../dashboard-navigation';
export type SharedPartnerListProps = { records: SharedPartner[]; onOpen: (record: SharedPartner) => void; pending?: boolean };
export function SharedPartnerList({ records, onOpen, pending = false }: SharedPartnerListProps) {
 const [search,setSearch]=useState(''); const [due,setDue]=useState(false); const [stage,setStage]=useState('*'); const [owner,setOwner]=useState('*'); const [priority,setPriority]=useState('*'); const today=companyDate();
 const navigation=useDashboardNavigation(); const previous=useRef(navigation.contact); const buttons=useRef(new Map<string,HTMLButtonElement>()); const scrollPosition=useRef(0);
 useEffect(()=>{const id=previous.current;previous.current=navigation.contact;if(id&&!navigation.contact){const frame=requestAnimationFrame(()=>{buttons.current.get(id)?.focus({preventScroll:true});window.scrollTo(0,scrollPosition.current);});return()=>cancelAnimationFrame(frame);}},[navigation.contact]);
 const rows=records.filter(r=>(!search||[r.organization,r.geography,r.category,r.contactRoute,r.notes].some(v=>v.toLowerCase().includes(search.toLowerCase())))&&(!due||r.nextDate!==''&&r.nextDate<=today)&&(stage==='*'||r.stage===stage)&&(owner==='*'||(r.ownerId||'')===owner)&&(priority==='*'||r.sprint===priority));
 return <section className="prospects-area"><div className="prospect-list-head"><div><p className="eyebrow">Referral relationships</p><h2>Referral Partners</h2></div><button type="button" aria-pressed={due} onClick={()=>setDue(!due)}>{due?'Show all partners':'Due contacts'}</button></div><div className="prospect-toolbar">
 <label><span>Search referral partners</span><input aria-label="Search referral partners" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Organization, route, region or notes" /></label>
 <label><span>Call owner</span><select aria-label="Lead owner filter" value={owner} onChange={e=>setOwner(e.target.value)}><option value="*">All owners</option><option value="">Unassigned</option>{[...new Set(records.flatMap(r=>r.ownerId?[r.ownerId]:[]))].map(id=><option key={id} value={id}>Assigned account {id.slice(0,8)}</option>)}</select></label>
 <label><span>Relationship stage</span><select aria-label="Lead stage filter" value={stage} onChange={e=>setStage(e.target.value)}><option value="*">All stages</option>{[...new Set(records.map(r=>r.stage))].map(value=><option key={value}>{value}</option>)}</select></label>
 <label><span>Priority</span><select aria-label="Lead sprint filter" value={priority} onChange={e=>setPriority(e.target.value)}><option value="*">All priorities</option><option>Top 15</option><option>Later list</option></select></label>
 <button type="button" onClick={()=>{setSearch('');setStage('*');setOwner('*');setPriority('*');}}>Clear filters</button></div>
 <p role="status">{rows.length} of {records.length} referral partners loaded. Dates use Vancouver calendar dates.</p>
 {rows.map(r=><button type="button" className="partner-row prospect-row" key={r.id} ref={node=>{if(node)buttons.current.set(r.id,node);else buttons.current.delete(r.id);}} disabled={pending} onClick={()=>{scrollPosition.current=window.scrollY;onOpen(r);}}><span><strong>{r.organization}</strong><small>{r.category} · {r.geography}</small><small>{r.sprint} · {r.contacted?'Contact made':'Not yet contacted'}</small></span><span><b>{r.stage}</b><small>{r.ownerId?'Assigned':'Unassigned'}</small></span><span><small>{r.nextAction||'Next action not set'}</small><b>{r.nextDate||'No follow-up date'}</b></span><span aria-hidden="true">›</span></button>)}{!rows.length&&<p>No referral partners match these filters.</p>}</section>;
}
