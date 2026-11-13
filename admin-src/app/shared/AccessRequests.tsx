'use client';
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { readJson, requestOptions, statusError } from './session';
import { SharedError, uuid } from './live-model';
import { companyTime } from './time';

export type AccessRequest = {
  userId: string; email: string; displayName: string; state: 'pending' | 'approved' | 'denied' | 'revoked';
  role: 'staff' | 'manager' | null; delegatedUserAdmin?: true; revision: number;
  requestedAt: string; decidedAt: string | null;
};
type Review = {
  schema: 1; operationId: string; expectedRevision: number;
  command: { type: 'approve' | 'deny' | 'revoke'; userId: string; role: AccessRequest['role']; delegatedUserAdmin?: boolean };
};
export function buildAccessReview(operationId: string, row: {userId:string;revision:number}, type: Review['command']['type'], role: AccessRequest['role']): Review {
 return {schema:1,operationId,expectedRevision:row.revision,command:{type,userId:row.userId,role}};
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
export async function accountApi(fetcher: typeof fetch, path: string, body?: unknown, maximum?: number) {
  const response = await fetcher('/api/admin/' + path, {
    ...requestOptions(),
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

export function useAccountRequests(fetcher: typeof fetch, scope: string) {
  const [snapshot, setSnapshot] = useState<{ scope: string; state: RequestState }>();
  const sequence = useRef(0);
  const lastChecked = useRef(0);
  const reload = useCallback(async () => {
    if (!scope) return;
    const ticket = ++sequence.current;
    setSnapshot({ scope, state: { status: 'loading' } });
    try {
      const data = await accountApi(fetcher, 'access-requests') as { schema: number; items: unknown[] };
      if (data?.schema !== 1 || !Array.isArray(data.items)) throw new Error('Unverified list');
      const rows = data.items.map(requestRow);
      if (new Set(rows.map(row => row.userId)).size !== rows.length) throw new Error('Duplicate subjects');
      if (ticket === sequence.current) setSnapshot({ scope, state: { status: 'ready', rows } });
    } catch {
      if (ticket === sequence.current) setSnapshot({ scope, state: { status: 'unavailable' } });
    } finally {
      if (ticket === sequence.current) lastChecked.current = Date.now();
    }
  }, [fetcher, scope]);
  useEffect(() => {
    if (!scope) return;
    lastChecked.current = Date.now();
    void reload();
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastChecked.current >= 60_000) {
        lastChecked.current = Date.now();
        void reload();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      sequence.current += 1;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [reload, scope]);
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
type Selection = { row: AccessRequest; type: Review['command']['type']; role: AccessRequest['role']; delegated: boolean };
type RetainedReview = { body: Review; email: string };
export function AccessRequests({ requests, reload, owner, fetcher }: {
  requests: RequestState; reload: () => Promise<void>; owner: boolean; fetcher: typeof fetch;
}) {
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
      const value = await accountApi(fetcher, 'access-requests', body) as {
        schema: number; request: unknown;
        receipt: { operationId: string; expectedRevision: number; revision: number; commandFingerprint: string };
      };
      const row = requestRow(value.request);
      const state = { approve: 'approved', deny: 'denied', revoke: 'revoked' }[body.command.type];
      if (value.schema !== 1 || row.userId !== body.command.userId || row.email !== email ||
          row.state !== state || row.role !== body.command.role || row.revision !== body.expectedRevision + 1 ||
          (body.command.type === 'approve' && Boolean(row.delegatedUserAdmin) !== Boolean(body.command.delegatedUserAdmin)) ||
          value.receipt?.operationId !== body.operationId || value.receipt.expectedRevision !== body.expectedRevision ||
          value.receipt.revision !== row.revision || value.receipt.commandFingerprint !== await fingerprint(body)) {
        throw new Error('Decision receipt could not be verified. Refresh the list before retrying the same decision.');
      }
      setOperation(undefined);
      setRoles(current => { const next = { ...current }; delete next[row.userId]; return next; });
      await reload();
      setMessage(body.command.type === 'approve'
        ? 'Access saved. This person must sign in again to use the approved role.'
        : body.command.type === 'revoke' ? 'Access revoked. Previous sessions can no longer be used.' : 'Denial saved.');
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
    if (type === 'approve' && !['staff', ...(owner ? ['manager'] : [])].includes(choice)) return;
    setSelection({ row, type, role: type === 'approve' ? choice === 'staff' ? 'staff' : 'manager' : null,
      delegated: false });
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
    void commit({ email: row.email, body: buildAccessReview(crypto.randomUUID(), row, type, role) });
  }

  const rows = requests.rows || [];
  const waiting = rows.filter(row => row.state === 'pending');
  const accounts = rows.filter(row => row.state !== 'pending');
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
        {row.role && <small>{roleLabels[row.role]}{row.delegatedUserAdmin && ' · can manage staff accounts'}</small>}
      </div>
      <div className="access-request-actions">
        {(row.state !== 'approved' || owner) && <label>
          <span>{row.state === 'approved' ? 'New role' : 'Role to approve'}</span>
          <select value={roles[row.userId] || ''} disabled={disabled}
            onChange={event => setRoles(current => ({ ...current, [row.userId]: event.target.value }))}>
            <option value="">Choose a role</option>
            <option value="staff">{roleLabels.staff}</option>
            {owner && <><option value="manager">{roleLabels.manager}</option>
              </>}
          </select>
        </label>}
        {(row.state !== 'approved' || owner) && <button type="button" className="primary-button"
          disabled={disabled || !roles[row.userId]} onClick={() => stage(row, 'approve')}>
          {row.state === 'approved' ? 'Change role' : row.state === 'pending' ? 'Approve access' : 'Approve again'}
        </button>}
        {row.state === 'pending' && <button type="button" disabled={disabled} onClick={() => stage(row, 'deny')}>Deny request</button>}
        {row.state === 'approved' && <button type="button" disabled={disabled} onClick={() => stage(row, 'revoke')}>Revoke access</button>}
      </div>
    </article>;
  }
  return <>
    <section className="panel dashboard-card" aria-labelledby="account-requests-heading">
      <div className="prospect-list-head"><div><h2 id="account-requests-heading">Pending signup requests</h2>
        <p>Check the email and confirm the person should have ECH access before you choose a role.</p></div>
        <button type="button" disabled={requests.status === 'loading' || pending} onClick={() => void reload()}>Refresh requests</button>
      </div>
      {requests.status === 'loading' && <p role="status">Checking signup requests…</p>}
      {requests.status === 'unavailable' && <p role="alert" className="field-error">Signup requests are unavailable. Refresh to check the current list.</p>}
      {error && <p ref={notice} tabIndex={-1} role="alert" className="field-error">{error}</p>}
      {message && <p ref={notice} tabIndex={-1} role="status">{message}</p>}
      {operation && <aside className="panel dashboard-card">
        <p>Decision retained for <strong>{operation.email}</strong>. Refresh and check access before retrying.</p>
        <button type="button" disabled={pending} onClick={() => void commit(operation)}>Retry same decision</button>
        {knownFailure && <button type="button" onClick={() => { setOperation(undefined); setError(''); }}>Clear rejected decision</button>}
      </aside>}
      {requests.status === 'ready' && (waiting.length
        ? <div className="access-request-list">{waiting.map(card)}</div>
        : <p role="status">No pending signup requests.</p>)}
    </section>
    {requests.status === 'ready' && <section className="panel dashboard-card" aria-labelledby="google-accounts-heading">
      <h2 id="google-accounts-heading">Reviewed Google accounts</h2>
      {accounts.length ? <div className="access-request-list">{accounts.map(card)}</div> : <p>No requests have been reviewed yet.</p>}
    </section>}
    {selection && <AccountConfirmation title={selection.type === 'revoke' ? 'Revoke access?' :
      selection.type === 'deny' ? 'Deny this request?' : selection.row.state === 'approved' ? 'Change this role?' : 'Approve this account?'}
      email={selection.row.email} onCancel={() => setSelection(undefined)} onConfirm={confirm}>
      <p>{selection.row.displayName}</p>
      <p>{selection.role ? `${roleLabels[selection.role]}${selection.delegated ? ' · can manage staff accounts' : ''}. The person must sign in again.`
        : selection.type === 'revoke' ? 'This ends existing sessions and blocks new sign-ins.' : 'This person will remain unable to sign in.'}</p>
    </AccountConfirmation>}
  </>;
}
