type MembershipFields = {
  displayName: string; active: boolean; operationalRole: 'owner' | 'manager' | 'staff' | null;
  technicalAdmin: boolean; applicationAdmin: boolean; delegatedUserAdmin?: boolean;
};
/** Describe the exact retained command, never infer the account's current grant. */
export function MembershipChangeSummary({fields}:{fields:MembershipFields}) {
  return <div aria-label="Requested account changes">
    <p>Requested display name: {fields.displayName}</p>
    <p>Sign-in access: {fields.active ? 'Allow sign-in' : 'Deactivate account and end existing sessions'}.</p>
    <p>CRM role: {fields.operationalRole ?? 'No CRM access'}.</p>
    <p>Technical status access: {fields.technicalAdmin ? 'Enabled' : 'Disabled'}.</p>
    <p>Application administrator access: {fields.applicationAdmin ? 'Enabled' : 'Disabled'}.</p>
    <p>Delegated account management: {fields.delegatedUserAdmin === true ? 'Enabled'
      : fields.delegatedUserAdmin === false ? 'Disabled'
      : fields.operationalRole !== 'manager' ? 'Not granted for this role' : 'Not explicitly changed by this save'}.</p>
  </div>;
}
