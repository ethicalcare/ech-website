export const CAPABILITIES = ['users.manage', 'backup.export', 'admin.status', 'leads.read_all', 'leads.create', 'leads.update_all', 'leads.assign', 'leads.read_assigned', 'leads.update_assigned'] as const;
export type Capability = typeof CAPABILITIES[number];
export type OperationalRole = 'owner' | 'manager' | 'staff' | null;
export type Principal = { id: string; email: string; technicalAdmin: boolean; applicationAdmin: boolean; operationalRole: OperationalRole };
export type Session = { authenticated: true; principal: Principal; capabilities: Capability[] } | { authenticated: false; principal: null; capabilities: []; login: { method: 'email_otp' | 'email_password'; siteKey: string | null } };
export type SharedPerson = { id: string; name: string; role: string; methods: { id: string; kind: 'phone' | 'email'; value: string; label: string }[] };
export type SharedInquiry = { id: string; revision: number; name: string; phone: string; email: string; city: string; relationship: string; careRecipient: string; careRecipientPhone: string; careRecipientEmail: string; preferredContact: string; need: string; source: string; status: string; ownerId: string | null; next: string; followUpAt: string | null; referralPartnerId: string | null; referringPersonId: string | null; referralContext: string; details: string; createdAt: string; updatedAt: string };
export type SharedPartner = { id: string; revision: number; organization: string; category: string; geography: string; contactRoute: string; stage: string; ownerId: string | null; nextAction: string; nextDate: string; notes: string; openingAsk: string; materials: string; lastTouch: string; callScript: string; contacted: boolean; sprint: string; source: Record<string, unknown>; people: SharedPerson[]; createdAt: string; updatedAt: string };
export type RecordKind = 'inquiry' | 'partner';
export type SharedRecord = SharedInquiry | SharedPartner;
export type Assignee = { id: string; label: string; operationalRole: Exclude<OperationalRole, null> };
export type HistoryEntry = { id: string; operationId: string; recordType: RecordKind; recordId: string; actorId: string; at: string; action: string; revision: number; actorLabel: string; details: { outcome?: string; note?: string; call?: { date: string; channel: string; madeContact: boolean }; changedFields?: string[]; changes?: { field: string; before: unknown; after: unknown }[] } };
export type Command = { schema: 1; operationId: string; expectedRevision: number; command: { type: string; id: string; fields: Record<string, unknown> } };
export type Receipt = { operationId: string; expectedRevision: number; revision: number; commandFingerprint: string };
export class SharedError extends Error {
  readonly code: string; readonly saved: false | 'unknown';
  constructor(code: string, message: string, saved: false | 'unknown' = false) { super(message); this.name = 'SharedError'; this.code = code; this.saved = saved; }
}
export const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export function assertWire(value: unknown): asserts value { if (!value) throw new SharedError('invalid_response', 'The server response could not be verified. Reload before continuing.'); }
export function object(value: unknown): Record<string, unknown> { assertWire(value !== null && typeof value === 'object' && !Array.isArray(value)); return value as Record<string, unknown>; }
export function exact(value: unknown, fields: string[]): Record<string, unknown> { const result = object(value); assertWire(Object.keys(result).length === fields.length && fields.every(key => Object.hasOwn(result, key))); return result; }
export function validInstant(value: unknown): value is string { return typeof value === 'string' && value.length <= 40 && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(new Date(value).getTime()); }
export function can(session: Session | null, capability: Capability): boolean { return session?.authenticated === true && session.capabilities.includes(capability); }
export function canOperate(session: Session | null) { return can(session, 'leads.read_all') || can(session, 'leads.read_assigned'); }
export function parseSession(value: unknown): Session {
  const s = object(value);
  if (s.authenticated === false) { exact(s, ['authenticated', 'principal', 'capabilities', 'login']); assertWire(s.principal === null && Array.isArray(s.capabilities) && s.capabilities.length === 0); const login = exact(s.login, ['method', 'siteKey']); assertWire(['email_otp','email_password'].includes(login.method as string) && (login.siteKey === null || typeof login.siteKey === 'string' && login.siteKey.length <= 200)); return s as Session; }
  exact(s, ['authenticated', 'principal', 'capabilities']); assertWire(s.authenticated === true); const p = exact(s.principal, ['id', 'email', 'technicalAdmin', 'applicationAdmin', 'operationalRole']);
  assertWire(uuid(p.id) && typeof p.email === 'string' && p.email.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email) && typeof p.technicalAdmin === 'boolean' && typeof p.applicationAdmin === 'boolean' && [null, 'owner', 'manager', 'staff'].includes(p.operationalRole as OperationalRole));
  const allowed = p.operationalRole === 'owner' || p.operationalRole === 'manager' ? ['leads.read_all', 'leads.create', 'leads.update_all', 'leads.assign'] : p.operationalRole === 'staff' ? ['leads.read_assigned', 'leads.update_assigned'] : [];
  if (p.technicalAdmin) allowed.push('admin.status');
  if (p.applicationAdmin) allowed.push('users.manage','backup.export');
  assertWire(Array.isArray(s.capabilities) && new Set(s.capabilities).size === s.capabilities.length && s.capabilities.every(c => typeof c === 'string' && allowed.includes(c)));
  return s as Session;
}
export function validateSharedPerson(value: unknown) { const p = exact(value, ['id', 'name', 'role', 'methods']); assertWire(uuid(p.id) && typeof p.name === 'string' && p.name.trim() && p.name.length <= 160 && typeof p.role === 'string' && p.role.length <= 160 && Array.isArray(p.methods) && p.methods.length <= 20); const methods = p.methods as unknown[]; for (const value of methods) { const m = exact(value, ['id', 'kind', 'value', 'label']); assertWire(uuid(m.id) && ['phone', 'email'].includes(m.kind as string) && typeof m.value === 'string' && m.value.trim() && m.value.length <= 300 && (m.kind !== 'email' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m.value)) && typeof m.label === 'string' && m.label.length <= 160); } assertWire(new Set(methods.map(m => object(m).id)).size === methods.length); }
export function parseRecord(kind: 'inquiry', value: unknown): SharedInquiry;
export function parseRecord(kind: 'partner', value: unknown): SharedPartner;
export function parseRecord(kind: RecordKind, value: unknown): SharedRecord;
export function parseRecord(kind: RecordKind, value: unknown): SharedRecord {
  const inquiry = ['id','revision','name','phone','email','city','relationship','careRecipient','need','source','status','ownerId','next','followUpAt','referralPartnerId','referringPersonId','referralContext','details','createdAt','updatedAt','careRecipientPhone','careRecipientEmail','preferredContact'];
  const partner = ['id','revision','organization','category','geography','contactRoute','stage','ownerId','nextAction','nextDate','notes','source','people','createdAt','updatedAt','openingAsk','materials','lastTouch','callScript','contacted','sprint'];
  const r = exact(value, kind === 'inquiry' ? inquiry : partner);
  assertWire(uuid(r.id) && Number.isSafeInteger(r.revision) && (r.revision as number) >= 0 && (r.ownerId === null || uuid(r.ownerId)) && validInstant(r.createdAt) && validInstant(r.updatedAt));
  const strings = kind === 'inquiry' ? ['name','phone','email','city','relationship','careRecipient','need','source','status','next','referralContext','details','careRecipientPhone','careRecipientEmail','preferredContact'] : ['organization','category','geography','contactRoute','stage','nextAction','nextDate','notes','openingAsk','materials','lastTouch','callScript','sprint'];
  assertWire(strings.every(key => typeof r[key] === 'string' && (r[key] as string).length <= (kind === 'inquiry' ? 3000 : 12000)));
  if (kind === 'inquiry') assertWire((r.followUpAt === null || validInstant(r.followUpAt)) && (r.referralPartnerId === null || uuid(r.referralPartnerId)) && (r.referringPersonId === null || uuid(r.referringPersonId) && r.referralPartnerId !== null));
  else { assertWire(typeof r.contacted === 'boolean'); object(r.source); assertWire(typeof r.nextDate === 'string' && (r.nextDate === '' || /^\d{4}-\d{2}-\d{2}$/.test(r.nextDate) && new Date(r.nextDate + 'T12:00:00Z').toISOString().slice(0,10) === r.nextDate) && Array.isArray(r.people) && r.people.length <= 100); for (const p of r.people as unknown[]) validateSharedPerson(p); assertWire(new Set((r.people as unknown[]).map(p => object(p).id)).size === (r.people as unknown[]).length); }
  return r as SharedRecord;
}
