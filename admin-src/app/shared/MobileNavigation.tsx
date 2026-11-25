'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { namedSections, type DashboardView, type OperationsSection } from '../dashboard-navigation';
import { Icon } from './Icon';
import './mobile-navigation.css';

type Props = {
  view: DashboardView; section: OperationsSection; accountsOpen: boolean;
  sharedSchedule: boolean; manageAccounts: boolean; staffProfilesLabel?: string | null; staffOnly?: boolean;
  managerMode?: boolean; canCreateInquiry?: boolean; mobileBlocked?: boolean; onCreateInquiry?: () => void;
  canOperate?: boolean; onStaffSchedule?: () => void; staffNavigation?: boolean; staffScheduleAvailable?: boolean; staffLocation?: 'home'|'schedule';
  titles: Record<DashboardView, string>;
  onNavigate: (view: DashboardView, section?: OperationsSection) => void;
  onAccounts: () => void;
  accountContent?: ReactNode;
};

/** Native modal semantics keep the background inert and contain keyboard focus. */
export function MobileNavigation(props: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const addDialog = useRef<HTMLDialogElement>(null);
  const addTrigger = useRef<HTMLButtonElement>(null);
  const [addOpen, setAddOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLButtonElement|null>(null);
  const start = useRef<{x: number; y: number} | null>(null);
  const [open, setOpen] = useState(false);
  const managerMode = props.managerMode === true;
  const scheduleCurrent = !props.accountsOpen && props.view === 'operations' && (props.sharedSchedule || props.section === 'visits');
  const moreCurrent = props.accountsOpen || (props.view !== 'daily' && !scheduleCurrent);

  function close() { dialog.current?.close(); setOpen(false); opener.current?.focus(); }
  function openMenu(event?: React.MouseEvent<HTMLButtonElement>) { if (!dialog.current?.open) { opener.current=event?.currentTarget??trigger.current; dialog.current?.showModal(); setOpen(true); } }
  function navigate(view: DashboardView, section?: OperationsSection) { if (dialog.current?.open) close(); if (section) props.onNavigate(view, section); else props.onNavigate(view); }
  function createInquiry() { if (props.canCreateInquiry) props.onCreateInquiry?.(); }
  const canAdd = !props.staffNavigation && !props.mobileBlocked && props.canCreateInquiry === true;
  function closeAdd(restore = true) { if (addDialog.current?.open) addDialog.current.close(); setAddOpen(false); if (restore) { if (!addTrigger.current?.disabled) addTrigger.current?.focus(); else document.getElementById('workspace-content')?.focus(); } }
  function openAdd() { if (canAdd && !addDialog.current?.open) { addDialog.current?.showModal(); setAddOpen(true); } }
  function selectInquiry() { if (!canAdd) return; closeAdd(false); document.getElementById('workspace-content')?.focus(); createInquiry(); }
  useEffect(() => { if (addOpen && !canAdd) closeAdd(); }, [addOpen, canAdd]);

  useEffect(() => {
    const wide = window.matchMedia?.('(min-width: 701px)');
    const dismiss = () => {
      if (addDialog.current?.open) { addDialog.current.close(); setAddOpen(false); if (wide?.matches) document.getElementById('workspace-content')?.focus(); else addTrigger.current?.focus(); }
      if (!dialog.current?.open) return;
      dialog.current.close(); setOpen(false);
      if (wide?.matches) document.getElementById('workspace-content')?.focus();
      else opener.current?.focus();
    };
    const resize = () => { if (wide?.matches) dismiss(); };
    window.addEventListener('popstate', dismiss);
    wide?.addEventListener('change', resize);
    return () => { window.removeEventListener('popstate', dismiss); wide?.removeEventListener('change', resize); };
  }, []);
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [open]);
  const current = props.accountsOpen ? 'Accounts' : props.view === 'operations'
    ? namedSections.find(([id]) => id === (props.sharedSchedule ? 'visits' : props.section))?.[1] : props.titles[props.view];

  return <div className={`mobile-navigation${managerMode ? ' mobile-navigation--manager' : ''}`}>
    <>
      <nav className={`mobile-tabbar${props.staffNavigation ? ' mobile-tabbar--staff' : ''}`} aria-label="Primary navigation">
        <button type="button" aria-current={!props.accountsOpen && props.view === 'daily' && (!props.staffNavigation || props.staffLocation!=='schedule') ? 'page' : undefined} onClick={() => navigate('daily')}>
          <Icon name="calendar-days" /><span>{props.staffNavigation ? 'Home' : 'Today'}</span>
        </button>
        {props.staffNavigation ? <button type="button" aria-current={!props.accountsOpen && props.view==='daily' && props.staffLocation==='schedule' ? 'page' : undefined} disabled={!props.staffScheduleAvailable} onClick={props.onStaffSchedule}>
          <Icon name="clock-3" /><span>Schedule</span>
        </button> : props.canOperate ? <button type="button" aria-current={scheduleCurrent ? 'page' : undefined} onClick={() => navigate('operations', 'visits')}>
          <Icon name="clock-3" /><span>Schedule</span>
        </button> : <span aria-hidden="true" />}
        <span className="mobile-tabbar-spacer" aria-hidden="true" />
        {props.staffNavigation || props.canOperate ? <button type="button" className="mobile-tab-reports" disabled aria-label="Reports, unavailable" title="A reports list is not available">
          <Icon name="clipboard-list" /><span>Reports</span><small>{props.staffNavigation ? 'Unavailable' : 'Proposed'}</small>
        </button> : <span aria-hidden="true" />}
        {!props.staffNavigation && <button ref={trigger} type="button" aria-current={moreCurrent ? 'page' : undefined} aria-haspopup="dialog" aria-expanded={open} aria-controls="mobile-workspace-menu" onClick={openMenu}>
          <Icon name="more-horizontal" /><span>More</span>
        </button>}
      </nav>
      <button ref={addTrigger} type="button" className="mobile-add-button" aria-label={props.staffNavigation ? 'No standalone create action available' : 'Add'} title={props.staffNavigation ? 'Select an assigned visit to report' : 'Add'} aria-haspopup="dialog" aria-expanded={addOpen} aria-controls="mobile-add-menu" disabled={!canAdd} onClick={openAdd}>
        <Icon name="plus" />
      </button>
      <dialog ref={addDialog} id="mobile-add-menu" className="mobile-add-dialog" aria-labelledby="mobile-add-title" onClose={() => setAddOpen(false)} onCancel={event => { event.preventDefault(); closeAdd(); }} onClick={event => { if (event.target === event.currentTarget) closeAdd(); }}>
        <header><h2 id="mobile-add-title">Add</h2><button type="button" aria-label="Close Add menu" onClick={() => closeAdd()}>×</button></header>
        <button type="button" autoFocus disabled={!canAdd} onClick={selectInquiry}>Record New Inquiry</button>
      </dialog>
      {managerMode && <button type="button" className="desktop-add-button" aria-label="Record new inquiry" title="Record new inquiry" disabled={!props.canCreateInquiry} onClick={createInquiry}>
        <Icon name="plus" />
      </button>}
      <button type="button" className="mobile-navigation-trigger" aria-label="Open workspace menu" aria-haspopup="dialog" aria-expanded={open} aria-controls="mobile-workspace-menu" onClick={openMenu}>
        <span aria-hidden="true">☰</span>
      </button>
    </>
    <dialog ref={dialog} id="mobile-workspace-menu" className="mobile-navigation-drawer" aria-labelledby="mobile-navigation-title"
      onClose={() => setOpen(false)} onCancel={() => setOpen(false)}
      onClick={event => { if (event.target === event.currentTarget) { const bounds=event.currentTarget.getBoundingClientRect(); if(event.clientX>bounds.right||event.clientX<bounds.left||event.clientY<bounds.top||event.clientY>bounds.bottom) close(); } }}
      onTouchStart={event => { const touch=event.touches[0]; start.current=event.touches.length===1?{x:touch.clientX,y:touch.clientY}:null; }}
      onTouchEnd={event => { const touch=event.changedTouches[0]; const origin=start.current; start.current=null; if(origin&&touch&&origin.x-touch.clientX>80&&Math.abs(origin.y-touch.clientY)<40) close(); }}>
      <header><h2 id="mobile-navigation-title">Workspace menu</h2><button type="button" autoFocus onClick={close} aria-label="Close menu">×</button></header>
      {props.accountContent}
      <nav aria-label="Mobile workspace navigation">
        <h3>Dashboard</h3>
        {Object.entries(props.titles).filter(([id])=>props.staffOnly?id==='daily':id!=='operations'&&id!=='staff-profiles').map(([id,label])=><button type="button" key={id} aria-current={!props.accountsOpen&&props.view===id?'page':undefined} onClick={()=>navigate(id as DashboardView)}>{label}</button>)}
        {(props.staffProfilesLabel||props.manageAccounts)&&<section aria-label="Teams & Settings">
          <h3>Teams &amp; Settings</h3>
          {props.staffProfilesLabel&&<button type="button" aria-current={!props.accountsOpen&&props.view==='staff-profiles'?'page':undefined}
            onClick={()=>navigate('staff-profiles')}>{props.staffProfilesLabel}</button>}
          {props.manageAccounts&&<button type="button" aria-current={props.accountsOpen?'page':undefined}
            onClick={()=>{close();props.onAccounts();}}>Accounts</button>}
        </section>}
        {!props.staffOnly&&<><h3>Operations</h3>
        {(props.sharedSchedule?namedSections.slice(0,1):namedSections).map(([id,label])=><button type="button" key={id} aria-current={!props.accountsOpen&&props.view==='operations'&&(props.sharedSchedule?'visits':props.section)===id?'page':undefined} onClick={()=>navigate('operations',id)}>{label}</button>)}</>}
      </nav>
    </dialog>
  </div>;
}
