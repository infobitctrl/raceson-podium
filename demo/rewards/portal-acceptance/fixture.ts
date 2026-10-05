// Task-owned synthetic transport; no real session, database, wallet or chain.
const id = (n: number) => `a3300000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const hash = (c: string): `0x${string}` => `0x${c.repeat(64)}`;
export const state = { reads: [] as string[], writes: 0, unavailable: false };
export const claim = { schema: 'raceson-athlete-claim-record-v3' as const, chainId: 31337 as const,
  uploadId: id(1), destinationId: id(2), claimId: id(3), entitlementId: hash('1'),
  recipientAddress: `0x${'2'.repeat(40)}` as `0x${string}`, amountWei: '200000000000000003', issuedAt: '1800000000', expiresAt: '1800086400',
  recipientConsented: true, operatorApproved: true };
export const award = { entitlementId: claim.entitlementId, approvalId: id(4), draftId: id(5), slot: 5 as const,
  athleteProfileId: id(6), chainId: 31337 as const, sourceKind: 'synthetic_rehearsal' as const, amountWei: claim.amountWei,
  campaignAddress: `0x${'3'.repeat(40)}`, recordedAt: '2026-09-14T10:00:00Z', ageStatus: 'unverified_adult' as const };
export const payment = { schema: 'raceson-athlete-payment-status-v3', chainId: claim.chainId, uploadId: claim.uploadId,
  destinationId: claim.destinationId, claimId: claim.claimId, entitlementId: claim.entitlementId,
  recipientAddress: claim.recipientAddress, amountWei: claim.amountWei, paymentId: id(7), state: 'confirmed',
  transactionHash: hash('4'), confirmed: true, blockNumber: '500', blockHash: hash('5'), readinessHeld: false };
export async function apiRequest({ path, method = 'GET' }: { path: string; method?: string }) {
  if (method !== 'GET') { state.writes++; throw { status: 405 }; }
  state.reads.push(path);
  if (state.unavailable) throw { status: 503 };
  if (path !== `/v1/athlete/rewards/uploads/${claim.uploadId}/destinations/${claim.destinationId}/awards/${claim.entitlementId}/claims/${claim.claimId}/payment`) throw { status: 404 };
  return structuredClone(payment);
}
export const publicEnv = { rewardPortalEnabled: true, rewardDemo: { mode: 'local', chainId: 31337 } };
export const apiOrigin = () => location.origin;
