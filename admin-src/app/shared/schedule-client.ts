import { SharedError, assertWire, exact, uuid, type OperationalRole } from './live-model.ts';
import { readJson, requestOptions, statusError } from './session.ts';
import { isScheduleVisit } from '../../../lib/operations/schedule-command-wire.js';

const SERVICES = ['Home support', 'Nursing'] as const;
const STATUSES = ['Open', 'Assigned', 'Confirmed', 'In progress', 'Completed', 'Cancelled'] as const;
const MAX_WINDOW = 43 * 24 * 60 * 60 * 1000;
const MAX_BODY = 2_000_000;

type ScheduleRole = Exclude<OperationalRole, null>;
export type ScheduleWindow = { from: string; to: string };
export type ScheduleIdentity = { id: string; name: string };
export type ScheduleVisit = {
  id: string;
  clientId: string;
  workerId: string | null;
  service: typeof SERVICES[number];
  start: string;
  end: string;
  status: typeof STATUSES[number];
  revision: number;
};
export type ScheduleSnapshot = {
  schema: 1;
  mode: 'shared';
  visits: ScheduleVisit[];
  clients: ScheduleIdentity[];
  staff: ScheduleIdentity[];
};

const isId = (value: unknown): value is string => uuid(value) && value.length === 36;

function isStamp(value: unknown): value is string {
  if (typeof value !== 'string' || value.length !== 24 || value.startsWith('0000-')
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function addId(ids: Set<string>, id: string) {
  const key = id.toLowerCase();
  assertWire(!ids.has(key));
  ids.add(key);
}

function parseIdentities(rows: unknown[], maximum: number): ScheduleIdentity[] {
  assertWire(rows.length <= maximum);
  const ids = new Set<string>();
  return rows.map(value => {
    const { id, name } = exact(value, ['id', 'name']);
    assertWire(isId(id) && typeof name === 'string' && name.length <= 320
      && name.trim().length > 0 && !/[\x00-\x1f\x7f]/u.test(name));
    addId(ids, id);
    return { id, name };
  });
}

function parseSchedule(value: unknown, { from, to }: ScheduleWindow, role: ScheduleRole): ScheduleSnapshot {
  const reply = exact(value, ['schema', 'mode', 'visits', 'clients', 'staff']);
  assertWire(reply.schema === 1 && reply.mode === 'shared' && Array.isArray(reply.visits)
    && reply.visits.length <= 1000 && Array.isArray(reply.clients) && Array.isArray(reply.staff));
  const clients = parseIdentities(reply.clients, 1000);
  const staff = parseIdentities(reply.staff, 1001);
  assertWire(role !== 'staff' || staff.length === 1);

  const clientIds = new Set(clients.map(row => row.id));
  const staffIds = new Set(staff.map(row => row.id));
  const visitIds = new Set<string>();
  const usedClients = new Set<string>();
  const visits: ScheduleVisit[] = (reply.visits as unknown[]).map(value => {
    const { id, clientId, workerId, service, start, end, status, revision } = exact(value,
      ['id', 'clientId', 'workerId', 'service', 'start', 'end', 'status', 'revision']);
    const knownService = SERVICES.find(candidate => candidate === service);
    const knownStatus = STATUSES.find(candidate => candidate === status);
    let assignedWorkerId: string | null = null;
    if (workerId !== null) {
      assertWire(isId(workerId) && staffIds.has(workerId));
      assignedWorkerId = workerId;
    }
    assertWire(isId(id) && isId(clientId) && clientIds.has(clientId)
      && knownService && knownStatus && typeof revision === 'number' && Number.isSafeInteger(revision) && revision >= 1
      && isStamp(start) && isStamp(end) && start < end && start < to && end > from);
    assertWire(knownStatus === 'Cancelled' || (knownStatus === 'Open') === (workerId === null));
    assertWire(role !== 'staff' || (knownStatus !== 'Cancelled' && workerId === staff[0]?.id));
    addId(visitIds, id);
    usedClients.add(clientId);
    return { id, clientId, workerId: assignedWorkerId, service: knownService, start, end, status: knownStatus, revision };
  });
  assertWire(usedClients.size === clientIds.size);
  return { schema: 1, mode: 'shared', visits, clients, staff };
}

const unavailable = () => new SharedError('unavailable', 'The calendar could not be verified. Try again.');

export function createScheduleClient(fetcher: typeof fetch, role: ScheduleRole, actor: string) {
  return {
    async loadVisit(visitId: string, membershipRevision: number, signal: AbortSignal): Promise<ScheduleVisit> {
      signal.throwIfAborted();
      assertWire(isId(actor) && isId(visitId) && ['owner', 'manager', 'staff'].includes(role)
        && Number.isSafeInteger(membershipRevision) && membershipRevision > 0);
      const options = requestOptions(), combined = options.signal ? AbortSignal.any([signal, options.signal]) : signal;
      const query = new URLSearchParams({ scheduleVisit: visitId, membershipRevision: String(membershipRevision) });
      let response: Response;
      try {
        response = await fetcher(`/api/admin/operations?${query}`, { ...options, method: 'GET', signal: combined,
          headers: { Accept: 'application/json', 'X-ECH-Schedule-Actor': actor, 'X-ECH-Schedule-Role': role } });
      } catch { signal.throwIfAborted(); throw unavailable(); }
      signal.throwIfAborted();
      if (combined.aborted) throw unavailable();
      if (response.status !== 200) throw statusError(response.status);
      let payload: unknown;
      try { payload = await readJson(response, 4096); } catch { signal.throwIfAborted(); throw unavailable(); }
      signal.throwIfAborted();
      if (combined.aborted) throw unavailable();
      const value = exact(payload, ['schema', 'visit']);
      assertWire(value.schema === 1 && isScheduleVisit(value.visit));
      const visit = value.visit as ScheduleVisit;
      assertWire(visit.id === visitId && (role !== 'staff' || visit.workerId !== null && visit.status !== 'Cancelled'));
      return visit;
    },
    async loadSchedule({ from, to }: ScheduleWindow, signal?: AbortSignal): Promise<ScheduleSnapshot> {
      signal?.throwIfAborted();
      if (role !== 'owner' && role !== 'manager' && role !== 'staff') throw statusError(403);
      if (!isId(actor)) throw new SharedError('invalid_request', 'Account access could not be verified.');
      if (!isStamp(from) || !isStamp(to) || from >= to || Date.parse(to) - Date.parse(from) > MAX_WINDOW) {
        throw new SharedError('invalid_request', 'Choose a valid calendar window of up to 43 days.');
      }
      const options = requestOptions();
      const requestSignal = signal && options.signal ? AbortSignal.any([signal, options.signal]) : signal ?? options.signal;
      const query = new URLSearchParams({ from, to });
      let response: Response;
      try {
        response = await fetcher(`/api/admin/operations?${query}`, {
          ...options, method: 'GET', headers: { Accept: 'application/json', 'X-ECH-Schedule-Actor': actor, 'X-ECH-Schedule-Role': role }, signal: requestSignal,
        });
      } catch {
        signal?.throwIfAborted();
        throw unavailable();
      }
      signal?.throwIfAborted();
      if (requestSignal?.aborted) throw unavailable();
      if (response.status === 413) throw new SharedError('window_too_large', 'Too many visits to display. Choose a shorter calendar window.');
      if (response.status === 503) throw unavailable();
      if (response.status !== 200) throw statusError(response.status);

      let payload: unknown;
      try {
        payload = await readJson(response, MAX_BODY);
      } catch (error) {
        signal?.throwIfAborted();
        if (requestSignal?.aborted || !(error instanceof SharedError)) throw unavailable();
        throw error;
      }
      signal?.throwIfAborted();
      if (requestSignal?.aborted) throw unavailable();
      return parseSchedule(payload, { from, to }, role);
    },
  };
}
