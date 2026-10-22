import { AdminError, exact, text, UUID, canonical, commandFingerprint } from './shared-commands.js';
import { requireApplicationAdmin } from './permissions.js';
import { rpc } from './shared-repository.js';
// Membership GET returns {schema:1,items:[member]}. POST accepts the exact envelope
// below; expectedRevision is 0 for a new membership and the listed revision otherwise.
// Only an existing Auth email can be targeted. Login allowlist configuration is separate.
const invalid=()=>new AdminError(400,'invalid_request','Review the membership fields.');
export function parseMembership(input) {
  exact(input,['schema','operationId','expectedRevision','command']);
  if(input.schema!==1||!UUID.test(input.operationId)||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0||input.expectedRevision>=Number.MAX_SAFE_INTEGER)throw invalid();
  const command=exact(input.command,['type','email','fields']);
  text(command.email,254,true);
  if(command.type!=='upsert'||command.email!==command.email.trim().toLowerCase()||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(command.email))throw invalid();
  const fields=exact(command.fields,['displayName','technicalAdmin','operationalRole','applicationAdmin','active']);
  text(fields.displayName,160,true);
  if(!['technicalAdmin','applicationAdmin','active'].every(k=>typeof fields[k]==='boolean')||![null,'owner','manager','staff'].includes(fields.operationalRole))throw invalid();
  return JSON.parse(canonical(input));
}
function noFilters(params){if([...params.keys()].length)throw new AdminError(400,'invalid_request','Invalid filter.');}
export async function membershipList(current,params,fetcher) {
  requireApplicationAdmin(current.member);noFilters(params);
  const items=await rpc(current,'ech_membership_list',{},fetcher);
  if(!Array.isArray(items))throw new AdminError(502,'write_unconfirmed','Memberships could not be verified.');
  return {schema:1,items};
}
export async function membershipCommit(current,raw,fetcher) {
  requireApplicationAdmin(current.member);const envelope=parseMembership(raw);
  const value=await rpc(current,'ech_membership_commit',{p_envelope:envelope},fetcher);
  if(!value?.member||!value.receipt||value.receipt.operationId!==envelope.operationId||value.receipt.expectedRevision!==envelope.expectedRevision||value.receipt.revision!==envelope.expectedRevision+1||value.member.revision!==value.receipt.revision||value.member.email!==envelope.command.email||!UUID.test(value.member.userId)||!Object.entries(envelope.command.fields).every(([key,item])=>value.member[key]===item)||value.receipt.commandFingerprint!==await commandFingerprint(envelope))throw new AdminError(502,'write_unconfirmed','Membership save receipt could not be verified. Keep the operation identity.');
  return {schema:1,...value};
}
// Snapshot v1 contains raw data-table rows, camelCase membership metadata and
// membership receipts. It excludes Auth users and sessions. Restore data in isolation;
// membership metadata must never automatically restore grants or create Auth users.
export async function backup(current,params,fetcher) {
  requireApplicationAdmin(current.member);noFilters(params);
  const value=await rpc(current,'ech_application_backup',{},fetcher);
  if(value?.format!=='ech-application-snapshot'||value.version!==1||!['records','personKeys','events','commandReceipts','memberships','membershipReceipts'].every(k=>Array.isArray(value[k])))throw new AdminError(502,'write_unconfirmed','Backup could not be verified.');
  return value;
}
