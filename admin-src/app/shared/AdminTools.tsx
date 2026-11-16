'use client';
import { MembershipChangeSummary } from './MembershipChangeSummary';
import { membershipSaveFeedback } from './membership-save-feedback.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessRequests, AccountConfirmation, accountApi, canonical, fingerprint, type RequestState } from './AccessRequests';
import { can, parseRecord, SharedError, uuid, type Session } from './live-model';
type Member={userId:string;email:string;displayName:string;technicalAdmin:boolean;operationalRole:'owner'|'manager'|'staff'|null;applicationAdmin:boolean;delegatedUserAdmin?:true;active:boolean;revision:number};
type Snapshot={format:'ech-application-snapshot';version:1;records:unknown[];personKeys:unknown[];events:unknown[];commandReceipts:unknown[];memberships:unknown[];membershipReceipts:unknown[];[key:string]:unknown};
function validateSnapshot(value:unknown):Snapshot {
 const s=value as Snapshot;if(!s||s.format!=='ech-application-snapshot'||s.version!==1||!['records','personKeys','events','commandReceipts','memberships','membershipReceipts'].every(k=>Array.isArray(s[k])))throw new Error('Unsupported recovery file.');
 const rows=s.records as {kind:string;id:string;revision:number;data:object}[];const keys=new Set<string>();
 for(const r of rows){if(!['partner','inquiry'].includes(r.kind)||typeof r.id!=='string'||!Number.isSafeInteger(r.revision)||r.revision<1||!r.data||keys.has(r.kind+':'+r.id))throw new Error('Invalid or duplicated recovery record.');keys.add(r.kind+':'+r.id);}
 for(const e of s.events as {record_type:string;record_id:string}[])if(!keys.has(e.record_type+':'+e.record_id))throw new Error('Recovery event refers to a missing record.');
 for(const k of s.personKeys as {partner_id:string}[])if(!keys.has('partner:'+k.partner_id))throw new Error('Recovery contact refers to a missing partner.');
 for(const r of s.commandReceipts as {record_type:string;record_id:string}[])if(!keys.has(r.record_type+':'+r.record_id))throw new Error('Recovery receipt refers to a missing record.');
 return s;
}
function b64(bytes:Uint8Array){let value='';for(const b of bytes)value+=String.fromCharCode(b);return btoa(value);}
function unb64(value:string){return Uint8Array.from(atob(value),c=>c.charCodeAt(0));}
async function derive(passphrase:string,salt:Uint8Array){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(passphrase),'PBKDF2',false,['deriveKey']);return crypto.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt:salt as BufferSource,iterations:600000},key,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);}
function download(name:string,value:unknown){const url=URL.createObjectURL(new Blob([JSON.stringify(value)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
type Fields = Omit<Member, 'userId' | 'email' | 'revision' | 'delegatedUserAdmin'> & { delegatedUserAdmin: boolean };
type MembershipOperation = {
 schema: 1; operationId: string; expectedRevision: number;
 command: { type: 'upsert'; email: string; fields: Omit<Fields,'delegatedUserAdmin'> };
};
type Draft = { email: string; userId?: string; revision: number; fields: Fields };
export function buildMembershipOperation(operationId: string, draft: Draft): MembershipOperation {
 return {schema:1,operationId,expectedRevision:draft.revision,command:{type:'upsert',email:draft.email.trim().toLowerCase(),
 fields:{displayName:draft.fields.displayName.trim(),technicalAdmin:draft.fields.technicalAdmin,operationalRole:draft.fields.operationalRole,applicationAdmin:draft.fields.applicationAdmin,active:draft.fields.active}}};
}
const newDraft = (): Draft => ({ email: '', revision: 0, fields: {
 displayName: '', operationalRole: 'staff', active: true, technicalAdmin: false,
 applicationAdmin: false, delegatedUserAdmin: false,
} });

function memberRow(value: unknown): Member {
 const member = value as Member;
 if (!member || !uuid(member.userId) || typeof member.email !== 'string' || typeof member.displayName !== 'string' ||
     ![null, 'staff', 'manager', 'owner'].includes(member.operationalRole) ||
     ![member.active, member.applicationAdmin, member.technicalAdmin].every(value => typeof value === 'boolean') ||
     !Number.isSafeInteger(member.revision) || member.revision < 1 ||
     (Object.hasOwn(member, 'delegatedUserAdmin') && (member.delegatedUserAdmin !== true ||
       member.operationalRole !== 'manager' || member.technicalAdmin || member.applicationAdmin))) {
  throw new Error('Account data could not be verified.');
 }
 return member;
}

export function AdminTools({ session, onChanged, requests, reloadRequests, fetcher, visible }: {
 session: Session; onChanged: () => Promise<void>; requests: RequestState;
 reloadRequests: () => Promise<void>; fetcher: typeof fetch; visible: boolean;
}) {
 const [members, setMembers] = useState<Member[]>();
 const [memberLoading, setMemberLoading] = useState(false);
 const [memberFailure, setMemberFailure] = useState(false);
 const [draft, setDraft] = useState<Draft>();
 const [confirming, setConfirming] = useState(false);
 const [operation, setOperation] = useState<{ body: MembershipOperation; userId?: string }>();
 const [knownFailure, setKnownFailure] = useState(false);
 const [pending,setPending] = useState(false);const busy=useRef(false);const [message,setMessage]=useState('');const [error,setError]=useState('');const [passphrase,setPassphrase]=useState('');const [recoveryFile,setRecoveryFile]=useState<File|null>(null);const [recovered,setRecovered]=useState(false);const [backupHash,setBackupHash]=useState('');const [batch,setBatch]=useState<Record<string,unknown>[]|null>(null);const [progress,setProgress]=useState(0);const [pastedBatch,setPastedBatch]=useState('');
 const owner = can(session, 'backup.export');
 const reviewer = can(session, 'access.review');
 const canManage = can(session, 'users.manage');
 const actor = session.authenticated ? session.principal.id : '';
 const memberCheck = useRef(0);
 const errorRef=useRef<HTMLParagraphElement>(null);
 useEffect(()=>{if(error)errorRef.current?.focus();},[error]);
 const loadMembers = useCallback(async () => {
  const check = ++memberCheck.current;
  setMemberLoading(true);
  setMemberFailure(false);
  setMembers(undefined);
  try {
   const result = await accountApi(fetcher, 'memberships') as { schema: number; items: unknown[] };
   if (result?.schema !== 1 || !Array.isArray(result.items)) throw new Error('Unverified list');
   const rows = result.items.map(memberRow);
   if (new Set(rows.map(row => row.userId)).size !== rows.length) throw new Error('Duplicate account identities');
   if (check === memberCheck.current) { setMembers(rows); return rows; }
  } catch {
   if (check === memberCheck.current) setMemberFailure(true);
  } finally {
   if (check === memberCheck.current) setMemberLoading(false);
  }
 }, [fetcher]);
 useEffect(() => {
  if (visible && canManage) void loadMembers();
  return () => { memberCheck.current += 1; };
 }, [visible, canManage, loadMembers]);

 if (!canManage) return null;
 const api = (path: string, body?: unknown) => accountApi(fetcher, path, body, 12_000_000);
 const requestsReady = !reviewer || requests.status === 'ready';
 const legacy = members?.filter(member => !requests.rows?.some(request => request.userId === member.userId));
 async function run(action:()=>Promise<void>){if(busy.current)return;busy.current=true;setPending(true);setError('');setMessage('');try{await action();}catch(e){setError(e instanceof Error?e.message:'Action could not be verified.');}finally{busy.current=false;setPending(false);}}
 function choose(member: Member) {
  const { userId, email, revision, ...fields } = member;
  setDraft({ userId, email, revision, fields: { ...fields, delegatedUserAdmin: Boolean(fields.delegatedUserAdmin) } });
 }
 function changeFields(change: Partial<Fields>) {
  setDraft(current => current && { ...current, fields: { ...current.fields, ...change } });
 }
 function confirmMembership() {
  setConfirming(false);
  if (!draft || !members || !requestsReady ||
      (draft.userId && !legacy?.some(member => member.userId === draft.userId && member.revision === draft.revision && member.email === draft.email))) {
   setError('The selected account changed. Refresh accounts and choose it again.');
   return;
  }
  const body = buildMembershipOperation(crypto.randomUUID(), draft);
  void commitMembership({ body, userId: draft.userId });
 }
 async function commitMembership(retained: NonNullable<typeof operation>) {
  await run(async () => {
   setOperation(retained);
   setKnownFailure(false);
   const { body, userId } = retained;
   try {
    const result = await api('memberships', body) as { schema: number; member: unknown;
     receipt: { operationId: string; expectedRevision: number; revision: number; commandFingerprint: string } };
    const row = memberRow(result.member);
    const { receipt } = result;
    if (result.schema !== 1 || (userId && row.userId !== userId) || row.email !== body.command.email ||
        row.revision !== body.expectedRevision + 1 || receipt?.operationId !== body.operationId ||
        receipt.expectedRevision !== body.expectedRevision || receipt.revision !== row.revision ||
        receipt.commandFingerprint !== await fingerprint(body) ||
        !Object.entries(body.command.fields).every(([field, value]) => field === 'delegatedUserAdmin'
         ? Boolean(row.delegatedUserAdmin) === value : row[field as keyof Member] === value)) {
     throw new Error('The save receipt could not be verified. Refresh and retry the retained operation.');
    }
    setOperation(undefined);
    setDraft(undefined);
    const refreshedMembers = await loadMembers();
    setMessage(membershipSaveFeedback(row, refreshedMembers));
   } catch (failure) {
    setKnownFailure(failure instanceof SharedError && ['conflict', 'invalid_request'].includes(failure.code));
    throw failure;
   }
  });
 }
 async function backup(){await run(async()=>{if(passphrase.length<16)throw new Error('Use a backup passphrase of at least16 characters. Keep it separately from the backup.');const snapshot=validateSnapshot(await api('backup'));const bytes=new TextEncoder().encode(JSON.stringify(snapshot));const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));const key=await derive(passphrase,salt);const ciphertext=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,bytes));const file={format:'ech-encrypted-backup',version:1,kdf:'PBKDF2-SHA256',iterations:600000,cipher:'AES-256-GCM',salt:b64(salt),iv:b64(iv),ciphertext:b64(ciphertext),sha256:await fingerprint(snapshot)};const restored=await crypto.subtle.decrypt({name:'AES-GCM',iv},key,ciphertext);const reread=validateSnapshot(JSON.parse(new TextDecoder().decode(restored)));if(await fingerprint(reread)!==file.sha256)throw new Error('Encrypted backup verification failed.');download('ech-application-backup-'+new Date().toISOString().slice(0,10)+'.json',file);setPassphrase('');setBackupHash(file.sha256);setRecovered(false);setMessage(`Encrypted backup downloaded and encryption round-trip verified: ${snapshot.records.length} records. Reopen the downloaded file below to verify recovery integrity.`);});}
 async function checkRecovery(){await run(async()=>{if(!recoveryFile||passphrase.length<16)throw new Error('Choose the encrypted backup and enter its passphrase privately.');if(recoveryFile.size>20_000_000)throw new Error('Recovery file exceeds the supported size.');const f=JSON.parse(await recoveryFile.text());if(f.format!=='ech-encrypted-backup'||f.version!==1||f.iterations!==600000||f.kdf!=='PBKDF2-SHA256'||f.cipher!=='AES-256-GCM')throw new Error('Unsupported encrypted backup.');const key=await derive(passphrase,unb64(f.salt));const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(f.iv)},key,unb64(f.ciphertext));const snapshot=validateSnapshot(JSON.parse(new TextDecoder().decode(plain)));const hash=await fingerprint(snapshot);if(hash!==f.sha256||backupHash&&hash!==backupHash)throw new Error('Backup integrity did not match.');setPassphrase('');setBackupHash(hash);setRecovered(true);setMessage(`Downloaded backup reopened, decrypted and integrity checked: ${snapshot.records.length} records. No live data or permission grants were restored.`);});}
 async function readBatchText(text:string){await run(async()=>{setBatch(null);if(new TextEncoder().encode(text).length>3_000_000)throw new Error('Use the verified referral import below 3 MB.');const p=JSON.parse(text);if(p.schema!==1||p.targetKind!=='partner'||p.targetProject!=='txjkfglbnzrvcolkgvyn'||p.records?.length!==50)throw new Error('Expected the verified 50-record referral-partner batch.');const seen=new Set<string>();let briefs=0;for(const r of p.records){if(r.kind!=='partner'||r.ownerId!==null||seen.has(r.sourceKey)||r.envelope?.command?.type!=='create'||r.envelope.expectedRevision!==0)throw new Error('Invalid or duplicate source record.');seen.add(r.sourceKey);if(r.brief){briefs++;if(Number(r.brief.title.slice(0,2))!==r.rank)throw new Error('Brief rank does not match the prospect.');}}if(briefs!==15)throw new Error('Expected all 15 existing briefs.');setBatch(p.records);setProgress(0);setMessage('Prepared 50 referral partners and 15 matched briefs. Source flags and unconfirmed assignments retained.');});}
 async function readBatch(file:File){if(file.size>3_000_000){await run(async()=>{setBatch(null);throw new Error('Use the verified referral import below 3 MB.');});return;}await readBatchText(await file.text());}
 async function verifyBatch(){await run(async()=>{
  if(!batch)throw new Error('Load the original referral import to compare saved records.');
  const saved:ReturnType<typeof parseRecord>[]=[];const cursors=new Set<string>();let cursor:string|null=null;
  do{const page=await api('partners?limit=20'+(cursor?'&cursor='+encodeURIComponent(cursor):'')) as {schema:number;mode:string;items:unknown[];nextCursor:string|null};
   if(page.schema!==1||page.mode!=='shared'||!Array.isArray(page.items)||page.items.length>20||!(page.nextCursor===null||typeof page.nextCursor==='string'))throw new Error('Saved partner list could not be verified.');
   saved.push(...page.items.map(row=>parseRecord('partner',row)));cursor=page.nextCursor;
   if(cursor){if(cursors.has(cursor)||cursors.size>=100)throw new Error('Partner pagination could not be verified.');cursors.add(cursor);}
  }while(cursor);
  if(saved.length!==50||new Set(saved.map(row=>row.id)).size!==50)throw new Error(`Expected 50 saved referral partners; found ${saved.length}.`);
  let briefs=0;for(const r of batch){const envelope=r.envelope as {command:{id:string;fields:Record<string,unknown>}};const record=saved.find(row=>row.id===envelope.command.id);const source={origin:'executive-handoff',sourceKey:r.sourceKey,rank:r.rank,sourceVariants:r.sourceVariants,brief:r.brief,reviewFlags:r.reviewFlags,assignment:r.assignment};
   if(!record||record.ownerId!==null||canonical(record.source)!==canonical(source)||Object.entries(envelope.command.fields).some(([key,value])=>canonical((record as unknown as Record<string,unknown>)[key])!==canonical(value)))throw new Error(`Saved referral partner ${r.rank} differs from the original import. No records were changed by verification.`);
   if(typeof record.source==='object'&&record.source.brief)briefs++;
  }
  if(briefs!==15)throw new Error('Expected 15 saved priority briefs.');
  const inquiries=await api('inquiries?limit=20') as {schema:number;mode:string;items:unknown[];nextCursor:string|null};
  if(inquiries.schema!==1||inquiries.mode!=='shared'||!Array.isArray(inquiries.items))throw new Error('Care Inquiry separation could not be verified.');
  setMessage(`Verified from shared storage: 50 referral partners, 15 priority briefs, all original fields and source links matched, all 50 unassigned. Care Inquiries remain separate (${inquiries.items.length}${inquiries.nextCursor?'+':''} records). Verification changed no records.`);
 });}
 async function importBatch(){await run(async()=>{if(!batch)throw new Error('Choose the verified referral-partner import first.');let count=0;for(const r of batch){const body={...(r.envelope as object),source:{origin:'executive-handoff',sourceKey:r.sourceKey,rank:r.rank,sourceVariants:r.sourceVariants,brief:r.brief,reviewFlags:r.reviewFlags,assignment:r.assignment}};const result=await api('imports',body) as {record:unknown;receipt:{commandFingerprint:string}};const record=parseRecord('partner',result.record);if(result.receipt?.commandFingerprint!==await fingerprint(body)||record.source.sourceKey!==r.sourceKey||record.ownerId!==null)throw new Error('Import receipt or source identity mismatch. Import stopped; retain this batch and reload before retrying.');count++;setProgress(count);}await onChanged();setMessage(`Server confirmed ${count} referral partners and 15 briefs. Reload and independently read back the count and source links.`);});}
 return <section className="admin-tools" aria-label="Account management">
  {reviewer && <AccessRequests requests={requests} reload={reloadRequests} owner={owner} fetcher={fetcher} />}
  {error && <p ref={errorRef} tabIndex={-1} role="alert" className="field-error">{error}</p>}
  <section className="panel dashboard-card" aria-labelledby="legacy-accounts-heading">
   <div className="prospect-list-head"><div><h2 id="legacy-accounts-heading">Existing ECH accounts</h2>
    <p>Accounts added directly to ECH. Google accounts are listed above.</p></div>
    <button type="button" disabled={memberLoading || pending} onClick={() => void loadMembers()}>Refresh accounts</button>
   </div>
   {memberLoading && <p role="status">Checking existing accounts…</p>}
   {memberFailure && <p role="alert" className="field-error">Existing accounts could not be verified. Refresh to try again.</p>}
   {members && !requestsReady && <p role="status">Verify the Google account list before changing existing accounts.</p>}
   {operation && <aside className="panel dashboard-card">
    <p>Save retained for <strong>{operation.body.command.email}</strong>. Refresh and check access before retrying.</p>
    <MembershipChangeSummary fields={operation.body.command.fields} />
    <button type="button" disabled={pending} onClick={() => void commitMembership(operation)}>Retry same save</button>
    {knownFailure && <button type="button" onClick={() => { setOperation(undefined); setError(''); }}>Clear rejected save</button>}
   </aside>}
   {members && requestsReady && <>
    {legacy?.length ? <div className="access-request-list">{legacy.map(member => {
     const protectedAccount = member.userId === actor || member.operationalRole === 'owner';
     return <article key={member.userId} className="access-request-card">
      <div><h3>{member.displayName}</h3><small>Display name set in ECH</small>
       <p style={{ overflowWrap: 'anywhere' }}>{member.email}</p>
       <small>Account email on file · {member.active ? 'Active' : 'Inactive'} · {member.operationalRole ?? 'No CRM access'}
        {member.delegatedUserAdmin && ' · can manage staff accounts'}</small></div>
      <div className="access-request-actions">{protectedAccount ? <p>Protected account</p> :
       <button type="button" disabled={pending || Boolean(operation)} onClick={() => choose(member)}>Review account</button>}</div>
     </article>;
    })}</div> : <p>No directly added accounts in your scope.</p>}
    {owner && <button type="button" disabled={pending || Boolean(operation)} onClick={() => setDraft(newDraft())}>Grant access to an existing sign-in</button>}
    {draft && !operation && <form className="intake-form" onSubmit={event => { event.preventDefault(); setConfirming(true); }}>
     <h3>{draft.userId ? 'Review account permissions' : 'Grant access to an existing sign-in'}</h3>
     <div className="form-grid">
      <label><span>Account email</span><input type="email" required maxLength={254} value={draft.email} readOnly={Boolean(draft.userId)}
       onChange={event => setDraft({ ...draft, email: event.target.value })} /></label>
      <label><span>Display name</span><input required value={draft.fields.displayName} maxLength={160}
       onChange={event => changeFields({ displayName: event.target.value })} /></label>
      {owner && <label><span>CRM role</span><select value={draft.fields.operationalRole || ''} onChange={event => {
       const role = (event.target.value || null) as Member['operationalRole'];
       changeFields({ operationalRole: role, ...(role !== 'manager' ? { delegatedUserAdmin: false } : {}) });
      }}><option value="">No CRM access</option><option value="staff">Staff · assigned records</option>
       <option value="manager">Manager · all inquiries and referral partners</option></select></label>}
     </div>
     <label><input type="checkbox" checked={draft.fields.active} onChange={event => changeFields({ active: event.target.checked })} />Allow this account to sign in</label>
     {owner && <>
      <label><input type="checkbox" checked={draft.fields.technicalAdmin} onChange={event => changeFields({ technicalAdmin: event.target.checked, ...(event.target.checked ? { delegatedUserAdmin: false } : {}) })} />Technical status access</label>
      {draft.fields.applicationAdmin && <label><input type="checkbox" checked={draft.fields.applicationAdmin} onChange={event => changeFields({ applicationAdmin: event.target.checked })} />Retain existing application administrator flag</label>}
     </>}
     <div className="access-request-actions"><button type="button" onClick={() => setDraft(undefined)}>Cancel edit</button>
      <button type="submit" className="primary-button" disabled={pending}>Review change</button></div>
    </form>}
   </>}
  </section>
  {confirming && draft && <AccountConfirmation title={draft.fields.active ? 'Save these account permissions?' : 'Deactivate this account?'}
   email={draft.email} onCancel={() => setConfirming(false)} onConfirm={confirmMembership}>
   <MembershipChangeSummary fields={buildMembershipOperation('', draft).command.fields} />
  </AccountConfirmation>}
  {owner && <>
 <details className="panel dashboard-card"><summary>Activity and backup</summary><p>Optional: download an encrypted copy of shared data and keep its passphrase separately. This is not required to import referral partners. Recovery verification never restores permission grants automatically.</p><label><span>Backup passphrase (enter privately)</span><input aria-label="Backup passphrase" type="password" autoComplete="off" value={passphrase} onChange={e=>setPassphrase(e.target.value)} /></label><button type="button" disabled={pending||passphrase.length<16} onClick={backup}>Download encrypted shared backup</button><label><span>Downloaded encrypted backup</span><input aria-label="Downloaded encrypted backup" type="file" accept="application/json,.json" onChange={e=>{setRecoveryFile(e.target.files?.[0]||null);setRecovered(false);}} /></label><button type="button" disabled={pending||!recoveryFile||passphrase.length<16} onClick={checkRecovery}>Verify downloaded backup recovery integrity</button><p>Backup file recovery integrity: {recovered?'verified':'not yet verified'}.</p></details>
 <details className="panel dashboard-card"><summary>Referral Partner import</summary><p>Import the verified 50 partners and 15 briefs. Care Inquiries, original Sheets and existing assignments are not changed. Imports send no outreach. Any conflicting existing record stops the import.</p><label><span>Choose verified referral import</span><input aria-label="Choose verified referral import" type="file" accept="application/json,.json" disabled={pending} onChange={e=>{const f=e.target.files?.[0];if(f)void readBatch(f);}} /></label><label><span>Or paste verified referral import</span><textarea aria-label="Paste verified referral import" rows={3} maxLength={3_000_000} spellCheck={false} disabled={pending} value={pastedBatch} onChange={e=>{setPastedBatch(e.target.value);setBatch(null);}} /></label><button type="button" disabled={pending||!pastedBatch.trim()} onClick={()=>readBatchText(pastedBatch)}>Load pasted referral import</button><button type="button" disabled={pending||!batch} onClick={importBatch}>Import 50 referral partners</button><button type="button" disabled={pending||!batch} onClick={verifyBatch}>Verify saved referral partners</button><p role="status">{progress} of 50 partner saves confirmed this run.</p></details>
 </>}
 {pending&&<p role="status">Checking the server…</p>}{message&&<p role="status">{message}</p>}
 </section>;
}
