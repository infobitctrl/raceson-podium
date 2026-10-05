import { requirePortal, rewardRecord as record, rewardUuid as uuid, walletAddress } from "./athleteRewards";

export type AthleteRewardClaim = {
  intentId: string; programmeId: string; campaignId: string; entitlementId: string;
  scopeKey: string; pot: "race" | "league"; chainId: 10143 | 31337; amountWei: string;
  recipientAddress: `0x${string}`; issuedAt: string; expiresAt: string; preparedAt: string;
  recipientConsentRecordedAt: string | null; operatorApprovalRecordedAt: string | null;
};
export type AthleteRewardClaimsPage = { items: AthleteRewardClaim[]; nextCursor: string | null };
export const claimInteger = (value: unknown, bits = 256): value is string => typeof value === "string"
  && /^(0|[1-9][0-9]{0,77})$/.test(value) && BigInt(value) < 2n ** BigInt(bits);
export const claimTimestamp = (value: unknown): value is string => typeof value === "string"
  && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(value) && Number.isFinite(Date.parse(value));
export function claimRecordedTimes(d: Record<string, unknown>) {
  requirePortal(d.recipientConsentRecordedAt === null || claimTimestamp(d.recipientConsentRecordedAt));
  requirePortal(d.operatorApprovalRecordedAt === null || (claimTimestamp(d.operatorApprovalRecordedAt)
    && typeof d.recipientConsentRecordedAt === "string" && Date.parse(d.operatorApprovalRecordedAt) >= Date.parse(d.recipientConsentRecordedAt)));
}
export function decodeAthleteRewardClaim(value: unknown): AthleteRewardClaim {
  const d = record(value, ["intentId", "programmeId", "campaignId", "entitlementId", "scopeKey", "pot", "chainId", "amountWei",
    "recipientAddress", "issuedAt", "expiresAt", "preparedAt", "recipientConsentRecordedAt", "operatorApprovalRecordedAt"]);
  requirePortal(uuid(d.intentId) && uuid(d.programmeId) && uuid(d.campaignId) && uuid(d.entitlementId)
    && ((d.pot === "race" && uuid(d.scopeKey)) || (d.pot === "league" && d.scopeKey === "rounds-1-5"))
    && (d.chainId === 10143 || d.chainId === 31337) && claimInteger(d.amountWei) && BigInt(d.amountWei) > 0n
    && walletAddress(d.recipientAddress) && d.recipientAddress === d.recipientAddress.toLowerCase()
    && claimInteger(d.issuedAt, 64) && BigInt(d.issuedAt) > 0n && claimInteger(d.expiresAt, 64)
    && BigInt(d.expiresAt) > BigInt(d.issuedAt) && BigInt(d.expiresAt) - BigInt(d.issuedAt) <= 86400n
    && claimTimestamp(d.preparedAt));
  claimRecordedTimes(d);
  requirePortal(d.recipientConsentRecordedAt === null || Date.parse(d.recipientConsentRecordedAt as string) >= Date.parse(d.preparedAt));
  return { ...d } as AthleteRewardClaim;
}
export function decodeAthleteRewardClaims(value: unknown, after: string | null = null): AthleteRewardClaimsPage {
  requirePortal(after === null || uuid(after));
  const page = record(value, ["items", "nextCursor"]);
  requirePortal(Array.isArray(page.items) && page.items.length <= 50);
  let previous = after;
  const items = page.items.map(raw => {
    const item = decodeAthleteRewardClaim(raw); requirePortal(previous === null || item.intentId > previous);
    previous = item.intentId; return item;
  });
  requirePortal(page.nextCursor === null || (uuid(page.nextCursor) && items.length === 50 && page.nextCursor === previous));
  return { items, nextCursor: page.nextCursor as string | null };
}
