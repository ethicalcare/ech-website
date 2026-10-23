'use client';
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { suggestPartnerDuplicates, type ManualPartnerInput, type PartnerMethod, type PartnerPerson, type Prospect } from '../prospects/model';
type PartnerOption = Pick<Prospect, 'id' | 'organization' | 'geography' | 'contactRoute' | 'people'>;
import type { InquiryReferral } from '../intake/model';

export type SharedReferralPickerProps = { partners: PartnerOption[]; value: InquiryReferral; onChange: (value: InquiryReferral) => void; disabled?: boolean };
export function SharedReferralPicker({ partners, value, onChange, disabled = false }: SharedReferralPickerProps) {
  const selected = partners.find(partner => partner.id === value.partnerId);
  return <section className="form-section"><h3>Confirmed referral</h3><label><span>Referred by an existing partner</span><select disabled={disabled} value={value.partnerId} onChange={event => { const partner = partners.find(p => p.id === event.target.value); onChange({ partnerId: partner?.id || '', partnerName: partner?.organization || '', context: value.context, personId: '', personName: '' }); }}><option value="">No referral selected</option>{value.partnerId && !selected && <option value={value.partnerId}>Existing saved link · unavailable for selection</option>}{partners.map(partner => <option key={partner.id} value={partner.id}>{partner.organization}</option>)}</select></label>
  <label><span>Referring person</span><select disabled={disabled || !selected} value={value.personId || ''} onChange={event => { const person = selected?.people?.find(p => p.id === event.target.value); onChange({ ...value, personId: person?.id || '', personName: person?.name || '' }); }}><option value="">Organization/desk only</option>{value.personId && !selected?.people?.some(p => p.id === value.personId) && <option value={value.personId}>Existing saved person link</option>}{selected?.people?.map(person => <option key={person.id} value={person.id}>{person.name}{person.role ? ` · ${person.role}` : ''}</option>)}</select></label>
  <label><span>Confirmed source / consent context</span><textarea disabled={disabled || !value.partnerId} maxLength={1000} value={value.context} onChange={event => onChange({ ...value, context: event.target.value })} /></label><p>Only records permitted for this session are available. Selecting a partner does not send a message or save the inquiry.</p></section>;
}
export type SharedPartnerPeopleProps = { partner: PartnerOption; canEdit: boolean; initialPerson?: PartnerPerson; onDraftChange?: (person: PartnerPerson | null) => void; onSave: (person: PartnerPerson) => Promise<boolean> };
export function SharedPartnerPeople({ partner, canEdit, onSave, initialPerson, onDraftChange }: SharedPartnerPeopleProps) {
  const [person, setPerson] = useState<PartnerPerson | null>(initialPerson || null);
  const [pending, setPending] = useState(false); const [error, setError] = useState(''); const [open, setOpen] = useState(Boolean(initialPerson)); const busy = useRef(false);
  const dialogRef = useRef<HTMLDialogElement>(null); const nameRef = useRef<HTMLInputElement>(null);
  const openerRef = useRef<HTMLElement | null>(null); const errorRef = useRef<HTMLParagraphElement>(null); const titleId = useId();
  useEffect(() => { onDraftChange?.(person); }, [person,onDraftChange]);
  useEffect(() => {
    const dialog = dialogRef.current; if (!open || !dialog) return;
    const previousOverflow = document.body.style.overflow; const opener = openerRef.current;
    dialog.showModal(); document.body.style.overflow = 'hidden'; nameRef.current?.focus();
    return () => { dialog.close(); document.body.style.overflow = previousOverflow; if (opener?.isConnected) opener.focus({ preventScroll: true }); };
  }, [open]);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  function begin(existing?: PartnerPerson) {
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setError(''); setPerson(existing ? structuredClone(existing) : person || { id: crypto.randomUUID(), name: '', role: '', methods: [] }); setOpen(true);
  }
  function close() { if (!busy.current) setOpen(false); }
  function cancel() { if (!busy.current) { setOpen(false); setError(''); setPerson(null); } }
  async function save(event: FormEvent) {
    event.preventDefault(); if (!person || busy.current || !canEdit) return;
    busy.current = true; setPending(true); setError('');
    try {
      if (await onSave(structuredClone(person))) { setOpen(false); setPerson(null); }
      else setError('The contact person save was not confirmed. Your draft is retained. Close this window to review the partner record before retrying.');
    } catch { setError('The contact person save was not confirmed. Your draft is retained. Close this window to review the partner record before retrying.'); }
    finally { busy.current = false; setPending(false); }
  }
  function containFocus(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== 'Tab') return;
    const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]')].filter(element => element.getClientRects().length);
    const first = controls[0], last = controls.at(-1);
    if (!first) { event.preventDefault(); event.currentTarget.focus(); }
    else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
  function method(index: number, patch: Partial<PartnerMethod>) { setPerson(p => p && ({ ...p, methods: p.methods.map((m, i) => i === index ? { ...m, ...patch } : m) })); }
  return <section className="partner-people" aria-label="Partner contact people"><h3>Named contact people</h3>
    {(partner.people || []).map(p => <div className="partner-person-card" key={p.id}><strong>{p.name}</strong><p>{p.role}</p>{p.methods.map(m => <p key={m.id}>{m.kind}: {m.value} {m.label}</p>)}{canEdit && <button type="button" disabled={pending} onClick={() => begin(p)}>Edit {p.name}</button>}</div>)}
    {!partner.people?.length && <p>No named contact people saved.</p>}
    {canEdit && <button type="button" disabled={pending} onClick={() => begin()}>{person && !open ? 'Continue contact person' : 'Add contact person'}</button>}
    {person && open && <dialog ref={dialogRef} className="contact-person-dialog" tabIndex={-1} aria-labelledby={titleId} onKeyDown={containFocus} onCancel={event => { event.preventDefault(); close(); }}>
      <header className="contact-person-heading"><h2 id={titleId}>{partner.people?.some(p => p.id === person.id) ? 'Edit contact person' : 'Add contact person'}</h2><button type="button" aria-label="Close contact person" disabled={pending} onClick={close}>×</button></header>
      <p>{partner.organization}</p>
      {error && <p ref={errorRef} tabIndex={-1} role="alert" className="field-error">{error}</p>}
      <form className="partner-person-entry" onSubmit={save}><fieldset disabled={pending}>
        <div className="form-grid"><label><span>Contact person name</span><input ref={nameRef} aria-label="Contact person name" placeholder="e.g. Jordan Lee" required maxLength={160} value={person.name} onChange={event => setPerson({ ...person, name: event.target.value })} /></label><label><span>Person role (optional)</span><input placeholder="e.g. Community partnerships coordinator" maxLength={160} value={person.role} onChange={event => setPerson({ ...person, role: event.target.value })} /></label></div>
        {person.methods.map((m, index) => <div className="person-method" key={m.id}><div className="form-grid"><label><span>Method type</span><select value={m.kind} onChange={event => method(index, { kind: event.target.value as PartnerMethod['kind'] })}><option value="phone">Phone</option><option value="email">Email</option></select></label><label><span>Contact method</span><input placeholder={m.kind === 'email' ? 'e.g. jordan@example.org' : 'e.g. 604-555-0100'} required type={m.kind === 'email' ? 'email' : 'tel'} maxLength={300} value={m.value} onChange={event => method(index, { value: event.target.value })} /></label><label><span>Label (optional)</span><input placeholder="e.g. Work or reception" maxLength={160} value={m.label} onChange={event => method(index, { label: event.target.value })} /></label></div><button type="button" onClick={() => setPerson({ ...person, methods: person.methods.filter((_, i) => i !== index) })}>Remove method</button></div>)}
        <button type="button" disabled={person.methods.length >= 20} onClick={() => setPerson({ ...person, methods: [...person.methods, { id: crypto.randomUUID(), kind: 'phone', value: '', label: '' }] })}>Add phone or email</button>
        <div className="partner-person-actions"><button type="submit" className="primary-button" disabled={!canEdit}>{pending ? 'Saving…' : 'Save contact person'}</button><button type="button" onClick={cancel}>Cancel person changes</button></div>
      </fieldset></form>
    </dialog>}
  </section>;
}
export type SharedInlinePartnerProps = { records: PartnerOption[]; canCreate: boolean; onCreate: (input: ManualPartnerInput) => Promise<PartnerOption | null>; onSelect: (partner: PartnerOption, personId?: string) => void; onClose: () => void };
export function SharedInlinePartner({ records, canCreate, onCreate, onSelect, onClose }: SharedInlinePartnerProps) {
  const [input, setInput] = useState<ManualPartnerInput>(() => ({ uuid: crypto.randomUUID(), organization: '', geography: '', category: 'Manual organization/desk', contactRoute: '' })); const [distinct, setDistinct] = useState(false); const [pending, setPending] = useState(false); const busy = useRef(false);
  const suggestions = suggestPartnerDuplicates(records, input);
  function change(field: keyof ManualPartnerInput, value: string) { setInput(current => ({ ...current, [field]: value })); setDistinct(false); }
  async function create(event: FormEvent) { event.preventDefault(); if (busy.current || !distinct || !canCreate) return; busy.current = true; setPending(true); try { const partner = await onCreate(structuredClone(input)); if (partner) onSelect(partner); } finally { busy.current = false; setPending(false); } }
  return <section className="inline-partner-entry"><h3>Add or choose a referral partner</h3><p>The inquiry stays unsaved while a separate partner is saved.</p>{suggestions.map(({ partner, reasons }) => <div key={partner.id}><strong>{partner.organization} · {partner.geography}</strong><p>{reasons.join('; ')}</p><button type="button" disabled={pending} onClick={() => onSelect(partner)}>Use existing {partner.organization}</button></div>)}{!suggestions.length && <p>No current suggestions. This does not establish that a partner is new.</p>}{canCreate && <form onSubmit={create}><fieldset disabled={pending}><label><span>Organization/desk name</span><input required maxLength={300} value={input.organization} onChange={event => change('organization', event.target.value)} /></label><label><span>Location/service area</span><input required maxLength={300} value={input.geography} onChange={event => change('geography', event.target.value)} /></label><label><span>Public contact route</span><input maxLength={1000} value={input.contactRoute} onChange={event => change('contactRoute', event.target.value)} /></label><label><input type="checkbox" checked={distinct} onChange={event => setDistinct(event.target.checked)} />I reviewed possible matches and confirm this is a distinct organization/location/desk.</label><button type="submit" disabled={!distinct}>{pending ? 'Saving…' : 'Save distinct partner and select'}</button></fieldset></form>}<button type="button" disabled={pending} onClick={onClose}>Close inline partner entry</button></section>;
}
