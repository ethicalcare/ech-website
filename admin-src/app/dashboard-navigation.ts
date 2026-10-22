'use client';

import { useSyncExternalStore } from 'react';

const views = ['daily', 'operations', 'overview', 'leads', 'partners', 'followups', 'assessments'] as const;
export type DashboardView = typeof views[number];
const navigationEvent = 'ech-dashboard-navigation';

function subscribe(update: () => void) {
  window.addEventListener('popstate', update);
  window.addEventListener(navigationEvent, update);
  return () => {
    window.removeEventListener('popstate', update);
    window.removeEventListener(navigationEvent, update);
  };
}

function read(search: string) {
  const params = new URLSearchParams(search);
  const requested = params.get('view');
  const view: DashboardView = views.includes(requested as DashboardView) ? requested as DashboardView : 'daily';
  const contact = view === 'daily' || view === 'partners' || view === 'leads' ? params.get('contact') : null;
  return { view, contact };
}

function navigate(view: DashboardView, contact: string | null, replace = false) {
  const url = new URL(window.location.href);
  url.searchParams.set('view', view);
  if (contact) url.searchParams.set('contact', contact);
  else url.searchParams.delete('contact');
  if (url.href === window.location.href) return;
  const state = {
    ...window.history.state,
    echContactReturn: contact ? window.location.href : null,
  };
  if (replace) window.history.replaceState(state, '', url);
  else window.history.pushState(state, '', url);
  window.dispatchEvent(new Event(navigationEvent));
}

export function useDashboardNavigation() {
  const search = useSyncExternalStore(subscribe, () => window.location.search, () => '');
  const { view, contact } = read(search);
  return {
    view,
    contact,
    setView: (next: DashboardView) => navigate(next, null),
    openContact: (id: string) => navigate(view, id),
    clearContact: () => navigate(view, null, true),
    closeContact: () => {
      const previous = window.history.state?.echContactReturn;
      if (typeof previous === 'string') {
        const url = new URL(previous, window.location.href);
        const prior = read(url.search);
        if (url.origin === window.location.origin && url.pathname === window.location.pathname && prior.view === view && !prior.contact) {
          window.history.back();
          return;
        }
      }
      navigate(view, null, true);
    },
  };
}
