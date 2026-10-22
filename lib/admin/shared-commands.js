export class AdminError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
export const invalid = () => new AdminError(400, 'invalid_request', 'Review the request fields.');
export const denied = () => new AdminError(403, 'forbidden', 'This action is not permitted.');
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const inquiry = ['name','phone','email','city','relationship','careRecipient','need','source','status','next','followUpAt','details','careRecipientPhone','careRecipientEmail','preferredContact'];
const partner = ['organization','category','geography','contactRoute','stage','nextAction','nextDate','notes','openingAsk','materials','lastTouch','callScript','contacted','sprint'];
export function exact(value, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || required.some(k => !Object.hasOwn(value,k)) || Object.keys(value).some(k => !required.includes(k) && !optional.includes(k))) throw invalid();
  return value;
}
export function text(value, max = 1000, required = false) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim()) || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) throw invalid();
}
export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k)+':'+canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
export async function commandFingerprint(value) { const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(value)));return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join(''); }
export function parseCommand(kind, input) {
  if (!['inquiry','partner'].includes(kind)) throw invalid();
  exact(input,['schema','operationId','expectedRevision','command']);
  if (input.schema !== 1 || !UUID.test(input.operationId) || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0 || input.expectedRevision >= Number.MAX_SAFE_INTEGER) throw invalid();
  const cmd = exact(input.command,['type','id','fields']);
  if (!UUID.test(cmd.id)) throw invalid();
  let allowed;
  if (['create','update'].includes(cmd.type)) allowed = kind === 'inquiry' ? inquiry : partner;
  else if (cmd.type === 'assign') allowed = ['ownerId'];
  else if (kind === 'inquiry' && cmd.type === 'attribute_referral') allowed = ['referralPartnerId','referringPersonId','referralContext'];
  else if (kind === 'inquiry' && cmd.type === 'record_note') allowed = ['note'];
  else if (kind === 'inquiry' && cmd.type === 'follow_up') allowed = ['outcome','note','next','followUpAt','status'];
  else if (kind === 'partner' && cmd.type === 'record_activity') allowed = ['outcome','note','nextAction','nextDate','stage','date','channel','madeContact'];
  else if (kind === 'partner' && cmd.type === 'save_person') allowed = ['person'];
  else throw invalid();
  const f = exact(cmd.fields,[],allowed);
  if (!Object.keys(f).length) throw invalid();
  for (const [key,value] of Object.entries(f)) {
    if (['contacted','madeContact'].includes(key)) { if (typeof value !== 'boolean') throw invalid(); }
    else if (['ownerId','referralPartnerId','referringPersonId'].includes(key)) { if (value !== null && !UUID.test(value)) throw invalid(); }
    else if (key === 'followUpAt') { if (value !== null && (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value)) throw invalid(); }
    else if (key === 'person') {
      exact(value,['id','name','role','methods']); if (!UUID.test(value.id)) throw invalid(); text(value.name,160,true); text(value.role,160);
      if (!Array.isArray(value.methods) || value.methods.length > 20) throw invalid();
      const ids = new Set();
      for (const method of value.methods) { exact(method,['id','kind','value','label']); if (!UUID.test(method.id) || ids.has(method.id) || !['phone','email'].includes(method.kind)) throw invalid(); ids.add(method.id); text(method.value,300,true); text(method.label,160); if (method.kind === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(method.value)) throw invalid(); }
    } else { text(value, key === 'note' || key === 'outcome' ? 3000 : kind === 'partner' ? 12000 : 3000); if (['nextDate','lastTouch','date'].includes(key) && value && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value+'T00:00:00Z').toISOString().slice(0,10) !== value)) throw invalid(); }
  }
  if (cmd.type === 'assign' && !Object.hasOwn(f,'ownerId')) throw invalid();
  if (cmd.type === 'create') {
    if (input.expectedRevision !== 0) throw invalid();
    if (kind === 'inquiry') { text(f.name,3000,true); if (!f.phone?.trim() && !f.email?.trim()) throw invalid(); }
    else { text(f.organization,12000,true); text(f.geography,12000,true); }
  }
  for(const key of ['email','careRecipientEmail']) if (f[key] && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f[key])) throw invalid();
  if (f.status && !['New','Contacted','Assessment booked','On hold','Closed'].includes(f.status)) throw invalid();
  if (f.stage && !['New','Not contacted','Contacted','Conversation underway','Ongoing relationship','On hold','Closed'].includes(f.stage)) throw invalid();
  if (f.preferredContact && !['Phone','Email','Either'].includes(f.preferredContact)) throw invalid();
  for(const key of ['phone','careRecipientPhone']) if(f[key] && (!/^\+?[\d\s().-]+(?:\s*(?:x|ext\.?)\s*\d{1,6})?$/i.test(f[key]) || f[key].replace(/\D/g,'').length<10 || f[key].replace(/\D/g,'').length>21)) throw invalid();
  if (f.channel && !['Call','Meeting','Appointment','Other touchpoint'].includes(f.channel)) throw invalid();
  if (cmd.type === 'record_note' && !f.note?.trim()) throw invalid();
  return JSON.parse(canonical(input));
}
