import { AdminError, UUID } from './shared-commands.js';
import { requireOperational } from './permissions.js';

const invalid = () => new AdminError(400, 'invalid_request', 'Choose a valid calendar window.');
const unavailable = () => new AdminError(503, 'unavailable', 'The calendar could not be verified.');
const id = value => typeof value === 'string' && value.length === 36 && UUID.test(value);
const stamp = value => {
  if (typeof value !== 'string' || value.length !== 24 || value.startsWith('0000-') || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const date = new Date(value); return Number.isFinite(date.getTime()) && date.toISOString() === value;
};
const shape = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const identity = row => shape(row, ['id', 'name']) && id(row.id) && typeof row.name === 'string'
  && row.name.length <= 320 && Boolean(row.name.trim()) && !/[\x00-\x1f\x7f]/u.test(row.name);

async function boundedJson(response) {
  const reader = response.body?.getReader(); if (!reader) throw unavailable();
  const chunks = []; let size = 0;
  try {
    for (;;) {
      const {done,value} = await reader.read(); if (done) break;
      size += value.byteLength; if (size > 2_000_000) { await reader.cancel(); throw unavailable(); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)); } catch { throw unavailable(); }
}

function validate(value, role, from, to) {
  if (!shape(value,['visits','clients','staff']) || !Array.isArray(value.visits) || value.visits.length > 1000
    || !Array.isArray(value.clients) || !Array.isArray(value.staff) || value.clients.length > 1000 || value.staff.length > 1001
    || !value.clients.every(identity) || !value.staff.every(identity)) throw unavailable();
  const clients = new Set(value.clients.map(row=>row.id)), staff = new Set(value.staff.map(row=>row.id));
  if (clients.size !== value.clients.length || staff.size !== value.staff.length || role === 'staff' && staff.size !== 1) throw unavailable();
  const visits = new Set(), usedClients = new Set();
  for (const row of value.visits) {
    if (!shape(row,['id','clientId','workerId','service','start','end','status','revision']) || !id(row.id) || visits.has(row.id)
      || !id(row.clientId) || !clients.has(row.clientId) || row.workerId !== null && (!id(row.workerId) || !staff.has(row.workerId))
      || !['Home support','Nursing'].includes(row.service) || !['Open','Assigned','Confirmed','In progress','Completed','Cancelled'].includes(row.status)
      || !Number.isSafeInteger(row.revision) || row.revision < 1 || !stamp(row.start) || !stamp(row.end) || row.start >= row.end || row.start >= to || row.end <= from
      || row.status === 'Open' && row.workerId !== null || !['Open','Cancelled'].includes(row.status) && row.workerId === null
      || role === 'staff' && (row.status === 'Cancelled' || !staff.has(row.workerId))) throw unavailable();
    visits.add(row.id); usedClients.add(row.clientId);
  }
  if (usedClients.size !== clients.size) throw unavailable();
  return value;
}

export async function schedule(current, params, fetcher) {
  requireOperational(current.member);
  const role = current.member.operational_role;
  if ([...params.keys()].some(key=>!['from','to'].includes(key)) || params.getAll('from').length !== 1 || params.getAll('to').length !== 1) throw invalid();
  const from=params.get('from'), to=params.get('to');
  if (!stamp(from) || !stamp(to) || from >= to || Date.parse(to)-Date.parse(from)>43*24*60*60*1000) throw invalid();
  let response;
  try {
    response = await fetcher(current.config.base+'/rest/v1/rpc/ech_operations_schedule', {
      method:'POST', redirect:'manual', cache:'no-store', signal:AbortSignal.timeout(10000),
      headers:{apikey:current.config.key,Authorization:'Bearer '+current.token,'Content-Type':'application/json'},
      body:JSON.stringify({p_from:from,p_to:to,p_expected_role:role}),
    });
  } catch { throw unavailable(); }
  if (response.status === 401) throw new AdminError(401,'unauthenticated','Sign in to continue.');
  if (response.status === 403) throw new AdminError(403,'forbidden','The calendar is not available for this account.');
  if (response.status === 409) throw new AdminError(409,'conflict','Account access changed. Reload the workspace.');
  if (response.status === 413) throw new AdminError(413,'invalid_request','Choose a shorter calendar window.');
  if (!response.ok || response.status >= 300 && response.status < 400) throw unavailable();
  const payload=validate(await boundedJson(response),role,from,to);
  return {schema:1,mode:'shared',...payload};
}
