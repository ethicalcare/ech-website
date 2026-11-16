// A receipt confirms a historical write, not the account's current permissions.
export function membershipSaveFeedback(receipt, refreshedMembers) {
  const current = refreshedMembers?.find(member => member.userId === receipt.userId);
  if (!current || current.revision < receipt.revision) {
    return 'Account change recorded. Current access could not be verified. Refresh accounts to check the current status.';
  }
  return current.active
    ? 'Account change recorded. The refreshed account is active. Review its current permissions below.'
    : 'Account change recorded. The refreshed account is inactive and cannot sign in.';
}
