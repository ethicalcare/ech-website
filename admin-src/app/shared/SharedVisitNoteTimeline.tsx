import { useState } from 'react';
import { companyTime } from './time';
import type { VisitReport, ReportVersion } from './visit-report-client';

// A missing event time must not be replaced by a visit interval or save time.
// Preserve every authorized original/correction, including equal instants.
export function orderedVisitNotes(versions: readonly ReportVersion[]) {
  const known = versions.filter(v => !!v.noteEventAt).sort((a,b) => {
    const milliseconds = Date.parse(a.noteEventAt!) - Date.parse(b.noteEventAt!);
    const tail = (v:string) => Number((v.match(/\.(\d{1,6})(?:Z|[+-]\d\d:\d\d)$/)?.[1] ?? '').padEnd(6,'0').slice(3));
    return milliseconds || tail(a.noteEventAt!) - tail(b.noteEventAt!) || a.revision-b.revision;
  });
  return {known,unknown:versions.filter(v => !v.noteEventAt)};
}
export function SharedVisitNoteTimeline({report}:{report:VisitReport}) {
  const [open,setOpen]=useState(false);
  const {known,unknown}=orderedVisitNotes(report.versions);
  const entry=(v:ReportVersion)=><li key={v.revision}>
    <h5>{v.version===0?'Original report':`Correction ${v.version}`} · {v.version===report.versions.at(-1)?.version?'Latest saved version':'Historical version'}</h5>
    <dl>
      <dt>Note event time · Vancouver</dt><dd>{v.noteEventAt?<time dateTime={v.noteEventAt}>{companyTime(v.noteEventAt)}</time>:'Not recorded · unknown'}</dd>
      <dt>Recorded at · Vancouver</dt><dd>{companyTime(v.recordedAt)}</dd>
      <dt>Author</dt><dd>{v.actorRole} · <span className="shared-visit-report__actor">{v.actorId}</span></dd>
      <dt>Factual summary</dt><dd>{v.summary}</dd>
      <dt>Observations</dt><dd>{v.observations||'No observations recorded.'}</dd>
      <dt>Issue text</dt><dd>{v.issue||'No issue text recorded.'}</dd>
      {v.reason!==null&&<><dt>Correction reason</dt><dd>{v.reason}</dd><dt>Source content revision</dt><dd>{v.sourceRevision}</dd></>}
    </dl>
  </li>;
  return <details className="shared-visit-note-timeline" onToggle={event=>setOpen(event.currentTarget.open)}>
    <summary>Visit note activity · all saved report versions</summary>
    {open && <>
    <p>Known note event times are ordered chronologically. Each original and correction remains visible; historical versions are not additional care events. This is this visit’s report-note history, not a complete daily care log. Reviews and worked-time approval remain separate.</p>
    {known.length?<ol aria-label="Visit notes with known event times">{known.map(entry)}</ol>:<p>No note event times are recorded.</p>}
    {unknown.length>0&&<section aria-label="Visit notes with unknown event time"><h4>Event time unknown</h4><p>These entries cannot be placed in the event chronology. Recorded time does not establish when the note event happened.</p><ol>{unknown.map(entry)}</ol></section>}
    </>}
  </details>;
}
