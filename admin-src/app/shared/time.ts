import type { Lead } from '../intake/model.ts';
import type { FollowUpFilters, FollowUpQueueItem, FollowUpGroup } from '../intake/follow-up-queue.ts';
export const COMPANY_TIME_ZONE = 'America/Vancouver';
export function companyDate(instant: string | Date = new Date()): string {
  const date = new Date(instant);
  if (!Number.isFinite(date.getTime())) throw new TypeError('Invalid saved timestamp.');
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: COMPANY_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)!.value).join('-');
}
export function companyTime(instant: string): string {
  const date = new Date(instant);
  if (!Number.isFinite(date.getTime())) throw new TypeError('Invalid saved timestamp.');
  return new Intl.DateTimeFormat('en-CA', { timeZone: COMPANY_TIME_ZONE, dateStyle: 'medium', timeStyle: 'short' }).format(date) + ' (Vancouver)';
}
export function selectSharedFollowUps(leads: Lead[], filters: FollowUpFilters): FollowUpQueueItem[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(filters.date) || new Date(filters.date + 'T12:00:00Z').toISOString().slice(0, 10) !== filters.date) throw new TypeError('Choose a valid Vancouver comparison day.');
  return leads.filter(lead => lead.status !== 'Closed').flatMap(lead => {
    let group: FollowUpGroup = 'undated';
    if (lead.followUpAt) {
      const day = companyDate(lead.followUpAt);
      group = day < filters.date ? 'overdue' : day === filters.date ? 'due' : 'upcoming';
    }
    return (filters.owner === null || lead.owner === filters.owner) && (filters.status === null || lead.status === filters.status) && (filters.group === 'all' || filters.group === group) ? [{ lead, group }] : [];
  }).sort((a, b) => (a.lead.followUpAt || 'z').localeCompare(b.lead.followUpAt || 'z') || a.lead.id.localeCompare(b.lead.id));
}
