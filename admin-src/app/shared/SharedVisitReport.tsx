import {SharedDailyCareLog} from './SharedDailyCareLog';
import type {CompletedTaskHistory} from './completed-task-history-client';
import {ReportActor} from './ReportActor';
import { useId, useLayoutEffect, useRef, useState } from 'react';
import { SharedError } from './live-model';
import { taskEventLocalTime as formatVancouverInstant } from './visit-task-timeline';
import type { LoadVisitReport, VisitReport } from './visit-report-client';
import './shared-visit-report.css';
import { SharedVisitNoteTimeline } from './SharedVisitNoteTimeline';

type State = { status: 'loading' | 'paused' } | { status: 'ready'; report: VisitReport } | { status: 'error' };
const versionLabel = (version: number) => version === 0 ? 'Original report · version 0' : `Correction ${version} · version ${version}`;
const outcomeLabel = { completed: 'Completed', 'follow-up': 'Follow-up needed', 'not-completed': 'Not completed' };

export function SharedVisitReport({ visitId, visitRevision, load, loadCompletedHistory, onVerificationFailure, selectedVersion, onSelectedVersionChange }: {
  loadCompletedHistory?:(visitId:string,visitRevision:number,reportRevision:number,signal:AbortSignal)=>Promise<CompletedTaskHistory>;
  visitId: string; visitRevision: number; load: LoadVisitReport; onVerificationFailure: (code: string) => void;
  selectedVersion: number | null; onSelectedVersionChange: (version: number) => void;
}) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [reload, setReload] = useState(0);
  const selection = useRef(selectedVersion);
  selection.current = selectedVersion;
  const setSelection = useRef(onSelectedVersionChange);
  setSelection.current = onSelectedVersionChange;
  const failure = useRef(onVerificationFailure);
  failure.current = onVerificationFailure;
  const heading = useRef<HTMLHeadingElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const id = useId();
  useLayoutEffect(() => {
    let request: AbortController | undefined;
    function clear() {
      request?.abort();
      if (document.hasFocus() && body.current?.contains(document.activeElement)) heading.current?.focus();
      setState({ status: 'paused' });
    }
    function check() {
      clear();
      if (document.visibilityState !== 'visible' || !document.hasFocus()) return;
      const controller = new AbortController();
      request = controller;
      setState({ status: 'loading' });
      load(visitId, visitRevision, controller.signal).then(report => {
        if (controller.signal.aborted || document.visibilityState !== 'visible' || !document.hasFocus()) return;
        const current = selection.current;
        setSelection.current(current !== null && report.versions.some(version => version.version === current)
          ? current : report.versions.at(-1)?.version ?? 0);
        setState({ status: 'ready', report });
      }).catch(error => {
        if (controller.signal.aborted) return;
        setState({ status: 'error' });
        failure.current(error instanceof SharedError ? error.code : 'unavailable');
      });
    }
    check();
    document.addEventListener('visibilitychange', check);
    window.addEventListener('blur', clear);
    window.addEventListener('focus', check);
    const timer = window.setInterval(check, 60_000);
    return () => {
      request?.abort();
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('blur', clear);
      window.removeEventListener('focus', check);
      window.clearInterval(timer);
    };
  }, [load, visitId, visitRevision, reload]);

  const report = state.status === 'ready' ? state.report : null;
  const selected = selectedVersion ?? 0;
  const content = report?.versions[selected];
  const reviews = report?.reviews.filter(review => review.version === selected) ?? [];
  const latestReview = reviews.at(-1);
  const latestVersion = report?.versions.at(-1);
  const isHistorical = !!content && !!latestVersion && content.version !== latestVersion.version;
  const correctionSource = content?.sourceRevision === null ? undefined
    : report?.versions.find(version => version.revision === content?.sourceRevision);
  function navigateVersion(version: number) {
    onSelectedVersionChange(version);
    heading.current?.focus();
  }
  return <section className="shared-visit-report" aria-labelledby={`${id}-heading`}>
    <h3 id={`${id}-heading`} ref={heading} tabIndex={-1}>Visit report and review history</h3>
    <p>Saved report history. Submissions, corrections and independent reviews appear after a fresh access check.</p>
    {state.status === 'loading' && <p role="status">Checking report access…</p>}
    {state.status === 'paused' && <p role="status">Report content is hidden. Access will be checked when you return.</p>}
    {state.status === 'error' && <p role="alert">The report could not be verified. Reload the schedule to check current access.</p>}
    <div ref={body}>
      {report && <>
        <p className="shared-visit-report__verification">Checked on this load · report revision {report.reportRevision}.
          {' '}Changes appear after a fresh access check.</p>
        <button type="button" onClick={() => setReload(value => value + 1)}>Reload report</button>
        {report.versions.length === 0 && <p>No report is available for this visit. Completion or attendance is not inferred.</p>}
        {content && <>
          <fieldset className="shared-visit-report__versions">
            <legend>Report version</legend>
            {report.versions.map(version => {
              const review = report.reviews.filter(entry => entry.version === version.version).at(-1);
              const status = review ? (review.decision === 'accepted' ? 'Accepted' : 'Returned') : 'No review recorded';
              const summaryId = `${id}-version-${version.version}-summary`;
              return <label key={version.version}>
                <input type="radio" name={`${id}-version`} value={version.version} checked={selected === version.version}
                  aria-label={versionLabel(version.version)} aria-describedby={summaryId}
                  onChange={() => onSelectedVersionChange(version.version)} />
                <span className="shared-visit-report__version-copy"><strong>{versionLabel(version.version)}</strong>
                  <small id={summaryId}>{version.version === latestVersion?.version ? 'Latest saved version' : 'Historical version'} · {outcomeLabel[version.outcome]} · {status}
                    <br />Recorded at · Vancouver: {formatVancouverInstant(version.recordedAt)}</small></span>
              </label>;
            })}
          </fieldset>
          {isHistorical && latestVersion && <aside className="shared-visit-report__history-notice" aria-label="Historical report version">
            <p><strong>You are viewing a historical report version.</strong> {versionLabel(latestVersion.version)} is the latest saved report. A new correction or independent review uses the latest version, not the older version displayed here.</p>
            <button type="button" onClick={() => navigateVersion(latestVersion.version)}>View latest report</button>
          </aside>}
          <article aria-labelledby={`${id}-version-heading`}>
            <h4 id={`${id}-version-heading`}>{versionLabel(content.version)}</h4>
            <p role="status">{latestReview ? `${latestReview.decision === 'accepted' ? 'Accepted' : 'Returned'} for this exact version`
              : 'No independent review recorded for this version'}</p>
            <dl className="shared-visit-detail__fields">
              <dt>Outcome reported</dt><dd>{outcomeLabel[content.outcome]}</dd>
              <dt>Recorded by</dt><dd><ReportActor report={report} actorId={content.actorId} role={content.actorRole}/></dd>
              <dt>Note event time · Vancouver</dt><dd>{content.noteEventAt
                ? <time dateTime={content.noteEventAt}>{formatVancouverInstant(content.noteEventAt)}</time>
                : 'Not recorded · unknown'}</dd>
              <dt>Recorded at · Vancouver</dt><dd>{formatVancouverInstant(content.recordedAt)}</dd>
              <dt>Content event revision</dt><dd>{content.revision}</dd>
              <dt>Reported actual visit · Vancouver</dt><dd>{formatVancouverInstant(content.actualStart)} – {formatVancouverInstant(content.actualEnd)}</dd>
              <dt>Factual summary</dt><dd>{content.summary}</dd>
              <dt>Completed tasks as reported</dt><dd>{content.completedTasks.length
                ? <ul>{content.completedTasks.map((task, index) => <li key={index}>{task}</li>)}</ul> : 'No completed tasks were recorded in this version.'}</dd>
              <dt>Issue text</dt><dd>{content.issue || 'No issue text was entered in this version.'}</dd>
              <dt>Observations</dt><dd>{content.observations || 'No observations were entered in this version.'}</dd>
              {content.reason !== null && <><dt>Correction reason</dt><dd>{content.reason}</dd>
                <dt>Source content event revision</dt><dd>{content.sourceRevision}
                  {correctionSource && <button className="shared-visit-report__source-link" type="button"
                    onClick={() => navigateVersion(correctionSource.version)}>
                    View {correctionSource.version === 0 ? 'original report' : `correction ${correctionSource.version}`}
                  </button>}
                </dd></>}
            </dl>
            <h4>Independent reviews of this exact version</h4>
            {reviews.length === 0 ? <p>No review recorded.</p> : <ol>
              {reviews.map(review => <li key={review.revision}>
                <p><strong>{review.decision === 'accepted' ? 'Accepted' : 'Returned'} · {versionLabel(review.version)}</strong></p>
                <p><ReportActor report={report} actorId={review.actorId} role={review.actorRole}/></p>
                <p>Recorded at · Vancouver: {formatVancouverInstant(review.recordedAt)} · review revision {review.revision} · source content revision {review.sourceRevision}</p>
                <p className="shared-visit-report__wording">{review.note}</p>
              </li>)}
            </ol>}
          </article>
        </>}
        {report.versions.length > 0 && (report.completedTaskHistoryEnabled===true && loadCompletedHistory ? <SharedDailyCareLog key={`${visitId}:${visitRevision}:${report.reportRevision}`} report={report} load={loadCompletedHistory} onFailure={()=>failure.current('unavailable')}/> : <SharedVisitNoteTimeline report={report} />)}
        <p>A report review does not verify attendance, approve work time, resolve an issue or grant clinical authority.</p>
      </>}
    </div>
  </section>;
}
