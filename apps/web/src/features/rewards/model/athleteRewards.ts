import type { TranslationKey } from "@/shared/i18n/messages";
import type { AppLocale } from "@/shared/i18n/locales";

export type RewardAllocation = {
  entitlementId: string;
  campaignId: string;
  pot: "race" | "league";
  scopeKey: string;
  chainId: 10143 | 31337;
  environment: "testnet_pilot" | "local_simulation";
  athleteProfileId: string;
  identityChanged: boolean;
  amountWei: string;
  ageStatus: "minor" | "unknown" | "unverified_adult";
};
export type RewardAllocationsPage = { items: RewardAllocation[]; nextCursor: string | null };
export type WalletChallenge = {
  challengeId: string; address: `0x${string}`; chainId: 10143 | 31337;
  message: string; expiresAt: string; alreadyVerified: boolean;
};
export type WalletProof = {
  proofId: string; address: `0x${string}`; chainId: 10143 | 31337;
  verifiedAt: string; proofKind: "eip191_address_control";
};

export class RewardPortalError extends Error {
  constructor(public readonly code: string) { super(code); }
}
const uuid = (value: unknown): value is string => typeof value === "string"
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
export const walletAddress = (value: unknown): value is `0x${string}` => typeof value === "string"
  && /^0x[0-9a-fA-F]{40}$/.test(value) && BigInt(value) !== 0n;
export function requirePortal(condition: unknown): asserts condition {
  if (!condition) throw new RewardPortalError("invalid_response");
}
function record(value: unknown, keys: string[]): Record<string, unknown> {
  requirePortal(value !== null && typeof value === "object" && !Array.isArray(value));
  const result = value as Record<string, unknown>;
  requirePortal(Object.keys(result).length === keys.length && keys.every(key => Object.hasOwn(result, key)));
  return result;
}
export { uuid as rewardUuid, record as rewardRecord };
function amount(value: unknown): value is string {
  return typeof value === "string" && /^[1-9][0-9]{0,77}$/.test(value) && BigInt(value) < 2n ** 256n;
}
export function decodeAllocations(value: unknown, after: string | null = null): RewardAllocationsPage {
  requirePortal(after === null || uuid(after));
  const page = record(value, ["items", "nextCursor"]);
  requirePortal(Array.isArray(page.items) && page.items.length <= 50);
  let previous = after;
  const items = page.items.map(raw => {
    const item = record(raw, ["entitlementId", "campaignId", "pot", "scopeKey", "chainId", "environment", "athleteProfileId", "identityChanged", "amountWei", "ageStatus"]);
    requirePortal(uuid(item.entitlementId) && uuid(item.campaignId) && uuid(item.athleteProfileId)
      && (previous === null || item.entitlementId > previous) && amount(item.amountWei)
      && typeof item.identityChanged === "boolean" && ["minor", "unknown", "unverified_adult"].includes(String(item.ageStatus))
      && ((item.pot === "race" && uuid(item.scopeKey)) || (item.pot === "league" && item.scopeKey === "rounds-1-5"))
      && ((item.chainId === 10143 && item.environment === "testnet_pilot") || (item.chainId === 31337 && item.environment === "local_simulation")));
    previous = item.entitlementId;
    return { ...item } as RewardAllocation;
  });
  requirePortal(page.nextCursor === null || (uuid(page.nextCursor) && items.length === 50 && page.nextCursor === previous));
  return { items, nextCursor: page.nextCursor as string | null };
}
export function decodeWalletChallenge(value: unknown, address: string): WalletChallenge {
  const c = record(value, ["challengeId", "address", "chainId", "message", "expiresAt", "alreadyVerified"]);
  requirePortal(uuid(c.challengeId) && walletAddress(c.address) && c.address.toLowerCase() === address.toLowerCase()
    && (c.chainId === 10143 || c.chainId === 31337) && typeof c.message === "string" && c.message.length <= 2048
    && typeof c.expiresAt === "string" && Number.isFinite(Date.parse(c.expiresAt)) && typeof c.alreadyVerified === "boolean");
  return { ...c } as WalletChallenge;
}
export function decodeWalletProof(value: unknown, challenge: WalletChallenge): WalletProof {
  const p = record(value, ["proofId", "address", "chainId", "verifiedAt", "proofKind"]);
  requirePortal(uuid(p.proofId) && walletAddress(p.address) && p.address.toLowerCase() === challenge.address.toLowerCase()
    && p.chainId === challenge.chainId && p.proofKind === "eip191_address_control"
    && typeof p.verifiedAt === "string" && Number.isFinite(Date.parse(p.verifiedAt))
    && Date.parse(p.verifiedAt) < Date.parse(challenge.expiresAt)
    && Date.parse(p.verifiedAt) >= Date.parse(challenge.expiresAt) - 600_000);
  return { ...p } as WalletProof;
}

/** Never round test MON through a floating-point Number, including tiny awards. */
export function formatTestMon(value: string, locale: AppLocale): string {
  requirePortal(amount(value));
  const wei = BigInt(value);
  const whole = new Intl.NumberFormat(locale === "hr" ? "hr-HR" : "en-GB", { maximumFractionDigits: 0 }).format(wei / 10n ** 18n);
  const fraction = (wei % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "");
  return `${whole}${fraction ? `${locale === "hr" ? "," : "."}${fraction}` : ""}`;
}
export function rewardErrorKey(error: unknown): TranslationKey {
  const code = error !== null && typeof error === "object" && "code" in error ? error.code : null;
  const status = error !== null && typeof error === "object" && "status" in error ? error.status : null;
  if (status === 401) return "rewards.error.signIn";
  if (code === "reward_claim_not_found") return "rewards.claim.error.notFound";
  if (code === "claim_wrong_wallet" || code === "invalid_reward_claim_signature") return "rewards.claim.error.wallet";
  if (code === "claim_expired" || code === "reward_claim_not_live") return "rewards.claim.error.expired";
  if (code === "claim_refresh_required" || code === "reward_claim_observation_stale") return "rewards.claim.error.refresh";
  if (code === "reward_destination_withdraw_first") return "rewards.destination.error.withdrawFirst";
  if (code === "reward_destination_profile_required") return "rewards.destination.error.profile";
  if (code === "reward_destination_proof_required") return "rewards.destination.error.proof";
  if (code === "reward_destination_not_found") return "rewards.destination.error.notFound";
  if (status === 409) return "rewards.claim.error.held";
  if (status === 404) return "rewards.unavailable";
  if (status === 429) return "rewards.error.rateLimit";
  if (code === 4001) return "rewards.error.rejected";
  if (code === "wallet_changed") return "rewards.error.walletChanged";
  if (code === "wrong_network") return "rewards.error.wrongNetwork";
  if (code === "wrong_local_network") return "rewards.error.wrongLocalNetwork";
  if (code === "reward_wallet_challenge_expired" || code === "challenge_expired") return "rewards.error.expired";
  return "rewards.error.generic";
}
