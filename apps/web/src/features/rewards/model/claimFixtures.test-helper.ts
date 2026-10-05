import { privateKeyToAccount } from "viem/accounts";
import { rewardClaimMessages } from "@raceson/rewards-chain/claims";
import type { AthleteRewardClaim } from "./athleteClaims";

// Publicly reproducible synthetic signer. Never use for real funds or accounts.
export const claimSigner = privateKeyToAccount(`0x${992n.toString(16).padStart(64, "0")}`);
export const claimId = (n: number) => `79000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export function claimFixture(chainId: 31337 | 10143 = 31337, now = Math.floor(Date.now() / 1000)) {
  const history: AthleteRewardClaim = { intentId: claimId(1), programmeId: claimId(2), campaignId: claimId(3), entitlementId: claimId(4),
    scopeKey: claimId(5), pot: "race", chainId, amountWei: "1000000000000000001", recipientAddress: claimSigner.address.toLowerCase() as `0x${string}`,
    issuedAt: String(now - 60), expiresAt: String(now + 600), preparedAt: new Date((now - 60) * 1000).toISOString(),
    recipientConsentRecordedAt: null, operatorApprovalRecordedAt: null };
  const context = { chainId, environment: chainId === 31337 ? "local-simulation" as const : "monad-testnet" as const,
    verifyingContract: `0x${"cd".repeat(20)}` as const };
  const signing = rewardClaimMessages(context, { entitlementId: `0x${"ab".repeat(32)}`, recipient: claimSigner.address,
    amount: BigInt(history.amountWei), pot: "race", nonce: 2n, issuedAt: BigInt(history.issuedAt), expiresAt: BigInt(history.expiresAt),
    allocationDigest: `0x${"cd".repeat(32)}` }).consent;
  const summary = { intentId: history.intentId, entitlementId: history.entitlementId, campaignId: history.campaignId, chainId,
    verifyingContract: signing.domain.verifyingContract, amountWei: history.amountWei, pot: history.pot, recipientAddress: signing.message.recipient,
    issuedAt: history.issuedAt, expiresAt: history.expiresAt, recipientConsentRecordedAt: null, operatorApprovalRecordedAt: null };
  const raw = { ...summary, state: "awaiting_consent", signing: JSON.parse(JSON.stringify(signing, (_key, v: unknown) => typeof v === "bigint" ? v.toString() : v)),
    observation: { blockNumber: "99", blockHash: `0x${"ef".repeat(32)}`, timestamp: String(now) } };
  const recordedAt = new Date(now * 1000).toISOString();
  const recorded = { ...summary, state: "consent_recorded", recipientConsentRecordedAt: recordedAt, signing: null, observation: null };
  const receipt = { proofId: claimId(6), intentId: history.intentId, role: "recipient" as const, recordedAt, expiresAt: history.expiresAt };
  return { history, raw, recorded, receipt, signing };
}
