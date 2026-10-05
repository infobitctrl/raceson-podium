import { receiveRewardTypes, rewardClaimMessages } from "@raceson/rewards-chain/claims";
import { getAddress } from "viem";
import { requirePortal, rewardRecord as record, rewardUuid as uuid, walletAddress } from "./athleteRewards";
import { claimInteger as uint, claimTimestamp, claimRecordedTimes, decodeAthleteRewardClaim, type AthleteRewardClaim } from "./athleteClaims";

type Signing = ReturnType<typeof rewardClaimMessages>["consent"];
type Summary = Pick<AthleteRewardClaim, "intentId" | "entitlementId" | "campaignId" | "chainId" | "amountWei" | "pot"
  | "recipientAddress" | "issuedAt" | "expiresAt" | "recipientConsentRecordedAt" | "operatorApprovalRecordedAt">
  & { verifyingContract: `0x${string}` };
export type AthleteClaimReview = Summary & ({ state: "consent_recorded"; signing: null; observation: null }
  | { state: "awaiting_consent"; signing: Signing; observation: { blockNumber: string; blockHash: `0x${string}`; timestamp: string } });
export type AthleteConsentReceipt = { proofId: string; intentId: string; role: "recipient"; recordedAt: string; expiresAt: string };
const bytes32 = (v: unknown): v is `0x${string}` => typeof v === "string" && /^0x[0-9a-f]{64}$/.test(v);

/** An API payload is data, never an arbitrary signing instruction. Rebuild the
 * sole supported recipient message with the shared contract protocol. */
export function decodeAthleteClaimReview(value: unknown, history: AthleteRewardClaim): AthleteClaimReview {
  history = decodeAthleteRewardClaim(history);
  const common = ["intentId", "entitlementId", "campaignId", "chainId", "amountWei", "pot", "recipientAddress", "issuedAt", "expiresAt"] as const;
  const d = record(value, [...common, "verifyingContract", "recipientConsentRecordedAt", "operatorApprovalRecordedAt", "state", "signing", "observation"]);
  requirePortal(common.every(key => key === "recipientAddress" || d[key] === history[key]) && walletAddress(d.verifyingContract)
    && walletAddress(d.recipientAddress) && getAddress(d.recipientAddress).toLowerCase() === history.recipientAddress);
  claimRecordedTimes(d);
  for (const key of ["recipientConsentRecordedAt", "operatorApprovalRecordedAt"] as const) {
    requirePortal(history[key] === null || history[key] === d[key]);
  }
  requirePortal(d.recipientConsentRecordedAt === null || Date.parse(d.recipientConsentRecordedAt as string) >= Date.parse(history.preparedAt));
  const summary: Summary = { intentId: history.intentId, entitlementId: history.entitlementId, campaignId: history.campaignId,
    chainId: history.chainId, amountWei: history.amountWei, pot: history.pot, recipientAddress: history.recipientAddress,
    issuedAt: history.issuedAt, expiresAt: history.expiresAt, verifyingContract: getAddress(d.verifyingContract),
    recipientConsentRecordedAt: d.recipientConsentRecordedAt as string | null, operatorApprovalRecordedAt: d.operatorApprovalRecordedAt as string | null };
  if (d.state === "consent_recorded") {
    requirePortal(d.recipientConsentRecordedAt !== null && d.signing === null && d.observation === null);
    return { ...summary, state: "consent_recorded", signing: null, observation: null };
  }
  requirePortal(d.state === "awaiting_consent" && d.recipientConsentRecordedAt === null && d.operatorApprovalRecordedAt === null);
  const s = record(d.signing, ["domain", "primaryType", "types", "message"]);
  const domain = record(s.domain, ["name", "version", "chainId", "verifyingContract"]);
  const types = record(s.types, ["ReceiveReward"]);
  requirePortal(domain.name === "RacesOnRewardCampaign" && domain.version === "2" && domain.chainId === history.chainId
    && walletAddress(domain.verifyingContract) && getAddress(domain.verifyingContract) === summary.verifyingContract && s.primaryType === "ReceiveReward"
    && Array.isArray(types.ReceiveReward) && types.ReceiveReward.length === receiveRewardTypes.ReceiveReward.length);
  types.ReceiveReward.forEach((raw, index) => {
    const f = record(raw, ["name", "type"]), expected = receiveRewardTypes.ReceiveReward[index];
    requirePortal(f.name === expected.name && f.type === expected.type);
  });
  const m = record(s.message, ["entitlementId", "recipient", "amount", "pot", "nonce", "issuedAt", "expiresAt", "allocationDigest"]);
  requirePortal(bytes32(m.entitlementId) && bytes32(m.allocationDigest) && uint(m.nonce)
    && walletAddress(m.recipient) && getAddress(m.recipient).toLowerCase() === history.recipientAddress && m.amount === history.amountWei && m.pot === (history.pot === "race" ? 0 : 1)
    && m.issuedAt === history.issuedAt && m.expiresAt === history.expiresAt);
  const observation = record(d.observation, ["blockNumber", "blockHash", "timestamp"]);
  requirePortal(uint(observation.blockNumber) && bytes32(observation.blockHash) && uint(observation.timestamp, 64)
    && BigInt(observation.timestamp) >= BigInt(history.issuedAt) && BigInt(observation.timestamp) < BigInt(history.expiresAt));
  const signing = rewardClaimMessages({ environment: history.chainId === 31337 ? "local-simulation" : "monad-testnet",
    chainId: history.chainId, verifyingContract: summary.verifyingContract }, {
    entitlementId: m.entitlementId, recipient: history.recipientAddress, amount: BigInt(history.amountWei), pot: history.pot,
    nonce: BigInt(m.nonce), issuedAt: BigInt(history.issuedAt), expiresAt: BigInt(history.expiresAt), allocationDigest: m.allocationDigest,
  }).consent;
  return { ...summary, state: "awaiting_consent", signing, observation: { blockNumber: observation.blockNumber,
    blockHash: observation.blockHash, timestamp: observation.timestamp } };
}
export function decodeAthleteConsentReceipt(value: unknown, review: AthleteClaimReview): AthleteConsentReceipt {
  const d = record(value, ["proofId", "intentId", "role", "recordedAt", "expiresAt"]);
  requirePortal(uuid(d.proofId) && d.intentId === review.intentId && d.role === "recipient" && claimTimestamp(d.recordedAt)
    && d.expiresAt === review.expiresAt);
  return { ...d } as AthleteConsentReceipt;
}
/** Only this locally defined EIP-712 domain shape is supplied to a wallet. */
export function athleteConsentSigningJson(signing: Signing): string {
  return JSON.stringify({ ...signing, types: { EIP712Domain: [
    { name: "name", type: "string" }, { name: "version", type: "string" },
    { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" },
  ], ReceiveReward: receiveRewardTypes.ReceiveReward } }, (_key, v: unknown) => typeof v === "bigint" ? v.toString() : v);
}
