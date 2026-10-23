import type { SharedPartner } from './live-model';

type SourceVariant = { url?: unknown; values?: unknown[] };
type SourceBrief = { title?: unknown; url?: unknown; text?: unknown; sources?: { label?: unknown; url?: unknown }[] };

function webLink(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : undefined; } catch { return undefined; }
}

function ReadableSourceText({ text }: { text: string }) {
  const headings = new Set(['Who they are','Why we are contacting them','What we want','Who to contact','Before you send','Email you can send','Phone opener','Sources','Follow-up','Next steps']);
  return <>{text.split(/\r?\n/).map((line,index) => {
    if (!line.trim()) return null;
    if (headings.has(line.trim())) return <h5 key={index}>{line}</h5>;
    const label=line.match(/^(PROPOSED NEXT|WHY \/ ASK|STATUS|Source retained):\s*(.*)$/);
    return <p key={index}>{label ? <><strong>{label[1]}: </strong>{label[2]}</> : line}</p>;
  })}</>;
}

export function hasImportedPartnerInformation(record: SharedPartner): boolean {
  return Array.isArray(record.source.sourceVariants) && record.source.sourceVariants.length > 0;
}

export function PartnerSourceInformation({ record }: { record: SharedPartner }) {
  const source = record.source;
  const variants = Array.isArray(source.sourceVariants) ? source.sourceVariants as SourceVariant[] : [];
  const brief = source.brief && typeof source.brief === 'object' ? source.brief as SourceBrief : undefined;
  const flags = Array.isArray(source.reviewFlags) ? source.reviewFlags.filter((flag): flag is string => typeof flag === 'string' && Boolean(flag)) : [];
  const briefUrl = webLink(brief?.url);
  return <section className="partner-source-information" aria-label="Research and source information">
    <h3>Research and source information</h3>
    {flags.length > 0 && <aside className="source-review-warning"><h4>Review before contacting</h4><ul>{flags.map((flag, index) => <li key={index}>{flag}</li>)}</ul></aside>}
    {variants.length > 0 && <details className="imported-board-notes"><summary>Read notes from the original lists</summary><div className="imported-board-content"><p className="source-context">These notes reflect the source boards when imported. Confirm current activity and next steps before acting.</p>{variants.map((variant, index) => {
      const url = webLink(variant.url);
      const notes = Array.isArray(variant.values) && typeof variant.values[13] === 'string' ? variant.values[13] : '';
      const label = index === 0 ? 'Operational board' : index === 1 ? 'Internal board' : `Source board ${index + 1}`;
      return <section className="source-board-section" key={`${index}:${String(variant.url || '')}`}><h5>{label}</h5>{notes ? <div className="source-text source-board-text"><ReadableSourceText text={notes} /></div> : <p>No notes were provided in this source row.</p>}{url && <a className="source-document-link" href={url} target="_blank" rel="noopener noreferrer">Open {label.toLowerCase()} row</a>}</section>;
    })}</div></details>}
    {brief && <details className="source-research"><summary>Research and outreach draft</summary><div className="source-research-content"><p className="source-context">Preparation for team review. This is not a record of outreach.</p>{typeof brief.title === 'string' && <h4>{brief.title}</h4>}{briefUrl && <a className="source-document-link" href={briefUrl} target="_blank" rel="noopener noreferrer">Open original outreach brief</a>}{typeof brief.text === 'string' && <div className="source-text source-brief-text"><ReadableSourceText text={brief.text} /></div>}{Array.isArray(brief.sources) && brief.sources.length > 0 && <div className="source-reference-links"><h5>Research references</h5><ul>{brief.sources.map((reference, index) => { const url = webLink(reference.url); return url ? <li key={index}><a href={url} target="_blank" rel="noopener noreferrer">{typeof reference.label === 'string' && reference.label ? reference.label : `Research source ${index + 1}`}</a></li> : null; })}</ul></div>}</div></details>}
    <details className="source-technical-details"><summary>Technical source details</summary><pre>{JSON.stringify(source, null, 2)}</pre></details>
  </section>;
}
