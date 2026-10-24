import { AdminError, exact, UUID, canonical, commandFingerprint } from './shared-commands.js';
import { rpc } from './shared-repository.js';
export const ACCESS_REVIEWER_ID='1fbc76c6-8521-4f9e-b0c9-f174ada676aa';
export function canReviewAccess(current) {
  return current.principal?.id===ACCESS_REVIEWER_ID&&current.principal?.email?.toLowerCase()==='erick@bloxlabs.tech'&&current.member?.active===true&&current.member?.application_admin===true&&current.member?.operational_role==='owner';
}
export function requireAccessReviewer(current) {
  if(!canReviewAccess(current))throw new AdminError(403,'forbidden','Only the main administrator can review account access.');
}
export function parseAccessReview(raw) {
  exact(raw,['schema','operationId','expectedRevision','command']);const c=exact(raw.command,['type','userId','role']);
  if(raw.schema!==1||!UUID.test(raw.operationId)||!UUID.test(c.userId)||c.userId===ACCESS_REVIEWER_ID||!Number.isSafeInteger(raw.expectedRevision)||raw.expectedRevision<1||raw.expectedRevision>=Number.MAX_SAFE_INTEGER||!['approve','deny','revoke'].includes(c.type)||(c.type==='approve'?!['staff','manager'].includes(c.role):c.role!==null))throw new AdminError(400,'invalid_request','Choose the access decision and an approved role.');
  return JSON.parse(canonical(raw));
}
export async function accessRequests(current,params,fetcher) {
  requireAccessReviewer(current);if([...params.keys()].length)throw new AdminError(400,'invalid_request','Invalid filter.');
  const items=await rpc(current,'ech_access_requests',{},fetcher);
  if(!Array.isArray(items))throw new AdminError(502,'write_unconfirmed','Access requests could not be verified.');
  return{schema:1,items};
}
export async function reviewAccess(current,raw,fetcher) {
  requireAccessReviewer(current);const envelope=parseAccessReview(raw);
  const value=await rpc(current,'ech_review_access',{p_envelope:envelope},fetcher);
  const state={approve:'approved',deny:'denied',revoke:'revoked'}[envelope.command.type];
  if(!value?.request||value.request.userId!==envelope.command.userId||value.request.state!==state||value.request.role!==envelope.command.role||value.request.revision!==envelope.expectedRevision+1||value.receipt?.operationId!==envelope.operationId||value.receipt.expectedRevision!==envelope.expectedRevision||value.receipt.revision!==value.request.revision||value.receipt.commandFingerprint!==await commandFingerprint(envelope))throw new AdminError(502,'write_unconfirmed','Access decision was not confirmed. Keep the operation and reload requests before retrying.');
  return{schema:1,...value};
}
