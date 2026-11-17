// Report times are entered in Vancouver civil time and stored as UTC instants.
// Keep the same post-2026 offset as the shared calendar, even when a device has
// an older time-zone database. Earlier ambiguous clock-change times fail closed.
const permanentPacific = Date.parse('2026-03-08T10:00:00.000Z');
const formatter = new Intl.DateTimeFormat('sv-SE', {timeZone:'America/Vancouver', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23'});

export function reportLocalTime(instant: string): string {
  const date = new Date(instant);
  if (!Number.isFinite(date.getTime())) throw new RangeError('Enter a valid visit time.');
  if (date.getTime() >= permanentPacific) return new Date(date.getTime() - 7 * 3600000).toISOString().slice(0, -1);
  return formatter.format(date).replace(' ', 'T') + '.' + String(date.getUTCMilliseconds()).padStart(3, '0');
}

export function reportUtcTime(local: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(local)) throw new RangeError('Enter a valid Vancouver date and time.');
  const normalized = local.length === 16 ? local + ':00.000' : local.length === 19 ? local + '.000' : local.replace(/\.(\d{1,3})$/, (_, digits: string) => '.' + digits.padEnd(3, '0'));
  const anchor = Date.parse(normalized + 'Z');
  if (!Number.isFinite(anchor) || new Date(anchor).toISOString().slice(0, -1) !== normalized) throw new RangeError('Enter a valid Vancouver date and time.');
  const candidates = [7, 8].map(hours => new Date(anchor + hours * 3600000).toISOString()).filter(value => reportLocalTime(value) === normalized);
  if (candidates.length !== 1) throw new RangeError(candidates.length ? 'This Vancouver time occurs twice when clocks change. Choose a time outside the repeated hour.' : 'This Vancouver time does not exist. Check the date and clock change.');
  return candidates[0];
}
