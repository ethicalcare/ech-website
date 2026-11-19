import { useEffect, useRef, useState } from 'react';
import { namedSections, type DashboardView, type OperationsSection } from '../dashboard-navigation';
import './mobile-navigation.css';

type Props = {
  view: DashboardView; section: OperationsSection; accountsOpen: boolean;
  sharedSchedule: boolean; manageAccounts: boolean; staffProfilesLabel?: string | null; staffOnly?: boolean;
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
  function close() { dialog.current?.close(); setOpen(false); trigger.current?.focus(); }
  useEffect(() => {
    const dismiss = () => { dialog.current?.close(); setOpen(false); };
    const wide = window.matchMedia?.('(min-width: 701px)');
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
  return <div className="mobile-navigation">
    <button ref={trigger} type="button" className="mobile-navigation-trigger" aria-haspopup="dialog" aria-expanded={open} aria-controls="mobile-workspace-menu"
      onClick={() => { if (!dialog.current?.open) { dialog.current?.showModal(); setOpen(true); } }}>
      <span aria-hidden="true">☰</span><span>Menu</span><small>{current}</small>
    </button>
    <dialog ref={dialog} id="mobile-workspace-menu" className="mobile-navigation-drawer" aria-labelledby="mobile-navigation-title"
      onClose={() => setOpen(false)} onCancel={() => setOpen(false)}
      onClick={event => { if (event.target === event.currentTarget) { const bounds=event.currentTarget.getBoundingClientRect(); if(event.clientX>bounds.right||event.clientX<bounds.left||event.clientY<bounds.top||event.clientY>bounds.bottom) close(); } }}
      onTouchStart={event => { const touch=event.touches[0]; start.current=event.touches.length===1?{x:touch.clientX,y:touch.clientY}:null; }}
      onTouchEnd={event => { const touch=event.changedTouches[0]; const origin=start.current; start.current=null; if(origin&&touch&&origin.x-touch.clientX>80&&Math.abs(origin.y-touch.clientY)<40) close(); }}>
      <header><h2 id="mobile-navigation-title">Workspace menu</h2><button type="button" autoFocus onClick={close} aria-label="Close menu">×</button></header>
      <nav aria-label="Mobile workspace navigation">
        <h3>Dashboard</h3>
        {Object.entries(props.titles).filter(([id])=>props.staffOnly?id==='daily':id!=='operations'&&id!=='staff-profiles').map(([id,label])=><button type="button" key={id} aria-current={!props.accountsOpen&&props.view===id?'page':undefined} onClick={()=>{close();props.onNavigate(id as DashboardView);}}>{label}</button>)}
        {(props.staffProfilesLabel||props.manageAccounts)&&<section aria-label="Teams & Settings">
          <h3>Teams &amp; Settings</h3>
          {props.staffProfilesLabel&&<button type="button" aria-current={!props.accountsOpen&&props.view==='staff-profiles'?'page':undefined}
            onClick={()=>{close();props.onNavigate('staff-profiles');}}>{props.staffProfilesLabel}</button>}
          {props.manageAccounts&&<button type="button" aria-current={props.accountsOpen?'page':undefined}
            onClick={()=>{close();if(!props.accountsOpen)props.onAccounts();}}>Accounts</button>}
        </section>}
        {!props.staffOnly&&<><h3>Operations</h3>
        {(props.sharedSchedule?namedSections.slice(0,1):namedSections).map(([id,label])=><button type="button" key={id} aria-current={!props.accountsOpen&&props.view==='operations'&&(props.sharedSchedule?'visits':props.section)===id?'page':undefined} onClick={()=>{close();props.onNavigate('operations',id);}}>{label}</button>)}</>}
      </nav>
    </dialog>
  </div>;
}
