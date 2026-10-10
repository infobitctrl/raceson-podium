/** Existing V5/V6 registries and V6 club claims enforce a one-day ceiling.
 * Wallet-control challenges retain their separate ten-minute validity. */
export const CLUB_APPROVAL_LIFETIME_SECONDS = 86_400n;
export function clubApprovalExpiry(now: bigint, deadline: bigint): bigint {
 const expiry = now + CLUB_APPROVAL_LIFETIME_SECONDS;
 return expiry < deadline ? expiry : deadline;
}
export function identityBindingLifetimeSeconds(beneficiaryKind: number): bigint {
 return beneficiaryKind === 1 ? CLUB_APPROVAL_LIFETIME_SECONDS : 600n;
}
