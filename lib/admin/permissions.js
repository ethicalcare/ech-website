import { denied } from './shared-commands.js';
export function capabilities(member) {
  if (!member?.active) return [];
  const result = member.technical_admin ? ['admin.status'] : [];
  if(member.application_admin===true)result.push('users.manage','backup.export');
  if (['owner','manager'].includes(member.operational_role)) result.push('leads.read_all','leads.create','leads.update_all','leads.assign');
  if (member.operational_role === 'staff') result.push('leads.read_assigned','leads.update_assigned');
  return result;
}
export function authorize(member, type, record = null) {
  if (!member?.active) throw denied();
  const manager = ['owner','manager'].includes(member.operational_role);
  if (['create','assign','assignees'].includes(type)) { if (!manager) throw denied(); return; }
  if (manager) return;
  if (member.operational_role !== 'staff' || !record || record.owner_id !== member.user_id) throw denied();
}
export function requireOperational(member) { if (!member?.active || !['owner','manager','staff'].includes(member.operational_role)) throw denied(); }

export function requireApplicationAdmin(member) { if (!member?.active || member.application_admin !== true) throw denied(); }
