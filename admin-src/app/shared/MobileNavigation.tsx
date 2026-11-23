'use client';

import { useEffect, useRef, useState } from 'react';
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
};

/** Native modal semantics keep the background inert and contain keyboard focus. */
export function MobileNavigation(props: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const start = useRef<{x: number; y: number} | null>(null);
  const [open, setOpen] = useState(false);
  const managerMode = props.managerMode === true;
  const scheduleCurrent = !props.accountsOpen && props.view === 'operations' && (props.sharedSchedule || props.section === 'visits');
  const moreCurrent = props.accountsOpen || (props.view !== 'daily' && !scheduleCurrent);

  function close() { dialog.current?.close(); setOpen(false); trigger.current?.focus(); }
  function openMenu() { if (!dialog.current?.open) { dialog.current?.showModal(); setOpen(true); } }
  function navigate(view: DashboardView, section?: OperationsSection) { if (dialog.current?.open) close(); if (section) props.onNavigate(view, section); else props.onNavigate(view); }
  function createInquiry() { if (props.canCreateInquiry) props.onCreateInquiry?.(); }

  useEffect(() => {
    const wide = window.matchMedia?.('(min-width: 701px)');
    const dismiss = () => {
      if (!dialog.current?.open) return;
      dialog.current.close(); setOpen(false);
      if (wide?.matches) document.getElementById('workspace-content')?.focus();
      else trigger.current?.focus();
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
      <nav className="mobile-tabbar" aria-label="Primary navigation">
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
        <button ref={trigger} type="button" aria-current={moreCurrent ? 'page' : undefined} aria-haspopup="dialog" aria-expanded={open} aria-controls="mobile-workspace-menu" onClick={openMenu}>
          <Icon name="more-horizontal" /><span>More</span>
        </button>
      </nav>
      <button type="button" className="mobile-add-button" aria-label={props.staffNavigation ? 'No standalone create action available' : 'Record new inquiry'} title={props.staffNavigation ? 'Select an assigned visit to report' : 'Record new inquiry'} disabled={props.staffNavigation || props.mobileBlocked || !props.canCreateInquiry} onClick={createInquiry}>
        <Icon name="plus" />
      </button>
      {managerMode && <button type="button" className="desktop-add-button" aria-label="Record new inquiry" title="Record new inquiry" disabled={!props.canCreateInquiry} onClick={createInquiry}>
        <Icon name="plus" />
      </button>}
      {!managerMode && <button type="button" className="mobile-navigation-trigger" aria-haspopup="dialog" aria-expanded={open} aria-controls="mobile-workspace-menu" onClick={openMenu}>
        <span aria-hidden="true">☰</span><span>Menu</span><small>{current}</small>
      </button>}
    </>
    <dialog ref={dialog} id="mobile-workspace-menu" className="mobile-navigation-drawer" aria-labelledby="mobile-navigation-title"
      onClose={() => setOpen(false)} onCancel={() => setOpen(false)}
      onClick={event => { if (event.target === event.currentTarget) { const bounds=event.currentTarget.getBoundingClientRect(); if(event.clientX>bounds.right||event.clientX<bounds.left||event.clientY<bounds.top||event.clientY>bounds.bottom) close(); } }}
      onTouchStart={event => { const touch=event.touches[0]; start.current=event.touches.length===1?{x:touch.clientX,y:touch.clientY}:null; }}
      onTouchEnd={event => { const touch=event.changedTouches[0]; const origin=start.current; start.current=null; if(origin&&touch&&origin.x-touch.clientX>80&&Math.abs(origin.y-touch.clientY)<40) close(); }}>
      <header><h2 id="mobile-navigation-title">Workspace menu</h2><button type="button" autoFocus onClick={close} aria-label="Close menu">×</button></header>
      <nav aria-label="Mobile workspace navigation">
        <h3>Dashboard</h3>
        {Object.entries(props.titles).filter(([id])=>props.staffOnly?id==='daily':id!=='operations'&&id!=='staff-profiles').map(([id,label])=><button type="button" key={id} aria-current={!props.accountsOpen&&props.view===id?'page':undefined} onClick={()=>navigate(id as DashboardView)}>{label}</button>)}
        {(props.staffProfilesLabel||props.manageAccounts)&&<section aria-label="Teams & Settings">
          <h3>Teams &amp; Settings</h3>
          {props.staffProfilesLabel&&<button type="button" aria-current={!props.accountsOpen&&props.view==='staff-profiles'?'page':undefined}
            onClick={()=>navigate('staff-profiles')}>{props.staffProfilesLabel}</button>}
          {props.manageAccounts&&<button type="button" aria-current={props.accountsOpen?'page':undefined}
            onClick={()=>{close();if(!props.accountsOpen)props.onAccounts();}}>Accounts</button>}
        </section>}
        {!props.staffOnly&&<><h3>Operations</h3>
        {(props.sharedSchedule?namedSections.slice(0,1):namedSections).map(([id,label])=><button type="button" key={id} aria-current={!props.accountsOpen&&props.view==='operations'&&(props.sharedSchedule?'visits':props.section)===id?'page':undefined} onClick={()=>navigate('operations',id)}>{label}</button>)}</>}
      </nav>
    </dialog>
  </div>;
}
