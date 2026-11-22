// Private incident command boundary candidate. No live route, store or permission.
const denied = Object.freeze({status:'unavailable'});
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value);
const revision = value => Number.isSafeInteger(value) && value > 0;
const actions = Object.freeze({file:'summary',pickup:null,'follow-up':'note',close:null});
const base = ['action','id','operation','visit','revision','membershipRevision'];

function commandOf(input) {
  if (!input || Object.getPrototypeOf(input) !== Object.prototype ||
      !Object.hasOwn(actions,input.action)) return null;
  const textKey = actions[input.action];
  const keys = textKey ? [...base,textKey] : base;
  if (Object.keys(input).length !== keys.length || !keys.every(key=>Object.hasOwn(input,key)) ||
      ![input.id,input.operation,input.visit].every(uuid) || input.id===input.operation ||
      !revision(input.revision) || !revision(input.membershipRevision)) return null;
  if (textKey && (typeof input[textKey]!=='string' || !input[textKey].trim() ||
      (textKey==='summary' && input[textKey].length>500))) return null;
  return Object.freeze(Object.fromEntries(keys.map(key=>[key,input[key]])));
}

// The caller supplies an opaque verified session; client input cannot assert actor,
// role, assignment, receipt or existing report. The adapter must acquire the visit
// and actor context and commit inside ONE transaction. This module does not supply
// transaction semantics, durable dedupe, grants, or external reporting.
export function createIncidentIntentBoundary(withScopedVisitTransaction) {
  return async (session,input) => {
    const command=commandOf(input);
    if(!command)return denied;
    try {
      const receipt=await withScopedVisitTransaction(session,command.visit,async(tx)=>{
        const c=tx.current;
        if(!c||!uuid(c.actor)||c.visit!==command.visit||c.revision!==command.revision||
          c.membershipRevision!==command.membershipRevision) return denied;
        const allowed=command.action==='file'
          ?c.role==='staff'&&c.assigned===true&&c.cancelled===false
          :c.role==='manager'||c.role==='owner';
        if(!allowed) return denied;
        return tx.commit({actor:c.actor,role:c.role,command});
      });
      if(receipt?.status!=='recorded'||receipt.id!==command.id||receipt.operation!==command.operation||
         receipt.visit!==command.visit||receipt.action!==command.action) return denied;
      return {status:'recorded',id:command.id,operation:command.operation,visit:command.visit,action:command.action};
    } catch {return denied;}
  };
}
