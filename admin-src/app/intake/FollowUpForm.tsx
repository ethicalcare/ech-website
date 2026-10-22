'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { companyTime } from '../shared/time';
import type { FollowUpInput, Lead } from './model';

type FollowUpFormProps = {
  lead: Lead;
  error: string;
  onClose: () => void;
  onReload: () => void;
  onSave: (input: FollowUpInput) => void;
  shared?: true;
  pending?: boolean;
  canAssign?: boolean;
  initialInput?: FollowUpInput;
  onDraftChange?: (input: FollowUpInput) => void;
  assignmentChoices?: { id: string; label: string }[];
};

export function FollowUpForm({ lead, error, onClose, onReload, onSave, pending = false, canAssign = true, assignmentChoices = [], initialInput, onDraftChange }: FollowUpFormProps) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const outcomeField = useRef<HTMLInputElement>(null);
  const nextActionField = useRef<HTMLInputElement>(null);
  const [input, setInput] = useState<FollowUpInput>(() => initialInput || ({
    owner: lead.owner, outcome: '', note: '', nextAction: lead.next,
    nextAt: lead.followUpAt?.slice(0, 16) || new Date().toISOString().slice(0, 16),
  }));
  const [validation, setValidation] = useState('');

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    closeButton.current?.focus();
    return () => { element?.close(); if (previous?.isConnected) previous.focus(); };
  }, []);

  function update(field: keyof FollowUpInput, value: string) {
    setInput(current => { const next = { ...current, [field]: value }; onDraftChange?.(next); return next; });
    setValidation('');
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (input.outcome.trim().length < 3 || input.outcome.length > 160) {
      setValidation('Enter a follow-up outcome of 3–160 characters.');
      outcomeField.current?.focus();
      return;
    }
    if (input.nextAction.trim().length < 3 || input.nextAction.length > 160) {
      setValidation('Enter a next action of 3–160 characters.');
      nextActionField.current?.focus();
      return;
    }
    setValidation('');
    onSave({ ...input });
  }

  return <dialog ref={dialog} className="visit-workspace intake-form" aria-labelledby={`${id}-title`} aria-describedby={`${id}-scope`} onCancel={event => { event.preventDefault(); if (!pending) onClose(); }}>
    <form onSubmit={submit}><fieldset disabled={pending}>
      <div className="form-head"><div><p className="eyebrow">Inquiry follow-up</p><h2 id={`${id}-title`}>Record follow-up</h2></div><button ref={closeButton} type="button" aria-label="Close follow-up form" onClick={onClose}>×</button></div>
      <p id={`${id}-scope`} className="assessment-guidance">Record the outcome and next action. Saving requires server confirmation for this inquiry.</p>
      {error && <div><p role="alert" className="field-error">{error}</p><button type="button" className="secondary-button" onClick={onReload}>Reload intake records</button></div>}
      {lead.followUpAt && <p>Currently saved: {companyTime(lead.followUpAt)} · {lead.followUpAt}</p>}
      <div className="form-grid">
        {canAssign ? <label className="span-two"><span>Follow-up owner</span><select aria-label="Follow-up owner" value={input.owner} disabled={pending} onChange={event => update('owner', event.target.value)}><option value={lead.owner}>{assignmentChoices.find(choice => choice.id === lead.owner)?.label || lead.owner || 'Unassigned'}</option>{assignmentChoices.filter(choice => choice.id !== lead.owner).map(choice => <option key={choice.id} value={choice.id}>{choice.label}</option>)}</select></label> : <p>Assigned owner: {assignmentChoices.find(choice => choice.id === lead.owner)?.label || lead.owner || 'Unassigned'}</p>}
        <label className="span-two"><span>Follow-up outcome (required)</span><input ref={outcomeField} type="text" aria-label="Follow-up outcome" aria-describedby={`${id}-validation`} required minLength={3} maxLength={160} value={input.outcome} onChange={event => update('outcome', event.target.value)} /></label>
        <label className="span-two"><span>Follow-up note (optional)</span><textarea aria-label="Follow-up note" maxLength={1000} rows={3} value={input.note} onChange={event => update('note', event.target.value)} /></label>
        <label className="span-two"><span>Next action (required)</span><input ref={nextActionField} type="text" aria-label="Follow-up next action" aria-describedby={`${id}-validation`} required minLength={3} maxLength={160} value={input.nextAction} onChange={event => update('nextAction', event.target.value)} /></label>
        <label className="span-two"><span>Next follow-up time (UTC)</span><input type="datetime-local" aria-label="Follow-up next time UTC" aria-describedby={`${id}-time-help`} required value={input.nextAt} onChange={event => update('nextAt', event.target.value)} /></label>
      </div>
      <p id={`${id}-time-help`} className="visit-help">Enter UTC even though this input resembles a local date/time field. The input is explicitly UTC. The saved follow-up is displayed in Vancouver time in the queue; review the conversion before saving.</p>
      <p id={`${id}-validation`} className={validation ? 'field-error' : 'visit-help'} role={validation ? 'alert' : undefined}>{validation}</p>
      <p className="visit-help">An error keeps your entries open. Reload intake records here before retrying a stale change. Closing discards unsaved fields.</p>
      <div className="form-actions"><button type="button" onClick={onClose}>Cancel</button><button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save follow-up'}</button></div>
    </fieldset></form>
  </dialog>;
}
