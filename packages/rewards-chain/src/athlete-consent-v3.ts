import { hashTypedData, type Address, type Hex } from "viem";
import { rewardClaimMessagesV3, verifyRewardClaimEoaProofV3 } from "./campaign-v3.js";
import { receiveRewardTypes, type RewardClaim } from "./claims.js";
import { demand } from "./validation.js";

export type AthleteConsentSelectionV3 = {
  chainId: 31337 | 10143; uploadId: string; destinationId: string; claimId: string;
  entitlementId: Hex; campaignAddress: Address; recipientAddress: Address;
  amountWei: string; pot: "race" | "league";
};
export type AthleteConsentRecordV3 = Omit<AthleteConsentSelectionV3, "campaignAddress" | "pot"> & {
  schema: "raceson-athlete-claim-record-v3"; issuedAt: string; expiresAt: string;
  recipientConsented: boolean; operatorApproved: boolean;
};
export type AthleteConsentReviewV3 = AthleteConsentRecordV3 & (
  { status: "already_recorded" } |
  { status: "signature_required"; role: "recipient";
    observation: { blockNumber: string; blockHash: Hex; timestamp: string };
    typedData: ReturnType<typeof rewardClaimMessagesV3>["consent"] }
);
type SigningReview = Extract<AthleteConsentReviewV3, { status: "signature_required" }>;
const valid = (v: unknown) => demand(v, "invalid_reward_athlete_consent_v3");
function object(v: unknown, keys: readonly string[]) {
  valid(v !== null && typeof v === "object" && !Array.isArray(v));
  const d = Object.getOwnPropertyDescriptors(v);
  valid(Object.getOwnPropertySymbols(v).length === 0 && Object.keys(d).length === keys.length
    && keys.every(k => d[k] && "value" in d[k]));
  return Object.fromEntries(keys.map(k => [k, d[k].value])) as Record<string, unknown>;
}
const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
const hex = (v: unknown, n: number): v is Hex => typeof v === "string" && new RegExp(`^0x[0-9a-f]{${n}}$`).test(v) && BigInt(v) > 0n;
const uint = (v: unknown, bits = 256): v is string => typeof v === "string" && /^(0|[1-9][0-9]{0,77})$/.test(v) && BigInt(v) < (1n << BigInt(bits));
// A wire decimal or a previously decoded bigint, never a lossy JS number.
function typedUint(v: unknown, bits = 256) {
  valid(uint(v, bits) || typeof v === "bigint" && v >= 0n && v < (1n << BigInt(bits)));
  return BigInt(v as string | bigint);
}
const selectionKeys = ["chainId", "uploadId", "destinationId", "claimId", "entitlementId", "campaignAddress", "recipientAddress", "amountWei", "pot"] as const;
const recordKeys = ["schema", "chainId", "uploadId", "destinationId", "claimId", "entitlementId", "recipientAddress", "amountWei", "issuedAt", "expiresAt", "recipientConsented", "operatorApproved"] as const;

/** Must come from the displayed award and recorded destination, not merely the signing response. */
export function decodeAthleteConsentSelectionV3(raw: unknown): AthleteConsentSelectionV3 {
  const s = object(raw, selectionKeys);
  valid((s.chainId === 31337 || s.chainId === 10143) && [s.uploadId, s.destinationId, s.claimId].every(uuid)
    && hex(s.entitlementId, 64) && hex(s.campaignAddress, 40) && hex(s.recipientAddress, 40)
    && uint(s.amountWei) && BigInt(s.amountWei as string) > 0n && (s.pot === "race" || s.pot === "league"));
  return s as AthleteConsentSelectionV3;
}
function record(raw: unknown): AthleteConsentRecordV3 {
  const r = object(raw, recordKeys);
  valid(r.schema === "raceson-athlete-claim-record-v3" && (r.chainId === 31337 || r.chainId === 10143)
    && [r.claimId, r.uploadId, r.destinationId].every(uuid) && hex(r.entitlementId, 64) && hex(r.recipientAddress, 40)
    && uint(r.amountWei) && BigInt(r.amountWei as string) > 0n
    && uint(r.issuedAt, 64) && uint(r.expiresAt, 64) && BigInt(r.issuedAt as string) > 0n
    && BigInt(r.expiresAt as string) > BigInt(r.issuedAt as string) && BigInt(r.expiresAt as string) - BigInt(r.issuedAt as string) <= 86400n
    && typeof r.recipientConsented === "boolean" && typeof r.operatorApproved === "boolean" && (!r.operatorApproved || r.recipientConsented));
  return r as AthleteConsentRecordV3;
}
export function decodeAthleteConsentRecordV3(raw: unknown, selection: AthleteConsentSelectionV3) {
  const r = record(raw), selected = decodeAthleteConsentSelectionV3(selection);
  valid(["chainId", "uploadId", "destinationId", "claimId", "entitlementId", "recipientAddress", "amountWei"]
    .every(k => r[k as keyof AthleteConsentRecordV3] === selected[k as keyof AthleteConsentSelectionV3]));
  return r;
}
/** Strict own-history pagination. These flags are not live claimability or payment status. */
export function decodeOwnAthleteClaimsV3(raw: unknown, chainId: 31337 | 10143, after: string | null = null) {
  valid((chainId === 31337 || chainId === 10143) && (after === null || uuid(after)));
  const p = object(raw, ["schema", "chainId", "items", "nextCursor"]);
  valid(p.schema === "raceson-own-claims-v3" && p.chainId === chainId && Array.isArray(p.items));
  const source = p.items as unknown[];
  valid(source.length <= 50 && Object.getOwnPropertyNames(source).length === source.length + 1 && Object.getOwnPropertySymbols(source).length === 0);
  let previous = after;
  const items = Array.from({ length: source.length }, (_, n) => {
    const r = record(Object.getOwnPropertyDescriptor(source, String(n))?.value);
    valid(r.chainId === chainId && (previous === null || r.claimId > previous)); previous = r.claimId; return r;
  });
  valid(p.nextCursor === null || uuid(p.nextCursor) && items.length === 50 && p.nextCursor === previous);
  return { schema: "raceson-own-claims-v3" as const, chainId, items, nextCursor: p.nextCursor as string | null };
}
/** Reconstruct only ReceiveReward domain 4. No operator authorization, SafeTx,
 * opaque wallet instruction or spending approval can cross this boundary. */
export function decodeAthleteConsentReviewV3(raw: unknown, selection: AthleteConsentSelectionV3): AthleteConsentReviewV3 {
  const selected = decodeAthleteConsentSelectionV3(selection);
  valid(raw !== null && typeof raw === "object");
  const status = Object.getOwnPropertyDescriptor(raw, "status")?.value;
  valid(status === "signature_required" || status === "already_recorded");
  const r = object(raw, [...recordKeys, "status", ...(status === "signature_required" ? ["role", "observation", "typedData"] : [])]);
  const metadata = decodeAthleteConsentRecordV3(Object.fromEntries(recordKeys.map(k => [k, r[k]])), selected);
  if (status === "already_recorded") { valid(metadata.recipientConsented); return { ...metadata, status }; }
  valid(r.role === "recipient" && !metadata.recipientConsented && !metadata.operatorApproved);
  const t = object(r.typedData, ["domain", "types", "primaryType", "message"]);
  const domain = object(t.domain, ["name", "version", "chainId", "verifyingContract"]);
  const types = object(t.types, ["ReceiveReward"]), fields = types.ReceiveReward;
  valid(Array.isArray(fields) && fields.length === receiveRewardTypes.ReceiveReward.length
    && Object.getOwnPropertyNames(fields).length === fields.length + 1 && Object.getOwnPropertySymbols(fields).length === 0);
  receiveRewardTypes.ReceiveReward.forEach((expected, n) => {
    const field = object(Object.getOwnPropertyDescriptor(fields, String(n))?.value, ["name", "type"]);
    valid(field.name === expected.name && field.type === expected.type);
  });
  valid(domain.name === "RacesOnRewardCampaign" && domain.version === "4" && domain.chainId === selected.chainId
    && typeof domain.verifyingContract === "string" && domain.verifyingContract.toLowerCase() === selected.campaignAddress
    && t.primaryType === "ReceiveReward");
  const m = object(t.message, receiveRewardTypes.ReceiveReward.map(f => f.name));
  valid(m.entitlementId === selected.entitlementId && typeof m.recipient === "string" && m.recipient.toLowerCase() === selected.recipientAddress
    && typedUint(m.amount) === BigInt(selected.amountWei) && m.pot === (selected.pot === "race" ? 0 : 1)
    && typedUint(m.issuedAt, 64) === BigInt(metadata.issuedAt) && typedUint(m.expiresAt, 64) === BigInt(metadata.expiresAt)
    && hex(m.allocationDigest, 64));
  const nonce = typedUint(m.nonce); valid(nonce < (1n << 256n) - 1n);
  const claim: RewardClaim = { entitlementId: selected.entitlementId, recipient: selected.recipientAddress, amount: BigInt(selected.amountWei),
    pot: selected.pot, nonce, issuedAt: BigInt(metadata.issuedAt), expiresAt: BigInt(metadata.expiresAt), allocationDigest: m.allocationDigest as Hex };
  const typedData = rewardClaimMessagesV3({ chainId: selected.chainId, environment: selected.chainId === 31337 ? "local-simulation" : "monad-testnet",
    verifyingContract: selected.campaignAddress }, claim).consent;
  const o = object(r.observation, ["blockNumber", "blockHash", "timestamp"]);
  valid(uint(o.blockNumber) && BigInt(o.blockNumber as string) > 0n && hex(o.blockHash, 64) && uint(o.timestamp, 64)
    && BigInt(o.timestamp as string) >= claim.issuedAt && BigInt(o.timestamp as string) < claim.expiresAt);
  return { ...metadata, status, role: "recipient", typedData, observation: o as SigningReview["observation"] };
}
export function athleteConsentSigningJsonV3(review: SigningReview) {
  return JSON.stringify({ ...review.typedData, types: { EIP712Domain: [
    { name: "name", type: "string" }, { name: "version", type: "string" },
    { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" }], ...review.typedData.types } },
  (_key, value) => typeof value === "bigint" ? value.toString() : value);
}
export async function verifyAthleteConsentSignatureV3(review: SigningReview, signature: Hex): Promise<Hex> {
  const { domain, message: m } = review.typedData;
  const proof = await verifyRewardClaimEoaProofV3({ chainId: review.chainId, environment: review.chainId === 31337 ? "local-simulation" : "monad-testnet",
    verifyingContract: domain.verifyingContract }, { ...m, pot: m.pot === 0 ? "race" : "league" }, "recipient", m.recipient, signature);
  return proof.signature;
}
export const athleteConsentDigestV3 = (review: SigningReview) => hashTypedData(review.typedData);
