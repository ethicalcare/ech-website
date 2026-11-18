'use client';
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { readJson, requestOptions, statusError } from './session';
import { SharedError, uuid } from './live-model';
import { companyTime } from './time';
import { shouldRefreshVisibleAccounts } from './account-polling.js';
import type { AccountHistoryProps } from './account-decision-history-client';

export type AccessRequest = {
  userId: string; email: string; displayName: string; state: 'pending' | 'approved' | 'denied' | 'revoked';
  role: 'staff' | 'manager' | null; delegatedUserAdmin?: true; revision: number;
  requestedAt: string; decidedAt: string | null;
};
type Review = {
  schema: 1; operationId: string; expectedRevision: number;
  command: { type: 'approve' | 'deny' | 'revoke'; userId: string; role: AccessRequest['role']; delegatedUserAdmin?: boolean };
};
export function buildAccessReview(operationId: string, row: {userId:string;revision:number}, type: Review['command']['type'], role: AccessRequest['role'], delegated?: boolean): Review {
 return {schema:1,operationId,expectedRevision:row.revision,command:{type,userId:row.userId,role,...(delegated === undefined ? {} : {delegatedUserAdmin:delegated})}};
}
export type RequestState =
  | { status: 'loading' | 'unavailable'; rows?: never }
  | { status: 'ready'; rows: AccessRequest[] };

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(key =>
      JSON.stringify(key) + ':' + canonical((value as Record<string, unknown>)[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}
export async function fingerprint(value: unknown) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value)));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function accountApi(fetcher: typeof fetch, path: string, body?: unknown, maximum?: number, signal?: AbortSignal) {
  const options = requestOptions();
  const response = await fetcher('/api/admin/' + path, {
    ...options,
    ...(signal ? { signal: options.signal ? AbortSignal.any([options.signal, signal]) : signal } : {}),
    ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
    headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
  });
  if (response.status !== 200) throw statusError(response.status, Boolean(body));
  return readJson(response, maximum);
}
function requestRow(value: unknown): AccessRequest {
  const row = value as AccessRequest;
  if (!row || !uuid(row.userId) || typeof row.email !== 'string' || typeof row.displayName !== 'string' ||
      !['pending', 'approved', 'denied', 'revoked'].includes(row.state) ||
      !Number.isSafeInteger(row.revision) || row.revision < 1 ||
      !Number.isFinite(Date.parse(row.requestedAt)) ||
      (row.decidedAt !== null && !Number.isFinite(Date.parse(row.decidedAt))) ||
      (row.state === 'approved' ? !['staff', 'manager'].includes(row.role || '') : row.role !== null) ||
      (Object.hasOwn(row, 'delegatedUserAdmin') && (row.delegatedUserAdmin !== true || row.role !== 'manager'))) {
    throw new Error('Account request data could not be verified.');
  }
  return row;
}

export async function verifyAccessDecisionReceipt(value: unknown, body: Review, email: string): Promise<AccessRequest> {
  const result = value as {
    schema: number; request: unknown;
    receipt: { operationId: string; expectedRevision: number; revision: number; commandFingerprint: string };
  };
  const row = requestRow(result?.request);
  const state = { approve: 'approved', deny: 'denied', revoke: 'revoked' }[body.command.type];
  if (result.schema !== 1 || row.userId !== body.command.userId || row.email !== email ||
      row.state !== state || row.role !== body.command.role || row.revision !== body.expectedRevision + 1 ||
      (body.command.type === 'approve' && Object.hasOwn(body.command,'delegatedUserAdmin') && Boolean(row.delegatedUserAdmin) !== body.command.delegatedUserAdmin) ||
      result.receipt?.operationId !== body.operationId || result.receipt.expectedRevision !== body.expectedRevision ||
      result.receipt.revision !== row.revision || result.receipt.commandFingerprint !== await fingerprint(body)) {
    throw new Error('Decision receipt could not be verified. Refresh the list before retrying the same decision.');
  }
  return row;
}

export function useAccountRequests(fetcher: typeof fetch, scope: string, panelOpen = false) {
  const [snapshot, setSnapshot] = useState<{ scope: string; state: RequestState }>();
  const sequence = useRef(0);
  const lastChecked = useRef(0);
  const inFlight = useRef<Promise<void> | null>(null);
  const controller = useRef<AbortController | null>(null);
  const panelIsOpen = useRef(panelOpen);
  panelIsOpen.current = panelOpen;
  const reload = useCallback((quiet = false): Promise<void> => {
    if (!scope || document.visibilityState !== 'visible') return Promise.resolve();
    if (inFlight.current && quiet) return inFlight.current;
    // Explicit refreshes (including verified writes) must read newer state.
    if (inFlight.current) controller.current?.abort();
    const ticket = ++sequence.current;
    const request = new AbortController();
    controller.current = request;
    if (!quiet) setSnapshot({ scope, state: { status: 'loading' } });
    const task = (async () => { try {
      const data = await accountApi(fetcher, 'access-requests', undefined, undefined, request.signal) as { schema: number; items: unknown[] };
      if (data?.schema !== 1 || !Array.isArray(data.items)) throw new Error('Unverified list');
      const rows = data.items.map(requestRow);
      if (new Set(rows.map(row => row.userId)).size !== rows.length) throw new Error('Duplicate subjects');
      if (ticket === sequence.current && !request.signal.aborted && document.visibilityState === 'visible') setSnapshot({ scope, state: { status: 'ready', rows } });
    } catch {
      if (ticket === sequence.current && !request.signal.aborted && document.visibilityState === 'visible') setSnapshot({ scope, state: { status: 'unavailable' } });
    } finally {
      if (ticket === sequence.current) {
        lastChecked.current = Date.now();
      }
      if (controller.current === request) controller.current = null;
    } })();
    inFlight.current = task;
    void task.finally(() => { if (inFlight.current === task) inFlight.current = null; });
    return task;
  }, [fetcher, scope]);
  useEffect(() => {
    if (!scope) return;
    let active = true;
    lastChecked.current = 0;
    const previous = inFlight.current;
    if (previous) void previous.finally(() => { if (active) void reload(); });
    else void reload();
    const onVisible = () => {
      if (!active) return;
      if (document.visibilityState !== 'visible') {
        sequence.current += 1;
        controller.current?.abort();
        lastChecked.current = 0;
        setSnapshot({ scope, state: { status: 'loading' } });
        return;
      }
      if (shouldRefreshVisibleAccounts(panelIsOpen.current, document.visibilityState, Date.now(), lastChecked.current)) {
        const pending = inFlight.current;
        if (pending) void pending.finally(() => { if (active && panelIsOpen.current && document.visibilityState === 'visible') void reload(true); });
        else if (active) void reload(true);
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      active = false;
      sequence.current += 1;
      controller.current?.abort();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [reload, scope]);
  useEffect(() => {
    if (!scope || !panelOpen) return;
    // Returning to Accounts must not leave an old signup list visible for another interval.
    if (shouldRefreshVisibleAccounts(true, document.visibilityState, Date.now(), lastChecked.current)) void reload(true);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void reload(true);
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [panelOpen, reload, scope]);
  const state: RequestState = scope && snapshot?.scope === scope ? snapshot.state : { status: 'loading' };
  return { state, reload };
}

export function AccountConfirmation({ title, email, children, onCancel, onConfirm }: {
  title: string; email: string; children: ReactNode; onCancel: () => void; onConfirm: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useId();
  useEffect(() => {
    const node = dialog.current;
    const previous = document.activeElement;
    node?.showModal();
    return () => {
      node?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  return <dialog ref={dialog} className="contact-person-dialog panel" aria-labelledby={heading}
    onCancel={event => { event.preventDefault(); onCancel(); }}>
    <h2 id={heading}>{title}</h2>
    <p style={{ overflowWrap: 'anywhere' }}>{email}</p>
    {children}
    <div className="partner-person-actions">
      <button type="button" autoFocus onClick={onCancel}>Cancel</button>
      <button type="button" className="primary-button" onClick={onConfirm}>Confirm action</button>
    </div>
  </dialog>;
}

const roleLabels = { staff: 'Staff · assigned records', manager: 'Manager · all inquiries and referral partners' };
type Selection = { row: AccessRequest; type: Review['command']['type']; role: AccessRequest['role']; delegated?: boolean };
type RetainedReview = { body: Review; email: string };
export function AccessRequests({ requests, reload, owner, fetcher, renderHistory }: {
  requests: RequestState; reload: () => Promise<void>; owner: boolean; fetcher: typeof fetch;
  renderHistory?: (props: AccountHistoryProps) => ReactNode;
}) {
  const [search, setSearch] = useState('');
  const searchId = useId();
  const [history, setHistory] = useState<{ userId: string; revision: number }>();
  const currentHistory = history && owner && renderHistory && requests.status === 'ready' &&
    requests.rows.some(row => row.userId === history.userId && row.revision === history.revision) ? history : undefined;
  useEffect(() => { if (history && !currentHistory) setHistory(undefined); }, [history, currentHistory]);
  const [roles, setRoles] = useState<Record<string, string>>({});
  const [selection, setSelection] = useState<Selection>();
  const [operation, setOperation] = useState<RetainedReview>();
  const [knownFailure, setKnownFailure] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const busy = useRef(false);
  const notice = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (error || message) notice.current?.focus(); }, [error, message]);

  async function commit(retained: RetainedReview) {
    if (busy.current) return;
    busy.current = true;
    setOperation(retained);
    setKnownFailure(false);
    setPending(true);
    setError('');
    setMessage('');
    const { body, email } = retained;
    try {
      const value = await accountApi(fetcher, 'access-requests', body);
      const row = await verifyAccessDecisionReceipt(value, body, email);
      setOperation(undefined);
      setRoles(current => { const next = { ...current }; delete next[row.userId]; return next; });
      await reload();
      setMessage(`${body.command.type === 'approve' ? 'Approval' : body.command.type === 'revoke' ? 'Revocation' : 'Denial'} recorded. Check the refreshed account status for current access.${body.command.type === 'approve' ? ' If approval is still current, the person must sign in again.' : ''}`);
    } catch (failure) {
      setKnownFailure(failure instanceof SharedError && ['conflict', 'invalid_request'].includes(failure.code));
      setError(failure instanceof Error ? failure.message : 'The account decision could not be verified.');
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  function stage(row: AccessRequest, type: Review['command']['type']) {
    const choice = roles[row.userId];
    if (type === 'approve' && !['staff', 'manager', ...(owner ? ['partner'] : [])].includes(choice)) return;
    setSelection({ row, type, role: type === 'approve' ? choice === 'staff' ? 'staff' : 'manager' : null,
      delegated: type === 'approve' && owner && choice !== 'staff' ? choice === 'partner' : undefined });
  }
  function confirm() {
    if (!selection) return;
    const { row, type, role, delegated } = selection;
    const current = requests.rows?.find(item => item.userId === row.userId);
    setSelection(undefined);
    if (current?.revision !== row.revision || current.email !== row.email) {
      setError('The selected account changed. Refresh and review it again.');
      return;
    }
    void commit({ email: row.email, body: buildAccessReview(crypto.randomUUID(), row, type, role, delegated) });
  }

  const rows = requests.rows || [];
  const query = search.trim().toLocaleLowerCase();
  const matches = (row: AccessRequest) => !query || row.displayName.toLocaleLowerCase().includes(query) || row.email.toLocaleLowerCase().includes(query);
  const allWaiting = rows.filter(row => row.state === 'pending');
  const allAccounts = rows.filter(row => row.state !== 'pending');
  const waiting = allWaiting.filter(matches);
  const accounts = allAccounts.filter(matches);
  function card(row: AccessRequest) {
    const disabled = pending || Boolean(operation);
    const label = row.state === 'pending' ? 'Waiting for approval' : row.state === 'approved' ? 'Active'
      : row.state === 'denied' ? 'Denied' : 'Access revoked';
    return <article className="access-request-card" key={row.userId}>
      <div>
        <h3>{row.displayName || 'Unnamed Google account'}</h3>
        <small>Display name from Google</small>
        <p style={{ overflowWrap: 'anywhere' }}>{row.email}</p>
        <small>Email verified by Google at request time</small>
        <p><span className={`status-badge ${row.state === 'pending' ? 'tone-due' : row.state === 'approved' ? 'tone-contacted' : 'tone-new'}`}>{label}</span></p>
        <small>Requested {companyTime(row.requestedAt)}</small>
        {row.decidedAt && <small>Last decision {companyTime(row.decidedAt)}</small>}
        {row.role && <small>{roleLabels[row.role]}{row.delegatedUserAdmin && ' · can manage staff and managers'}</small>}
      </div>
      <div className="access-request-actions">
        {<label>
          <span>{row.state === 'approved' ? 'New role' : 'Role to approve'}</span>
          <select value={roles[row.userId] || ''} disabled={disabled}
            onChange={event => setRoles(current => ({ ...current, [row.userId]: event.target.value }))}>
            <option value="">Choose a role</option>
            <option value="staff">{roleLabels.staff}</option>
            <option value="manager">{roleLabels.manager}</option>
            {owner && <option value="partner">Partner administrator · manages staff and managers</option>}
          </select>
        </label>}
        {<button type="button" className="primary-button"
          disabled={disabled || !roles[row.userId]} onClick={() => stage(row, 'approve')}>
          {row.state === 'approved' ? 'Change role' : row.state === 'pending' ? 'Approve access' : 'Approve again'}
        </button>}
        {row.state === 'pending' && <button type="button" disabled={disabled} onClick={() => stage(row, 'deny')}>Deny request</button>}
        {row.state === 'approved' && <button type="button" disabled={disabled} onClick={() => stage(row, 'revoke')}>Revoke access</button>}
        {owner && renderHistory && <button type="button" disabled={disabled} onClick={() => setHistory({userId: row.userId, revision: row.revision})}>Recorded decisions</button>}
      </div>
    </article>;
  }
  return <>
    <section className="panel dashboard-card" aria-labelledby="account-requests-heading">
      <div className="prospect-list-head"><div><h2 id="account-requests-heading">Pending signup requests</h2>
        <p>Check the email and confirm the person should have ECH access before you choose a role.</p></div>
        <button type="button" disabled={requests.status === 'loading' || pending} onClick={() => void reload()}>Refresh requests</button>
      </div>
      <label htmlFor={searchId}>Find an account by name or email</label>
      <input id={searchId} type="search" value={search} onChange={event => setSearch(event.target.value)}
        placeholder="Name or email" autoComplete="off" />
      {search && <button type="button" onClick={() => setSearch('')}>Clear account search</button>}
      {requests.status === 'loading' && <p role="status">Checking signup requests…</p>}
      {requests.status === 'unavailable' && <p role="alert" className="field-error">Signup requests are unavailable. Refresh to check the current list.</p>}
      {error && <p ref={notice} tabIndex={-1} role="alert" className="field-error">{error}</p>}
      {message && <p ref={notice} tabIndex={-1} role="status">{message}</p>}
      {operation && <aside className="panel dashboard-card">
        <p>{pending ? 'Saving decision' : knownFailure ? 'Rejected decision retained' : 'Decision outcome unconfirmed'} for <strong>{operation.email}</strong>.</p>
        <p>{operation.body.command.type === 'approve' ? `Approve access: ${roleLabels[operation.body.command.role!]}${operation.body.command.delegatedUserAdmin === true ? ' · can manage staff and managers' : ''}`
          : operation.body.command.type === 'deny' ? 'Deny signup request' : 'Revoke account access'}</p>
        {!pending && <p>Refresh and check the current account status before retrying this decision.</p>}
        <button type="button" disabled={pending} onClick={() => void commit(operation)}>Retry same decision</button>
        {knownFailure && <button type="button" onClick={() => { setOperation(undefined); setError(''); }}>Clear rejected decision</button>}
      </aside>}
      <p role="status">{requests.status === 'ready' && (waiting.length === 0
        ? (query ? 'No pending signup requests match this search.' : 'No pending signup requests.')
        : (query ? `${waiting.length} of ${allWaiting.length} loaded pending signup requests match.` : `${waiting.length} pending signup request${waiting.length === 1 ? '' : 's'}.`))}</p>
      {requests.status === 'ready' && waiting.length > 0 && <div className="access-request-list">{waiting.map(card)}</div>}
    </section>
    {requests.status === 'ready' && <section className="panel dashboard-card" aria-labelledby="google-accounts-heading">
      <h2 id="google-accounts-heading">Reviewed Google accounts</h2>
      {query && <p role="status">{accounts.length} of {allAccounts.length} loaded reviewed accounts match.</p>}
      {accounts.length ? <div className="access-request-list">{accounts.map(card)}</div> : <p>{query ? 'No reviewed accounts match this search.' : 'No requests have been reviewed yet.'}</p>}
    </section>}
    {currentHistory && renderHistory && renderHistory({ ...currentHistory, fetcher, onClose: () => setHistory(undefined) })}
    {selection && <AccountConfirmation title={selection.type === 'revoke' ? 'Revoke access?' :
      selection.type === 'deny' ? 'Deny this request?' : selection.row.state === 'approved' ? 'Change this role?' : 'Approve this account?'}
      email={selection.row.email} onCancel={() => setSelection(undefined)} onConfirm={confirm}>
      <p>{selection.row.displayName}</p>
      <p>{selection.role ? `${roleLabels[selection.role]}${selection.delegated ? ' · can manage staff and managers' : ''}. The person must sign in again.`
        : selection.type === 'revoke' ? 'This ends existing sessions and blocks new sign-ins.' : 'This person will remain unable to sign in.'}</p>
    </AccountConfirmation>}
  </>;
}
