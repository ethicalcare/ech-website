'use client';
import './admin.css';
import './crm.css';
import './named-shell.css';
import {NamedOperations, namedSections} from './NamedOperations';
import { Icon, type IconName } from './Icon';
import { echLogo } from './brand-logo';
import { companyDate } from './time';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { can, canOperate, type Assignee, type Session, type SharedInquiry, type SharedPartner, type SharedRecord, type RecordKind, type Command } from './live-model';
import { createSessionClient } from './session';
import { createSharedRepository } from './inquiry-repository';
import { RecordEditor, inquiryForQueue } from './RecordEditor';
import { SignIn } from './SignIn';
import { mayRead, type RetainedDraft } from './editor';
import { ReferralPartners } from './adapters';
import { InlinePartnerAdd } from './adapters';
import { useDashboardNavigation, type DashboardView } from '../dashboard-navigation';
import { AdminTools } from './AdminTools';
import { useAccountRequests } from './AccessRequests';
import { FollowUpQueue } from './SharedFollowUpQueue';

export function AdminWorkspace({ fetcher = fetch, localOperations }: { fetcher?: typeof fetch; localOperations?: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null); const verified = useRef<Session | null>(null); const epoch = useRef(0);
  const refreshing = useRef(false); const lastChecked = useRef(0);
  const [checking, setChecking] = useState(true); const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [pending, setPending] = useState(false);
  const [inquiries, setInquiries] = useState<SharedInquiry[]>([]); const [partners, setPartners] = useState<SharedPartner[]>([]); const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [cursors, setCursors] = useState<{ inquiry: string | null; partner: string | null }>({ inquiry: null, partner: null });
  const navigation = useDashboardNavigation();
  const [showAccounts, setShowAccounts] = useState(false);
  const [operationsSection, setOperationsSection] = useState('visits');
  const [visitedOperations,setVisitedOperations]=useState(navigation.view==='operations');
  useEffect(()=>{if(navigation.view==='operations')setVisitedOperations(true);},[navigation.view]);
  const accountsHeading = useRef<HTMLHeadingElement>(null);
  const accountsToggle = useRef<HTMLButtonElement>(null);
  const manageAccounts = can(session, 'users.manage');
  const accessScope = session?.authenticated && can(session, 'access.review')
    ? session.principal.id : '';
  const accountRequests = useAccountRequests(fetcher, accessScope);
  const accountsOpen = manageAccounts && showAccounts;
  const waiting = accountRequests.state.rows?.filter(row => row.state === 'pending').length;
  useEffect(() => {
    if (accountsOpen) accountsHeading.current?.focus();
  }, [accountsOpen]);
  function toggleAccounts() {
    if (accountsOpen) {
      setShowAccounts(false);
      accountsToggle.current?.focus();
    } else {
      setShowAccounts(true);
      void accountRequests.reload();
    }
  }
  const view: 'inquiry' | 'partner' | 'followups' = navigation.view === 'leads' ? 'inquiry' : navigation.view === 'followups' ? 'followups' : 'partner';
  const [dark, setDark] = useState(false);
  useEffect(() => { const frame=requestAnimationFrame(()=>{try {setDark(localStorage.getItem('ech-admin-theme')==='dark');} catch { /* Theme storage is optional. */ }});return()=>cancelAnimationFrame(frame); }, []);
  function toggleTheme() { setDark(value => { try { localStorage.setItem('ech-admin-theme', !value ? 'dark' : 'light'); } catch { /* Theme storage is optional. */ } return !value; }); }
  const [selected, setSelected] = useState<SharedRecord>(); const [creating, setCreating] = useState<string>(); const [addingPartner, setAddingPartner] = useState(false); const [search, setSearch] = useState('');
  const [drafts] = useState(() => new Map<string, RetainedDraft>()); const [inlineOperations,setInlineOperations] = useState(() => new Map<string, Command>()); const [inlineReview, setInlineReview] = useState(false); const inlineBusy = useRef(false);
  const client = useMemo(() => createSessionClient(fetcher), [fetcher]);
  const clearProtected = useCallback(() => { setShowAccounts(false); setInquiries([]); setPartners([]); setAssignees([]); setSelected(undefined); setCreating(undefined); setAddingPartner(false); setCursors({ inquiry: null, partner: null }); setSearch(''); setNotice(''); }, []);
  const invalidate = useCallback(() => { epoch.current += 1; verified.current = null; setSession(null); clearProtected(); setError('Session or record access is unverified. Protected views were cleared. Unsaved record drafts remain in this tab for the same authorized account after reload.'); }, [clearProtected]);
  // Repository constructors retain this callback; only asynchronous request failures invoke it.
  // eslint-disable-next-line react-hooks/refs
  const inquiryRepository = useMemo(() => createSharedRepository('inquiry', fetcher, invalidate), [fetcher, invalidate]);
  // eslint-disable-next-line react-hooks/refs
  const partnerRepository = useMemo(() => createSharedRepository('partner', fetcher, invalidate), [fetcher, invalidate]);
  const refresh = useCallback(async (full = true) => {
    if (refreshing.current) return;
    refreshing.current = true;
    const foreground = full || !verified.current;
    const ticket = ++epoch.current; if (foreground) { setChecking(true); setError(''); }
    try {
      const current = await client.load(); if (ticket !== epoch.current) return;
      const old = verified.current;
      const unchanged = old?.authenticated && current.authenticated && old.principal.id === current.principal.id && JSON.stringify(old.capabilities) === JSON.stringify(current.capabilities);
      if (!unchanged) clearProtected();
      if (current.authenticated && canOperate(current) && (full || !unchanged)) {
        const [inq, par, people] = await Promise.all([inquiryRepository.list(), (async()=>{
          const result=await partnerRepository.list();const seen=new Set(result.items.map(row=>row.id));const cursors=new Set<string>();
          while(result.nextCursor&&result.items.length<1000){if(cursors.has(result.nextCursor))throw new Error('Repeated partner cursor.');cursors.add(result.nextCursor);const page=await partnerRepository.list(result.nextCursor);for(const row of page.items){if(seen.has(row.id))throw new Error('Repeated partner page.');seen.add(row.id);}result.items.push(...page.items);result.nextCursor=page.nextCursor;}
          return result;
        })(), can(current, 'leads.assign') ? inquiryRepository.assignees() : Promise.resolve([])]);
        if (ticket !== epoch.current) return;
        if ([...inq.items,...par.items].some(row => !mayRead(current,row))) throw new Error('Unexpected row scope.');
        setInquiries(inq.items as SharedInquiry[]); setPartners(par.items as SharedPartner[]); setAssignees(people); setCursors({ inquiry: inq.nextCursor, partner: par.nextCursor });
      }
      if (ticket !== epoch.current) return; verified.current = current; lastChecked.current = Date.now(); if (full || !unchanged) setSession(current);
    } catch { if (ticket === epoch.current) invalidate(); }
    finally { refreshing.current = false; if (foreground && (ticket === epoch.current || verified.current === null)) setChecking(false); }
  }, [client, clearProtected, inquiryRepository, partnerRepository, invalidate]);
  useEffect(() => { const initial=requestAnimationFrame(()=>void refresh()); const focus = () => { if (document.visibilityState === 'visible' && Date.now() - lastChecked.current >= 60_000) void refresh(false); }; window.addEventListener('focus', focus); document.addEventListener('visibilitychange', focus); const timer = window.setInterval(focus, 60_000); return () => {cancelAnimationFrame(initial); epoch.current += 1; window.clearInterval(timer); window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', focus); }; }, [refresh]);
  function saved(record: SharedRecord, kind: RecordKind, actor: string) {
    if (!verified.current?.authenticated || verified.current.principal.id !== actor) return;
    if (kind === 'inquiry') setInquiries(rows => [record as SharedInquiry, ...rows.filter(row => row.id !== record.id)]); else setPartners(rows => [record as SharedPartner, ...rows.filter(row => row.id !== record.id)]);
    setSelected(record); setCreating(undefined); setNotice('Saved and confirmed by the server.');
  }
  async function open(kind: RecordKind, id: string) { if (pending) return; const ticket = epoch.current; setPending(true); setError(''); try { const record = await (kind === 'inquiry' ? inquiryRepository : partnerRepository).detail(id); if (ticket === epoch.current && record && mayRead(verified.current,record)) { const destination = kind === 'inquiry' ? 'leads' : navigation.view === 'daily' ? 'daily' : 'partners';
const url = new URL(window.location.href); url.searchParams.set('view', destination); url.searchParams.set('contact',id);
if (url.href !== window.location.href) { window.history.pushState({...window.history.state,echContactReturn:window.location.href},'',url); window.dispatchEvent(new Event('ech-dashboard-navigation')); }
setSelected(record); setCreating(undefined); } } catch { if (ticket === epoch.current) { clearProtected(); setError('Record could not be verified. Reload permitted records before continuing.'); } } finally { setPending(false); } }
  async function more(kind: RecordKind) { if (pending || !cursors[kind]) return; const ticket = epoch.current; setPending(true); try { const page = await (kind === 'inquiry' ? inquiryRepository : partnerRepository).list(cursors[kind]); if (ticket === epoch.current) { if (page.items.some(row => !mayRead(verified.current,row))) { invalidate(); return; } if (kind === 'inquiry') setInquiries(rows => [...rows, ...page.items.filter(item => !rows.some(row => row.id === item.id)) as SharedInquiry[]]); else setPartners(rows => [...rows, ...page.items.filter(item => !rows.some(row => row.id === item.id)) as SharedPartner[]]); setCursors(c => ({ ...c, [kind]: page.nextCursor })); } } catch { if (ticket === epoch.current) { clearProtected(); setError('The next page could not be verified. Reload permitted records.'); } } finally { setPending(false); } }
  async function logout() { invalidate(); setChecking(true); try { await client.logout(); await refresh(); } catch { setError('Protected views were cleared, but server sign-out could not be confirmed. Retry sign-out before leaving this device.'); } finally { setChecking(false); } }
  async function createPartner(input: import('../prospects/model').ManualPartnerInput): Promise<SharedPartner | null> { if (inlineBusy.current || inlineOperations.get(actor)) { setError('A partner operation is retained. Review and retry the exact operation using the recovery controls.'); return null; } inlineBusy.current = true; setError(''); const command: Command = { schema:1, operationId:crypto.randomUUID(), expectedRevision:0, command:{ type:'create', id:input.uuid, fields:{organization:input.organization,category:input.category,geography:input.geography,contactRoute:input.contactRoute,stage:'Not contacted',nextAction:'',nextDate:'',notes:''} } }; setInlineOperations(current=>new Map(current).set(actor,command)); setInlineReview(false); try { const result = await partnerRepository.commit(command); setInlineOperations(current=>{const next=new Map(current);next.delete(actor);return next;}); if (verified.current?.authenticated && verified.current.principal.id === actor) { setPartners(rows => [result.record as SharedPartner,...rows.filter(row => row.id !== result.record.id)]); return result.record as SharedPartner; } return null; } catch { setError('Partner save was not confirmed. Draft and operation identity are retained. Reload and review before retrying.'); return null; } finally { inlineBusy.current=false; } }
  const operating = canOperate(session); const actor = session?.authenticated ? session.principal.id : '';
  useEffect(() => {
    const frame=requestAnimationFrame(()=>{if (!navigation.contact) { setSelected(undefined); setCreating(undefined); return; }
    if (operating) void open(view === 'inquiry' ? 'inquiry' : 'partner', navigation.contact);});
    return()=>cancelAnimationFrame(frame);
    // Record requests are scoped again by the repository and current session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation.contact, navigation.view, operating, actor]);
  useEffect(() => { if (selected?.id) { const frame=requestAnimationFrame(()=>window.scrollTo(0,0)); return()=>cancelAnimationFrame(frame); } }, [selected?.id]);
  function changeView(next: DashboardView) { setShowAccounts(false); setSelected(undefined); setCreating(undefined); setAddingPartner(false); navigation.setView(next); }
  function closeRecord() { setSelected(undefined); setCreating(undefined); navigation.closeContact(); }
  const titles: Record<DashboardView,string> = {daily:'Today',leads:'Care Inquiries',partners:'Referral Partners',followups:'Follow-ups',operations:'Operations',overview:'Overview',assessments:'Assessments'};
  const pageTitle = session?.authenticated ? `${accountsOpen ? 'Accounts' : titles[navigation.view]} | ECH Admin` : 'Team sign-in | Ethical Care at Home';
  useEffect(()=>{document.title=pageTitle;},[pageTitle]);
  const recordView = ['daily','leads','partners','followups'].includes(navigation.view);
  const details = Boolean(navigation.contact || creating);
  return <div className={`app-shell shared-admin named-shell${session?.authenticated ? '' : ' signed-out'}`} data-theme={dark ? 'dark' : 'light'}>
   {session?.authenticated && <a className="skip-link" href="#workspace-content">Skip to workspace</a>}
   {session?.authenticated && <aside className="sidebar">
    <button className="brand" type="button" onClick={() => changeView('overview')}><img className="ech-brand-logo" src={echLogo} alt="Ethical Care at Home" /><span className="brand-workspace">Team workspace</span></button>
    <nav aria-label="Care Intake Hub navigation">{([['daily','calendar-days','Today'],['leads','inbox','Care Inquiries'],['partners','handshake','Referral Partners'],['followups','list-checks','Follow-ups'],['operations','settings-2','Operations'],['overview','layout-dashboard','Overview'],['assessments','clipboard-list','Assessments']] as [DashboardView,IconName,string][]).map(([next,icon,label]) => <div className="named-nav-group" key={next}><button aria-current={!accountsOpen && navigation.view === next ? 'page' : undefined} className={`nav-item ${!accountsOpen && navigation.view === next ? 'active' : ''}`} type="button" onClick={() => changeView(next)} key={next}><Icon name={icon} />{label}{next === 'leads' && operating && <span className="nav-count">{inquiries.length}{cursors.inquiry ? '+' : ''}</span>}</button>{next === 'operations' && navigation.view === 'operations' && !accountsOpen && <div className="named-operations-nav" aria-label="Fictional Operations sections">{namedSections.map(([id,label])=><button key={id} type="button" aria-current={operationsSection === id ? 'page' : undefined} onClick={()=>setOperationsSection(id)}>{label}</button>)}</div>}</div>)}{manageAccounts && <button type="button" className={`nav-item ${accountsOpen ? 'active' : ''}`} aria-current={accountsOpen ? 'page' : undefined} onClick={toggleAccounts}><Icon name="users"/>Accounts</button>}</nav>
    <label className="named-mobile-section">
     Dashboard / Operations
     <select value={accountsOpen ? 'accounts' : navigation.view === 'operations' ? `section:${operationsSection}` : navigation.view}
      onChange={event => {
       const value = event.currentTarget.value;
       const section = namedSections.find(([id]) => value === `section:${id}`);
       if (section) {
        setOperationsSection(section[0]);
        if (accountsOpen || navigation.view !== 'operations') changeView('operations');
       } else if (value === 'accounts' && manageAccounts) {
        toggleAccounts();
       } else if (Object.prototype.hasOwnProperty.call(titles, value)) {
        changeView(value as DashboardView);
       }
      }}>
      <optgroup label="Dashboard">
       {Object.entries(titles).filter(([id]) => id !== 'operations').map(([id, label]) => <option key={id} value={id}>{label}</option>)}
       {manageAccounts && <option value="accounts">Accounts</option>}
      </optgroup>
      <optgroup label="Operations">
       {namedSections.map(([id, label]) => <option key={id} value={`section:${id}`}>{label}</option>)}
      </optgroup>
     </select>
    </label>
    <button className="quick-intake-button" type="button" disabled={!can(session,'leads.create')} onClick={() => { changeView('leads'); setCreating(crypto.randomUUID()); }}><Icon name="plus" />Record new inquiry</button>
    <div className="sidebar-footer">{session?.authenticated && <details className="account-menu"><summary aria-label="My account"><span className="account-avatar" aria-hidden="true">{session.principal.email.slice(0,1).toUpperCase()}</span><span className="account-identity"><strong>My account</strong><small>{session.principal.email}</small></span><span aria-hidden="true">⌃</span></summary><div className="account-actions"><p>Signed in as <strong>{session.principal.email}</strong></p><p className="account-save-note">{navigation.view === 'operations' && !accountsOpen ? 'Fictional Operations changes save on this device for this account only.' : 'Inquiries, referral partners and account changes save to the shared ECH system.'}</p><button type="button" disabled={checking} onClick={() => refresh()}>Refresh account and records</button><button type="button" disabled={checking} onClick={logout}>Sign out</button>{!operating && <p>This account has no operational record access.</p>}</div></details>}<small className="workspace-safety">Contact details only. No clinical notes.</small></div>
   </aside>}
   <main className="main-content" id="workspace-content" tabIndex={-1}>
    <header className={`topbar${manageAccounts ? ' accounts-topbar' : ''}`}><div><p className="eyebrow">Ethical Care at Home</p><h1 ref={accountsHeading} tabIndex={-1}>{session?.authenticated ? accountsOpen ? 'Accounts' : titles[navigation.view] : 'Team sign-in'}</h1></div><div className="topbar-actions" style={{ flexWrap: 'wrap' }}>
    {manageAccounts && <button ref={accountsToggle} className="theme-toggle accounts-toggle" type="button"
     aria-controls="accounts-workspace" aria-expanded={accountsOpen} onClick={toggleAccounts}>
     <Icon name="users" />{accountsOpen ? 'Back to workspace' : 'Accounts'}
     {!accountsOpen && accessScope && <span className="account-count" aria-live="polite">
      {waiting !== undefined ? `${waiting} pending` : accountRequests.state.status === 'unavailable' ? 'Count unavailable' : 'Checking…'}
     </span>}
    </button>}
    <button className="theme-toggle" aria-label={`Switch to ${dark ? 'light' : 'dark'} theme`} type="button" onClick={toggleTheme}><Icon name={dark ? 'sun' : 'moon'} />{dark ? 'Light' : 'Dark'}</button></div></header>
    {session?.authenticated && operating && (accountsOpen || navigation.view !== 'operations') && <p className="named-live-notice">Shared ECH workspace. Inquiries, referral partners and account changes use the existing live system. Fictional examples are confined to Operations.</p>}
    {error && <p role="alert" className="field-error">{error}</p>}{notice && operating && <p role="status">{notice}</p>}{checking && <p role="status">Checking current server access…</p>}
    {!session && !checking && <section className="panel dashboard-card"><p>Account access could not be verified.</p><button type="button" onClick={() => refresh()}>Reload account status</button></section>}
    {session?.authenticated === false && <SignIn session={session} client={client} onVerified={refresh} />}

    {session?.authenticated && manageAccounts && <div id="accounts-workspace" hidden={!accountsOpen}>
     <AdminTools key={actor + ':' + can(session, 'backup.export') + ':' + accessScope} session={session}
      onChanged={() => refresh()} requests={accountRequests.state} reloadRequests={accountRequests.reload}
      fetcher={fetcher} visible={accountsOpen} />
    </div>}
    <div hidden={accountsOpen}>
    {session?.authenticated && operating && <>
     {navigation.view === 'overview' && <section className="hero-card"><div><p className="eyebrow">Your shared workspace</p><h2>Keep every next step clear.</h2><p>Review incoming care inquiries, maintain referral relationships and follow up with the right person.</p><div className="hero-actions"><button className="primary-button" type="button" onClick={() => changeView('leads')}>Review care inquiries</button><button className="secondary-button" type="button" onClick={() => changeView('partners')}>View referral partners</button></div></div><div className="flow"><span><b>1</b>Receive</span><i>→</i><span><b>2</b>Follow up</span><i>→</i><span><b>3</b>Record next step</span></div></section>}
     {navigation.view === 'daily' && !details && <section className="day-brief" aria-label="Today at ECH"><div><p className="eyebrow">Your daily workspace</p><h2>Your day, in focus.</h2><p>Keep conversations moving and make the next step clear.</p></div><div className="day-date"><Icon name="calendar-days" /><span><strong>{new Intl.DateTimeFormat('en-CA',{weekday:'long',month:'long',day:'numeric',timeZone:'UTC'}).format(new Date(companyDate()+'T12:00:00Z'))}</strong><small>Vancouver calendar day</small></span></div></section>}
     {['daily','overview'].includes(navigation.view) && !details && <section className="metrics" aria-label="Shared record counts"><article className="metric-card"><span className="metric-icon blue"><Icon name="inbox" /></span><div><strong>{inquiries.length}{cursors.inquiry ? '+' : ''}</strong><span>Care Inquiries</span></div></article><article className="metric-card"><span className="metric-icon green"><Icon name="handshake" /></span><div><strong>{partners.length}{cursors.partner ? '+' : ''}</strong><span>Referral Partners</span></div></article><article className="metric-card"><span className="metric-icon coral"><Icon name="list-checks" /></span><div><strong>{inquiries.filter(r => r.status !== 'Closed' && r.followUpAt).length}</strong><span>Scheduled inquiry follow-ups</span></div></article><article className="metric-card"><span className="metric-icon violet"><Icon name="users" /></span><div><strong>{partners.filter(r => !r.ownerId).length}</strong><span>Unassigned referral partners</span></div></article></section>}
     <div hidden={navigation.view !== 'operations'}>{visitedOperations && (localOperations || <NamedOperations actor={actor} section={operationsSection} />)}</div>
     {navigation.view === 'assessments' && <section className="panel dashboard-card"><h2>Assessments</h2><p>Assessment recording is disabled for this first release. Clinical information must stay in the approved care-record system.</p><button type="button" disabled>Record assessment</button></section>}
     {recordView && <>
      {(selected || creating) && view !== 'followups' && <><nav className="prospect-breadcrumb" aria-label="Contact breadcrumb"><button type="button" onClick={closeRecord}><span aria-hidden="true">←</span> {titles[navigation.view]}</button><span className="breadcrumb-context">{view === 'inquiry' ? 'Inquiry details' : 'Partner details'}</span></nav><RecordEditor key={`${actor}:${view}:${selected?.id || creating}`} kind={view} record={selected} createId={creating || selected!.id} session={session} assignees={assignees} partners={partners} partnerRepository={partnerRepository} onPartnerSaved={row => { if (verified.current?.authenticated && verified.current.principal.id===actor && mayRead(verified.current,row)) setPartners(rows => [row,...rows.filter(item => item.id!==row.id)]); }} onCreatePartner={createPartner} repository={view === 'inquiry' ? inquiryRepository : partnerRepository} drafts={drafts} onSaved={record => saved(record, view, actor)} onClose={closeRecord} onReload={async () => { const record=await (view === 'inquiry' ? inquiryRepository : partnerRepository).detail(selected?.id || creating!); if(record)setSelected(record);return record || undefined; }} /></>}
      {view === 'followups' && <FollowUpQueue shared canEnumerateOwners={can(session,'leads.assign')} leads={inquiries.map(row => inquiryForQueue(row,assignees,actor))} onLeadClick={lead => open('inquiry',lead.id)} />}
      {view === 'partner' && <div hidden={details}>
       <ReferralPartners shared={{ records:partners,assignees,onOpen:record => open('partner',record.id),pending }} />
       {can(session,'leads.create') && <button type="button" disabled={pending} onClick={() => setAddingPartner(true)}>Add referral partner</button>}
       {addingPartner && <InlinePartnerAdd shared={{records:partners,canCreate:can(session,'leads.create'),onClose:()=>setAddingPartner(false),onSelect:partner=>{setAddingPartner(false);void open('partner',partner.id);},onCreate:createPartner}} />}
       {inlineOperations.get(actor) && <section role="status"><p>Retained partner operation: <code>{inlineOperations.get(actor)!.operationId}</code>. The original payload remains unchanged.</p><button type="button" disabled={pending} onClick={async () => { const operation=inlineOperations.get(actor); if (!operation) return; setPending(true); try { const row=await partnerRepository.detail(operation.command.id); if (row) { setPartners(rows => [row as SharedPartner,...rows.filter(item => item.id!==row.id)]); setNotice('Server record found. Review it before deciding whether to retry the original operation.'); } else setNotice('No record returned for this session. Outcome remains unknown; retry uses the exact original operation only.'); setInlineReview(true); } catch { setInlineReview(false); setError('Server state could not be checked. The operation remains retained.'); } finally { setPending(false); } }}>Inspect current partner state</button><button type="button" disabled={!inlineReview || pending} onClick={async () => { const operation=inlineOperations.get(actor); if (!operation) return; setPending(true); try { const result=await partnerRepository.commit(operation); if (verified.current?.authenticated && verified.current.principal.id===actor) { setPartners(rows => [result.record as SharedPartner,...rows.filter(row => row.id!==result.record.id)]); setInlineOperations(current=>{const next=new Map(current);next.delete(actor);return next;}); setInlineReview(false); setAddingPartner(false); setNotice('Original partner save confirmed by the server.'); } } catch { setInlineReview(false); setError('The retained operation was not confirmed. Inspect server state before another exact retry.'); } finally { setPending(false); } }}>Retry exact original partner save</button></section>}
       {cursors.partner && <button type="button" disabled={pending} onClick={() => more('partner')}>Load more referral partners</button>}
      </div>}
      {view === 'inquiry' && <section className="panel dashboard-card" hidden={details}><div className="prospect-list-head"><h2>Care Inquiries</h2>{can(session,'leads.create') && <button type="button" onClick={() => {setCreating(crypto.randomUUID());setSelected(undefined);}}>Record new inquiry</button>}</div><label><span>Search care inquiries</span><input aria-label="Search care inquiries" value={search} onChange={event => setSearch(event.target.value)} placeholder="Name, contact route or requested help" /></label><p>{inquiries.length} care inquiries loaded{cursors.inquiry ? '; more available' : ''}.</p>{inquiries.filter(row => !search || [row.name,row.phone,row.email,row.careRecipient,row.need,row.source].some(value=>value.toLowerCase().includes(search.toLowerCase()))).map(row=><button key={row.id} type="button" className="task-row" disabled={pending} onClick={()=>open('inquiry',row.id)}><span><strong>{row.name}</strong><small>{row.need} · {row.status}</small><em>{row.next}</em></span></button>)}{!inquiries.length && <p>No care inquiries returned for this account.</p>}{cursors.inquiry && <button type="button" disabled={pending} onClick={()=>more('inquiry')}>Load more care inquiries</button>}</section>}
     </>}
    </>}
    </div>
   </main>
  </div>;
}
