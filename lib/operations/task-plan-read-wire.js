// Projection of migration 015's exact private manager read. No inferred tasks,
// defaults, eligibility or authoring authority; array order is source order.
export const TASK_PLAN_READ_MAX_BYTES=100000;
const exact=(v,keys)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const id=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
const text=(v,max)=>typeof v==='string'&&[...v].length>0&&[...v].length<=max&&v===v.trim()&&!/[\u0000-\u001f\u007f-\u009f]/u.test(v);
const stamp=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
export function isTaskPlanRead(value,clientId,instructionsVersion,membershipRevision){
 if(!exact(value,['schema','membershipRevision','clientId','instructionsVersion','plan','planToken'])||value.schema!==1
  ||value.clientId!==clientId||!id(value.clientId)||value.instructionsVersion!==instructionsVersion||!Number.isSafeInteger(instructionsVersion)||instructionsVersion<1
  ||value.membershipRevision!==membershipRevision||!Number.isSafeInteger(membershipRevision)||membershipRevision<1)return false;
 if(value.plan===null)return value.planToken===null;
 const p=value.plan;
 if(!exact(p,['categories','authorId','authorLabel','authoredAt','sourceReference'])||!id(p.authorId)||!text(p.authorLabel,160)||!stamp(p.authoredAt)||!text(p.sourceReference,256)
  ||typeof value.planToken!=='string'||!/^[0-9a-f]{64}$/.test(value.planToken)
  ||!Array.isArray(p.categories)||p.categories.length>20)return false;
 const categories=new Set(),tasks=new Set();
 for(const c of p.categories){if(!exact(c,['id','label','tasks'])||!id(c.id)||categories.has(c.id)||!text(c.label,100)||!Array.isArray(c.tasks))return false;categories.add(c.id);
  for(const t of c.tasks){if(!exact(t,['id','text'])||!id(t.id)||tasks.has(t.id)||!text(t.text,500))return false;tasks.add(t.id);if(tasks.size>100)return false;}}
 return true;
}
