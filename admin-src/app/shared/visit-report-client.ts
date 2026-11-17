import { SharedError, assertWire, uuid, type OperationalRole } from './live-model.ts';
import { readJson, requestOptions, statusError } from './session.ts';
import { isVisitReport, VISIT_REPORT_MAX_BYTES } from '../../../lib/operations/visit-report-wire.js';

type Recorded = { revision: number; version: number; sourceRevision: number | null; actorId: string;
  actorRole: 'owner' | 'manager' | 'staff'; recordedAt: string };
export type ReportVersion = Recorded & { outcome: 'completed' | 'follow-up' | 'not-completed'; summary: string;
  issue: string; actualStart: string; actualEnd: string; completedTasks: string[]; observations: string; reason: string | null;
  noteEventAt?: string | null };
export type ReportReview = Recorded & { decision: 'accepted' | 'returned'; note: string };
export type VisitReport = { schema: 1; visitId: string; visitRevision: number; reportRevision: number;
  versions: ReportVersion[]; reviews: ReportReview[]; authorLabels?: {actorId:string;currentLabel:string|null}[] };
export type LoadVisitReport = (visitId: string, revision: number, signal: AbortSignal, expectedReportRevision?: number | null) => Promise<VisitReport>;

export function createVisitReportClient(fetcher: typeof fetch, actor: string, role: Exclude<OperationalRole, null>): LoadVisitReport {
  return async function loadVisitReport(visitId, revision, signal, expectedReportRevision = null) {
    signal.throwIfAborted();
    if (!['owner', 'manager', 'staff'].includes(role)) throw statusError(403);
    if (!uuid(actor) || actor.length !== 36 || !uuid(visitId) || visitId.length !== 36
      || !Number.isSafeInteger(revision) || revision < 1 || expectedReportRevision !== null
        && (!Number.isSafeInteger(expectedReportRevision) || expectedReportRevision < 0)) {
      throw new SharedError('invalid_request', 'Choose a current visit report.');
    }
    const options = requestOptions();
    const combined = options.signal ? AbortSignal.any([options.signal, signal]) : signal;
    const query = new URLSearchParams({ report: visitId, revision: String(revision) });
    if (expectedReportRevision !== null) query.set('reportRevision', String(expectedReportRevision));
    let response: Response;
    try {
      response = await fetcher(`/api/admin/operations?${query}`, { ...options, method: 'GET', signal: combined,
        headers: { Accept: 'application/json', 'X-ECH-Schedule-Actor': actor, 'X-ECH-Schedule-Role': role, 'X-ECH-Report-Features':'1' } });
    } catch {
      signal.throwIfAborted();
      throw new SharedError('unavailable', 'Visit reports could not be verified.');
    }
    combined.throwIfAborted();
    if (response.status === 412) throw new SharedError('stale_visit', 'The visit or report changed. Reload the schedule.');
    if (response.status !== 200) throw statusError(response.status);
    const report = await readJson(response, VISIT_REPORT_MAX_BYTES);
    combined.throwIfAborted();
    assertWire(isVisitReport(report, visitId.toLowerCase(), revision, expectedReportRevision));
    return report as VisitReport;
  };
}
