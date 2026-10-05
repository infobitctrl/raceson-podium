import { listRewardAthleteClaims, type RewardAccountIdentity, type RewardLedgerRpc } from "@raceson/db/rewards";
import type { RewardPortalConfig } from "./request-identity.js";

/** Browser whitelist. Never spread a private claim/review/proof context here.
 * The original recipient keeps historical metadata after an identity hold;
 * current consent and payment still require their independent fresh checks. */
export async function getAthleteRewardClaims(identity: RewardAccountIdentity, afterId: string | null,
  deps: RewardPortalConfig & { rpc?: RewardLedgerRpc }) {
  const result = await listRewardAthleteClaims(identity, { chainId: deps.chainId, afterId }, deps.rpc);
  return { items: result.items.map(d => ({ intentId: d.intentId, programmeId: d.programmeId, campaignId: d.campaignId,
    entitlementId: d.entitlementId, scopeKey: d.scopeKey, pot: d.pot, chainId: d.chainId, amountWei: d.amountWei.toString(),
    recipientAddress: d.recipientAddress, issuedAt: d.issuedAt.toString(), expiresAt: d.expiresAt.toString(), preparedAt: d.preparedAt,
    recipientConsentRecordedAt: d.recipientConsentRecordedAt, operatorApprovalRecordedAt: d.operatorApprovalRecordedAt })),
    nextCursor: result.nextCursor };
}
