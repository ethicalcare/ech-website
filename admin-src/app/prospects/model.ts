export type SpreadsheetSource = { origin?: 'spreadsheet'; spreadsheetId: string; tab: string; sheetId: number; row: number; researchDate: string; readAt: string; values: (string | null)[] };
export type ManualPartnerSource = { origin: 'manual'; uuid: string; createdAt: string; createdBy: string };
export type ProspectSource = SpreadsheetSource | ManualPartnerSource;
export type PartnerMethod = { id: string; kind: 'phone' | 'email'; value: string; label: string };
export type PartnerPerson = { id: string; name: string; role: string; methods: PartnerMethod[] };
export type CallAttempt = { id: string; date: string; owner: string; outcome: string; note: string; madeContact: boolean; savedAt: string; channel?: 'Call' | 'Meeting' | 'Appointment' | 'Other touchpoint' };
export type ProspectActivity = { id: string; at: string; author: string; kind: 'edit' | 'note' | 'call'; note: string; changes: { field: string; before: string; after: string }[]; call?: CallAttempt; operation?: string };
export type Prospect = { id: string; organization: string; category: string; geography: string; contactRoute: string; openingAsk: string; stage: string; owner: string; materials: string; lastTouch: string; nextAction: string; nextDate: string; notes: string; sprint: string; callScript: string; contacted: boolean; activities: ProspectActivity[]; source: ProspectSource; people?: PartnerPerson[] };
export type TeamGoal = { id: string; title: string; owner: string; deadline: string; target: number; completed: number; activities: { id: string; at: string; author: string; note: string; summary: string }[] };
export type ProspectData = { schema: 1; revision: number; kind: 'synthetic' | 'public-business'; records: Prospect[]; goals: TeamGoal[] };
export const PROSPECT_KEY = 'ech-leads-contacts-local:v1';
export class ProspectError extends Error { constructor(message: string) { super(message); this.name = 'ProspectError'; } }
function assert(value: unknown, message: string): asserts value { if (!value) throw new ProspectError(message); }
const draftFields = ['owner', 'stage', 'materials', 'nextAction', 'nextDate', 'callScript', 'contacted', 'notes'] as const;
export type ProspectDraft = Pick<Prospect, typeof draftFields[number]>;
export type ProspectEditor = { base: ProspectDraft; draft: ProspectDraft; conflicts: Partial<Record<keyof ProspectDraft, { saved: string | boolean }>> };
export function createProspectEditor(p: ProspectDraft): ProspectEditor {
 const draft = Object.fromEntries(draftFields.map(field => [field, p[field]])) as ProspectDraft;
 return { base: { ...draft }, draft, conflicts: {} };
}
export function rebaseProspectEditor(editor: ProspectEditor, saved: ProspectDraft): ProspectEditor {
 const base = createProspectEditor(saved).base; const conflicts: ProspectEditor['conflicts'] = {};
 const draft = Object.fromEntries(draftFields.map(field => {
  const dirty = editor.draft[field] !== editor.base[field];
  if (editor.draft[field] !== base[field] && (editor.conflicts[field] || dirty && base[field] !== editor.base[field])) conflicts[field] = { saved: base[field] };
  return [field, dirty || editor.conflicts[field] ? editor.draft[field] : base[field]];
 })) as ProspectDraft;
 return { base, draft, conflicts };
}
export function resolveProspectConflict(editor: ProspectEditor, field: keyof ProspectDraft, choice: 'saved' | 'mine'): ProspectEditor {
 assert(editor.conflicts[field], 'This field has no unresolved conflict.');
 const conflicts = { ...editor.conflicts }; delete conflicts[field];
 return { ...editor, draft: choice === 'saved' ? { ...editor.draft, [field]: editor.base[field] } : editor.draft, conflicts };
}
export function prospectEditorPatch(editor: ProspectEditor): Partial<ProspectDraft> {
 assert(!Object.keys(editor.conflicts).length, 'Resolve competing contact edits before saving.');
 return Object.fromEntries(draftFields.filter(field => editor.draft[field] !== editor.base[field]).map(field => [field, editor.draft[field]]));
}
export function validDate(s: string) { return s === '' || /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(new Date(s + 'T12:00:00Z').getTime()) && new Date(s + 'T12:00:00Z').toISOString().slice(0, 10) === s; }
export function sourceId(s: ProspectSource) { return s.origin === 'manual' ? `manual:${s.uuid}` : `${s.spreadsheetId}:${s.sheetId}:${s.row}`; }
const uuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
function validPerson(person: PartnerPerson) {
 return person && typeof person.id === 'string' && uuid(person.id) && typeof person.name === 'string' && person.name.trim() && person.name.length <= 160 && typeof person.role === 'string' && person.role.length <= 160 && Array.isArray(person.methods) && person.methods.length <= 20 && person.methods.every(method => method && typeof method.id === 'string' && uuid(method.id) && ['phone','email'].includes(method.kind) && typeof method.value === 'string' && method.value.trim() && method.value.length <= 300 && (method.kind !== 'email' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(method.value)) && typeof method.label === 'string' && method.label.length <= 160) && new Set(person.methods.map(method => method.id)).size === person.methods.length;
}
const fields = ['id', 'organization', 'category', 'geography', 'contactRoute', 'openingAsk', 'stage', 'owner', 'materials', 'lastTouch', 'nextAction', 'nextDate', 'notes', 'sprint', 'callScript'] as const;
export function parseProspects(raw: string): ProspectData {
 let value: unknown; try { value = JSON.parse(raw); } catch { throw new ProspectError('Leads backup is not valid JSON. Existing records were not changed.'); }
 assert(value && typeof value === 'object', 'Invalid Leads backup.'); const d = value as ProspectData;
 assert(d.schema === 1 && Number.isSafeInteger(d.revision) && d.revision >= 0 && ['synthetic', 'public-business'].includes(d.kind) && Array.isArray(d.records) && d.records.length <= 2000, 'Unsupported Leads backup version.');
 for (const p of d.records) {
  assert(p && fields.every(k => typeof p[k] === 'string' && p[k].length <= 12000) && p.organization.trim() && p.stage.trim() && typeof p.contacted === 'boolean' && validDate(p.lastTouch) && validDate(p.nextDate), 'Invalid Leads fields or dates.');
  const s = p.source;
  assert(s && (s.origin === 'manual' ? typeof s.uuid === 'string' && uuid(s.uuid) && typeof s.createdAt === 'string' && Number.isFinite(new Date(s.createdAt).getTime()) && typeof s.createdBy === 'string' && s.createdBy.trim() : (s.origin === undefined || s.origin === 'spreadsheet') && typeof s.spreadsheetId === 'string' && s.spreadsheetId && typeof s.tab === 'string' && s.tab && Number.isSafeInteger(s.sheetId) && Number.isSafeInteger(s.row) && s.row > 0 && typeof s.researchDate === 'string' && typeof s.readAt === 'string' && Array.isArray(s.values) && s.values.every(v => v === null || typeof v === 'string')) && p.id === sourceId(s), 'Invalid source identity.');
  assert(p.people === undefined || Array.isArray(p.people) && p.people.length <= 100 && p.people.every(validPerson) && new Set(p.people.map(person => person.id)).size === p.people.length, 'Invalid partner people or contact methods.');
  assert(Array.isArray(p.activities) && p.activities.every(a => a && typeof a.id === 'string' && a.id && typeof a.at === 'string' && Number.isFinite(new Date(a.at).getTime()) && typeof a.author === 'string' && a.author.trim() && ['edit','note','call'].includes(a.kind) && typeof a.note === 'string' && a.note.length <= 3000 && Array.isArray(a.changes) && a.changes.every(c => typeof c.field === 'string' && typeof c.before === 'string' && typeof c.after === 'string') && (a.operation === undefined || typeof a.operation === 'string' && a.operation.length <= 16000) && (!a.call || a.call.id === a.id && validDate(a.call.date) && a.call.date !== '' && a.call.owner.trim() && a.call.outcome.trim() && typeof a.call.madeContact === 'boolean')), 'Invalid contact activity history.');
  assert(new Set(p.activities.map(a => a.id)).size === p.activities.length, 'Duplicate contact activity identifiers.');
 }
 assert(Array.isArray(d.goals) && d.goals.every(g => g && typeof g.id === 'string' && g.id && typeof g.title === 'string' && g.title.trim() && typeof g.owner === 'string' && g.owner.trim() && typeof g.deadline === 'string' && g.deadline && validDate(g.deadline) && Number.isSafeInteger(g.target) && g.target > 0 && g.target <= 10000 && Number.isSafeInteger(g.completed) && g.completed >= 0 && g.completed <= 10000 && Array.isArray(g.activities) && g.activities.every(a => a && typeof a.id === 'string' && typeof a.at === 'string' && Number.isFinite(new Date(a.at).getTime()) && typeof a.author === 'string' && a.author.trim() && typeof a.note === 'string' && typeof a.summary === 'string')), 'Invalid team goals.');
 assert(new Set(d.goals.map(g => g.id)).size === d.goals.length, 'Duplicate goal IDs.');
 assert(new Set(d.records.map(p => p.id)).size === d.records.length, 'Duplicate source row identities.');
 const people = d.records.flatMap(p => p.people || []); assert(new Set(people.map(person => person.id)).size === people.length, 'Person IDs must belong to one partner.'); return d;
}
export function loadProspects(storage: Pick<Storage, 'getItem'>, seed: ProspectData) { const raw = storage.getItem(PROSPECT_KEY); return raw === null ? structuredClone(seed) : parseProspects(raw); }
export function commitProspects(storage: Pick<Storage, 'getItem' | 'setItem'>, seed: ProspectData, expectedRevision: number, change: (data: ProspectData) => ProspectData) {
 const current = loadProspects(storage, seed); assert(current.revision === expectedRevision, 'Leads changed in another tab. Reload before retrying; your draft stays open.');
 const next = parseProspects(JSON.stringify(change(structuredClone(current)))); next.revision = current.revision + 1;
 storage.setItem(PROSPECT_KEY, JSON.stringify(next)); return next;
}
export function importProspects(current: ProspectData, incoming: ProspectData) {
 parseProspects(JSON.stringify(incoming)); assert(current.kind === incoming.kind || current.kind === 'synthetic' && incoming.kind === 'public-business', 'Keep public business contacts separate from synthetic examples.');
 if (current.kind !== incoming.kind) { assert(!current.records.some(p => p.source.origin === 'manual'), 'Manual partners are present. Keep their backup and use a separate business workspace; no manual records were replaced.'); return { ...structuredClone(incoming), revision: current.revision, goals: current.goals.length ? current.goals : incoming.goals }; }
 const existing = new Map(current.records.map(p => [p.id, p])); const records = incoming.records.map(p => existing.get(p.id) || structuredClone(p));
 const incomingIds = new Set(incoming.records.map(p => p.id)); records.push(...current.records.filter(p => !incomingIds.has(p.id))); const goalIds = new Set(current.goals.map(g => g.id)); return { ...current, records, goals: [...current.goals, ...incoming.goals.filter(g => !goalIds.has(g.id))] };
}
export function savePartnerPerson(data: ProspectData, partnerId: string, person: PartnerPerson, activity: ProspectActivity): ProspectData {
 assert(validPerson(person), 'Enter a person name and valid contact methods.');
 const partner = data.records.find(record => record.id === partnerId); assert(partner, 'This partner no longer exists. Reload before saving.');
 const operation = JSON.stringify({ partnerId, person }); const prior = partner.activities.find(a => a.id === activity.id);
 if (prior) { assert(prior.operation === operation, 'Retry identity belongs to another person change.'); return data; }
 const existing = (partner.people || []).find(p => p.id === person.id);
 partner.people = existing ? partner.people!.map(p => p.id === person.id ? structuredClone(person) : p) : [...partner.people || [], structuredClone(person)];
 partner.activities.push({ ...activity, operation, changes: [{ field: `person:${person.id}`, before: existing ? JSON.stringify(existing) : '', after: JSON.stringify(person) }] });
 return parseProspects(JSON.stringify(data));
}
export function selectedPartnerPerson(partner: Prospect, personId: string) {
 if (!personId) return undefined;
 const person = partner.people?.find(person => person.id === personId); assert(person, 'Choose a person belonging to the selected organization/desk.'); return person;
}
export type ManualPartnerInput = { uuid: string; organization: string; geography: string; category: string; contactRoute: string };
export function addManualPartner(data: ProspectData, input: ManualPartnerInput, activity: ProspectActivity): ProspectData {
 assert(uuid(input.uuid) && input.organization.trim() && input.geography.trim(), 'Enter an organization/desk name and location.');
 const id = `manual:${input.uuid}`; const operation = JSON.stringify(input); const existing = data.records.find(p => p.id === id);
 if (existing) { assert(existing.activities.some(a => a.id === activity.id && a.operation === operation), 'This manual partner ID already exists.'); return data; }
 const partner: Prospect = { id, organization: input.organization.trim(), geography: input.geography.trim(), category: input.category.trim() || 'Manual organization/desk', contactRoute: input.contactRoute.trim(), openingAsk: '', stage: 'Not contacted', owner: '', materials: 'None', lastTouch: '', nextAction: '', nextDate: '', notes: '', sprint: 'Later list', callScript: '', contacted: false, activities: [{ ...activity, operation, changes: [{ field: 'organization', before: '', after: input.organization.trim() }, { field: 'geography', before: '', after: input.geography.trim() }] }], source: { origin: 'manual', uuid: input.uuid, createdAt: activity.at, createdBy: activity.author } };
 partner.callScript = draftCallScript(partner); data.records.push(partner); return parseProspects(JSON.stringify(data));
}
const normalizeName = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
function routeEmails(text: string) { return [...text.matchAll(/[^\s;,<>]+@[^\s;,<>]+/g)].map(match => match[0].toLowerCase()); }
function routePhones(text: string) { return [...text.matchAll(/\+?[\d(). -]{7,}(?:\s*(?:ext\.?|x)\s*\d+)?/gi)].map(match => match[0].toLowerCase().replace(/[^\da-z]/g, '')).filter(value => value.replace(/\D/g, '').length >= 7); }
export function suggestPartnerDuplicates<T extends Pick<Prospect, 'id' | 'organization' | 'geography' | 'contactRoute' | 'people'>>(records: T[], input: Pick<ManualPartnerInput, 'organization' | 'geography' | 'contactRoute'>) {
 const name = normalizeName(input.organization), location = normalizeName(input.geography); const emails = routeEmails(input.contactRoute), phones = routePhones(input.contactRoute);
 return records.map(partner => {
  const reasons: string[] = []; const otherName = normalizeName(partner.organization), otherLocation = normalizeName(partner.geography);
  if (name.length >= 4 && otherName.length >= 4 && (name.includes(otherName) || otherName.includes(name))) reasons.push('Similar organization/desk name');
  if (name && location && otherLocation === location) reasons.push('Same entered location');
  const routes = [partner.contactRoute, ...(partner.people || []).flatMap(p => p.methods.map(method => method.value))].join('; ');
  if (emails.some(email => routeEmails(routes).includes(email)) || phones.some(phone => routePhones(routes).includes(phone))) reasons.push('Shared contact method; branches/desks may still be distinct');
  return { partner, reasons };
 }).filter(result => result.reasons.length).sort((a, b) => b.reasons.length - a.reasons.length);
}
export function recordProspectActivity(data: ProspectData, id: string, input: Partial<Pick<Prospect, 'owner' | 'stage' | 'materials' | 'nextAction' | 'nextDate' | 'callScript' | 'contacted' | 'notes' | 'lastTouch'>>, activity: ProspectActivity): ProspectData {
 const p = data.records.find(p => p.id === id); assert(p, 'This contact no longer exists. Reload Leads.');
 const existing = p.activities.find(a => a.id === activity.id); if (existing) { assert(JSON.stringify(existing) === JSON.stringify(activity), 'Retry identity belongs to another activity.'); return data; }
 const changes = Object.entries(input).filter(([key, value]) => String(p[key as keyof Prospect]) !== String(value)).map(([field, value]) => ({ field, before: String(p[field as keyof Prospect]), after: String(value) }));
 Object.assign(p, input); p.activities.push({ ...activity, changes }); return parseProspects(JSON.stringify(data));
}
export function logCall(data: ProspectData, id: string, activity: ProspectActivity, nextAction: string, nextDate: string): ProspectData {
 const p = data.records.find(p => p.id === id); assert(p, 'This contact no longer exists.'); const attempt = activity.call;
 assert(attempt && p.owner.trim(), 'Assign a call owner before logging an attempt.'); assert(attempt.owner === p.owner, 'Use the currently assigned call owner.'); assert(nextAction.trim(), 'Record the next action.');
 const stage = attempt.madeContact && ['New', 'Not contacted'].includes(p.stage) ? 'Contacted' : p.stage;
 const lastTouch = [p.lastTouch, attempt.date].sort().at(-1)!;
 return recordProspectActivity(data, id, { lastTouch, contacted: p.contacted || attempt.madeContact, stage, nextAction, nextDate } as Partial<Pick<Prospect, 'owner' | 'stage' | 'materials' | 'nextAction' | 'nextDate' | 'callScript' | 'contacted' | 'notes' | 'lastTouch'>>, activity);
}
export type ProspectFilters = { search: string; owner: string; stage: string; sprint: string };
export function selectProspects(records: Prospect[], f: ProspectFilters) { const q = f.search.trim().toLowerCase(); return records.filter(p => (!q || [p.organization, p.category, p.geography, p.contactRoute, p.openingAsk, p.notes].some(s => s.toLowerCase().includes(q))) && (f.owner === '*' || p.owner === f.owner) && (f.stage === '*' || p.stage === f.stage) && (f.sprint === '*' || p.sprint === f.sprint)); }
export function queueGroup(p: Prospect, today: string) { if (!p.owner.trim()) return 'Unassigned'; if (!p.nextDate) return 'No date'; if (p.nextDate < today) return 'Overdue'; if (p.nextDate === today) return 'Today'; return 'Upcoming'; }
export function businessToday(now = new Date()) { const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Vancouver', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now); return ['year', 'month', 'day'].map(t => parts.find(p => p.type === t)!.value).join('-'); }
export function exportProspects(data: ProspectData) { return JSON.stringify(data, null, 2); }
export function draftCallScript(p: Pick<Prospect, 'organization' | 'category' | 'openingAsk'>) { return `Draft for team review\n\nHello, I’m calling from Ethical Care at Home. Is this the right contact for ${p.category.toLowerCase()} community-resource information?\n\n${p.openingAsk}\n\nConfirm the correct route and permission for a follow-up. Use approved service facts before making any promises.\n\nRecord the outcome and agreed next action after the call.`; }

export function restoreProspects(storage: Pick<Storage, 'getItem' | 'setItem'>, seed: ProspectData, raw: string, expectedRevision: number, damagedRaw?: string) {
 const restored = parseProspects(raw); const currentRaw = storage.getItem(PROSPECT_KEY); let current: ProspectData | null = null;
 try { current = currentRaw === null ? seed : parseProspects(currentRaw); } catch { /* Explicit recovery preserves damaged bytes. */ }
 if (current) { assert(current.revision === expectedRevision, 'Leads changed before restore. Reload first.'); restored.revision = current.revision + 1; }
 else { assert(damagedRaw !== undefined && currentRaw === damagedRaw, 'Preserve and review damaged records before recovery.'); const archive = PROSPECT_KEY + ':damaged:' + Date.now(); storage.setItem(archive, currentRaw!); assert(storage.getItem(PROSPECT_KEY) === damagedRaw, 'Records changed during recovery.'); restored.revision = Math.max(expectedRevision, restored.revision) + 1; }
 storage.setItem(PROSPECT_KEY, JSON.stringify(restored)); return restored;
}
