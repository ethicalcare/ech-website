// A visibility return refreshes only the open account panel after its interval.
export function shouldRefreshVisibleAccounts(panelOpen, visibility, now, lastChecked) {
  return panelOpen === true && visibility === 'visible' && now - lastChecked >= 60_000;
}
