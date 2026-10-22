import type { Lead } from './model';

export type FollowUpGroup = 'overdue' | 'due' | 'upcoming' | 'undated';
export type FollowUpFilters = { date: string; owner: string | null; status: string | null; group: 'all' | FollowUpGroup };
export type FollowUpQueueItem = { lead: Lead; group: FollowUpGroup };
