'use client';

import { useState } from 'react';
import type { Lead } from '../intake/model';
import { companyDate, companyTime, selectSharedFollowUps } from './time';
import { type FollowUpGroup } from '../intake/follow-up-queue';

export function FollowUpQueue({ leads, onLeadClick, canEnumerateOwners = true }: { leads: Lead[]; onLeadClick: (lead: Lead) => void; shared?: true; canEnumerateOwners?: boolean }) {
 const [date, setDate] = useState(() => companyDate());
 const [owner, setOwner] = useState<string | null>(null);
 const [status, setStatus] = useState<string | null>(null);
 const [group, setGroup] = useState<'all' | FollowUpGroup>('all');
 const labels = { overdue: 'Overdue', due: 'Due today', upcoming: 'Upcoming', undated: 'Date not set' };
 const currentOwners = new Set(leads.map((lead) => lead.owner));
 const owners = [...new Set([...currentOwners, ...(owner === null ? [] : [owner])])].sort();
 const currentStatuses = new Set(leads.map((lead) => lead.status));
 const statuses = [...new Set([...currentStatuses, ...(status === null ? [] : [status])])].sort();
 let error = ''; let tasks: ReturnType<typeof selectSharedFollowUps> = []; let scoped: ReturnType<typeof selectSharedFollowUps> = [];
 const select = selectSharedFollowUps;
 try { scoped = select(leads, { date, owner, status, group: 'all' }); tasks = select(leads, { date, owner, status, group }); } catch { error = 'Choose a valid Vancouver comparison date to inspect saved follow-up actions.'; }
 function clear() { setOwner(null); setStatus(null); setGroup('all'); }
 return <>
  <section className="view-intro standalone-intro"><div><span className="status-dot"><i /> Shared next actions</span><h2>Review follow-ups by owner, status and date.</h2><p>Only inquiries returned for your current session appear here. Open an inquiry to record its next outcome and action.</p></div></section>
  <section className="panel task-panel" aria-label="Saved follow-up queue">
   <div className="operations-controls">
    <label><span>Vancouver comparison day</span><input aria-label="Follow-up UTC comparison date" type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
    {canEnumerateOwners && <label><span>Owner</span><select aria-label="Follow-up queue owner" value={owner === null ? '' : JSON.stringify(owner)} onChange={(event) => setOwner(event.target.value ? JSON.parse(event.target.value) as string : null)}><option value="">All owners</option>{owners.map((value) => <option key={value} value={JSON.stringify(value)}>{value || 'Owner not recorded'}{!currentOwners.has(value) ? ' · no current inquiries' : ''}</option>)}</select></label>}
    <label><span>Status</span><select aria-label="Follow-up queue status" value={status === null ? '' : JSON.stringify(status)} onChange={(event) => setStatus(event.target.value ? JSON.parse(event.target.value) as string : null)}><option value="">All statuses</option>{statuses.map((value) => <option key={value} value={JSON.stringify(value)}>{value || 'Status not recorded'}{!currentStatuses.has(value) ? ' · no current inquiries' : ''}</option>)}</select></label>
    <label><span>Date group</span><select aria-label="Follow-up date group" value={group} onChange={(event) => setGroup(event.target.value as 'all' | FollowUpGroup)}><option value="all">All date groups</option>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    <button className="secondary-button" type="button" onClick={clear}>Clear follow-up filters</button>
   </div>
   <p className="operations-hint">Saved inquiry timestamps are shown in Vancouver time and compared by Vancouver calendar day. Overdue means before this selected Vancouver day; due means within it; upcoming means after it. These are date comparisons, without a clinical priority, grace period, closure rule or external reminder. Closed inquiries are excluded.</p>
   {error ? <p role="status">{error}</p> : <>
    <p className="operations-storage" role="status">{tasks.length} matching next actions · comparison {date} Vancouver</p>
    <p className="operations-hint" aria-label="Follow-up date group counts">For the selected owner and status: {scoped.filter((task) => task.group === 'overdue').length} overdue · {scoped.filter((task) => task.group === 'due').length} due · {scoped.filter((task) => task.group === 'upcoming').length} upcoming · {scoped.filter((task) => task.group === 'undated').length} dates not set. Date-group selection narrows the rows below.</p>
    {tasks.length === 0 && <p className="empty-state">No saved next actions match these filters. Clear filters or choose another comparison date.</p>}
    {(['overdue', 'due', 'upcoming', 'undated'] as FollowUpGroup[]).map((kind) => { const rows = tasks.filter((task) => task.group === kind); return rows.length > 0 && <section key={kind} data-followup-group={kind}><h3>{labels[kind]}</h3>{rows.map(({ lead }) => <button className="task-row" type="button" key={lead.id} data-followup-lead={lead.id} onClick={() => onLeadClick(lead)}><span className="task-check">›</span><span><small>{lead.followUpAt ? companyTime(lead.followUpAt) : 'Date not set'}</small><strong>{lead.next}</strong><em>{lead.name} · {lead.owner || 'Owner not recorded'} · {lead.status}</em></span><b>Open ›</b></button>)}</section>; })}
   </>}
  </section>
 </>;
}
