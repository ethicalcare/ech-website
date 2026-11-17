import { SharedError, assertWire, uuid, type OperationalRole } from './live-model.ts';
import { readJson, requestOptions, statusError } from './session.ts';
import { isVisitDetail, VISIT_DETAIL_MAX_BYTES } from '../../../lib/operations/visit-detail-wire.js';

type Role = Exclude<OperationalRole, null>;
type Contact = { name: string; phone: string | null; purpose: 'visit_logistics' };
export type VisitDetail = {
  visitId: string;
  revision: number;
  fields: Partial<Record<'address' | 'unit' | 'entry' | 'preferences', string>> & { contact?: Contact };
  contactAuthority: 'unknown';
  allergyStatus: 'unknown';
};

export function createVisitDetailClient(fetcher: typeof fetch, actor: string, role: Role) {
  return async function loadVisitDetail(visitId: string, revision: number, signal: AbortSignal): Promise<VisitDetail> {
    signal.throwIfAborted();
    if (role !== 'owner' && role !== 'manager' && role !== 'staff') throw statusError(403);
    if (!uuid(visitId) || visitId.length !== 36 || !uuid(actor) || actor.length !== 36
      || !Number.isSafeInteger(revision) || revision < 1) {
      throw new SharedError('invalid_request', 'Choose a current visit.');
    }
    const options = requestOptions();
    const combined = options.signal ? AbortSignal.any([options.signal, signal]) : signal;
    const query = new URLSearchParams({ visit: visitId, revision: String(revision) });
    let response: Response;
    try {
      response = await fetcher(`/api/admin/operations?${query}`, {
        ...options, method: 'GET', signal: combined,
        headers: { Accept: 'application/json', 'X-ECH-Schedule-Actor': actor, 'X-ECH-Schedule-Role': role },
      });
    } catch {
      signal.throwIfAborted();
      throw new SharedError('unavailable', 'Visit details could not be verified.');
    }
    combined.throwIfAborted();
    if (response.status === 412) throw new SharedError('stale_visit', 'The visit changed. Reload the schedule.');
    if (response.status !== 200) throw statusError(response.status);
    const detail: unknown = await readJson(response, VISIT_DETAIL_MAX_BYTES);
    combined.throwIfAborted();
    assertWire(isVisitDetail(detail, visitId.toLowerCase(), revision));
    return detail as VisitDetail;
  };
}
