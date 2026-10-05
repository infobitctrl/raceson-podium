import { concatHex, getAddress, hashTypedData, recoverTypedDataAddress, type Address, type Hex } from "viem";
import { safeRewardConsentMessageV3 } from "./campaign-v3.js";
import { demand } from "./validation.js";

export type ClubConsentSelectionV3 = {
  chainId: 31337 | 10143; uploadId: string; requestId: string; claimId: string;
  entitlementId: Hex; campaignAddress: Address; recipientAddress: Address;
  amountWei: string; pot: "race" | "league";
};
export type ClubConsentRecordV3 = Pick<ClubConsentSelectionV3,
  "chainId" | "uploadId" | "requestId" | "claimId" | "entitlementId" | "recipientAddress" | "amountWei"> & {
  schema: "raceson-club-claim-record-v3"; issuedAt: string; expiresAt: string;
  recipientConsented: boolean; operatorApproved: boolean;
};
type Binding = { schema: "raceson-club-consent-binding-v3"; campaignAddress: Address; pot: "race" | "league";
  nonce: string; allocationDigest: Hex };
export type ClubConsentReviewV3 = ClubConsentRecordV3 & (
  { status: "already_recorded" } |
  { status: "signature_required"; role: "recipient"; binding: Binding;
    observation: { blockNumber: string; blockHash: Hex; timestamp: string };
    typedData: ReturnType<typeof safeRewardConsentMessageV3> }
);
const valid = (v: unknown) => demand(v, "invalid_reward_club_consent_v3");
function object(v: unknown, keys: readonly string[]) {
  valid(v !== null && typeof v === "object" && !Array.isArray(v));
  const d = Object.getOwnPropertyDescriptors(v);
  valid(Object.getOwnPropertySymbols(v).length === 0 && Object.keys(d).length === keys.length
    && keys.every(k => d[k] && "value" in d[k]));
  return Object.fromEntries(keys.map(k => [k, d[k].value])) as Record<string, unknown>;
}
const uuid = (v: unknown) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
const hex = (v: unknown, n: number): v is Hex => typeof v === "string" && new RegExp(`^0x[0-9a-f]{${n}}$`).test(v) && BigInt(v) > 0n;
const uint = (v: unknown, bits = 256): v is string => typeof v === "string" && /^(0|[1-9][0-9]{0,77})$/.test(v) && BigInt(v) < (1n << BigInt(bits));
const selectionKeys = ["chainId", "uploadId", "requestId", "claimId", "entitlementId", "campaignAddress", "recipientAddress", "amountWei", "pot"] as const;
const recordKeys = ["schema", "chainId", "uploadId", "requestId", "claimId", "entitlementId", "recipientAddress", "amountWei", "issuedAt", "expiresAt", "recipientConsented", "operatorApproved"] as const;

/** Capture an independently selected award, not an API-supplied wallet instruction. */
export function decodeClubConsentSelectionV3(raw: unknown): ClubConsentSelectionV3 {
  const s = object(raw, selectionKeys);
  valid((s.chainId === 31337 || s.chainId === 10143) && [s.uploadId, s.requestId, s.claimId].every(uuid)
    && hex(s.entitlementId, 64) && hex(s.campaignAddress, 40) && hex(s.recipientAddress, 40)
    && uint(s.amountWei) && BigInt(s.amountWei as string) > 0n && (s.pot === "race" || s.pot === "league"));
  return s as ClubConsentSelectionV3;
}
function metadata(raw: Record<string, unknown>, selected: ClubConsentSelectionV3): ClubConsentRecordV3 {
  const r = object(Object.fromEntries(recordKeys.map(k => [k, raw[k]])), recordKeys);
  valid(r.schema === "raceson-club-claim-record-v3" && ["chainId", "uploadId", "requestId", "claimId", "entitlementId", "recipientAddress", "amountWei"]
    .every(k => r[k] === selected[k as keyof ClubConsentSelectionV3]));
  valid(uint(r.issuedAt, 64) && uint(r.expiresAt, 64) && BigInt(r.issuedAt as string) > 0n
    && BigInt(r.expiresAt as string) > BigInt(r.issuedAt as string) && BigInt(r.expiresAt as string) - BigInt(r.issuedAt as string) <= 86400n
    && typeof r.recipientConsented === "boolean" && typeof r.operatorApproved === "boolean" && (!r.operatorApproved || r.recipientConsented));
  return r as ClubConsentRecordV3;
}
export function decodeClubConsentRecordV3(raw: unknown, selected: ClubConsentSelectionV3): ClubConsentRecordV3 {
  return metadata(object(raw, recordKeys), decodeClubConsentSelectionV3(selected));
}
/** Rebuild domain-4 ReceiveReward and its SafeMessage locally. Opaque bytes
 * from an API can never select another domain, contract, value or operation. */
export function decodeClubConsentReviewV3(raw: unknown, selection: ClubConsentSelectionV3): ClubConsentReviewV3 {
  const selected = decodeClubConsentSelectionV3(selection);
  valid(raw !== null && typeof raw === "object");
  const status = Object.getOwnPropertyDescriptor(raw, "status")?.value;
  valid(status === "signature_required" || status === "already_recorded");
  const r = object(raw, [...recordKeys, "status", ...(status === "signature_required" ? ["role", "binding", "observation", "typedData"] : [])]);
  const record = metadata(r, selected);
  if (status === "already_recorded") { valid(record.recipientConsented); return { ...record, status }; }
  valid(r.role === "recipient" && !record.recipientConsented && !record.operatorApproved);
  const b = object(r.binding, ["schema", "campaignAddress", "pot", "nonce", "allocationDigest"]);
  valid(b.schema === "raceson-club-consent-binding-v3" && b.campaignAddress === selected.campaignAddress && b.pot === selected.pot
    && uint(b.nonce) && BigInt(b.nonce as string) < (1n << 256n) - 1n && hex(b.allocationDigest, 64));
  const binding = b as Binding;
  const typedData = safeRewardConsentMessageV3({ chainId: selected.chainId, environment: selected.chainId === 31337 ? "local-simulation" : "monad-testnet",
    verifyingContract: selected.campaignAddress }, { entitlementId: selected.entitlementId, recipient: selected.recipientAddress,
    amount: BigInt(selected.amountWei), pot: selected.pot, nonce: BigInt(binding.nonce), issuedAt: BigInt(record.issuedAt),
    expiresAt: BigInt(record.expiresAt), allocationDigest: binding.allocationDigest });
  const t = object(r.typedData, ["domain", "types", "primaryType", "message"]), domain = object(t.domain, ["chainId", "verifyingContract"]);
  const types = object(t.types, ["SafeMessage"]), message = object(t.message, ["message"]);
  valid(Array.isArray(types.SafeMessage) && types.SafeMessage.length === 1
    && Object.getOwnPropertyNames(types.SafeMessage).length === 2 && Object.getOwnPropertySymbols(types.SafeMessage).length === 0);
  const field = object(Object.getOwnPropertyDescriptor(types.SafeMessage, "0")?.value, ["name", "type"]);
  valid(field.name === "message" && field.type === "bytes" && t.primaryType === "SafeMessage"
    && domain.chainId === selected.chainId && typeof domain.verifyingContract === "string"
    && domain.verifyingContract.toLowerCase() === selected.recipientAddress && message.message === typedData.message.message);
  const o = object(r.observation, ["blockNumber", "blockHash", "timestamp"]);
  valid(uint(o.blockNumber) && BigInt(o.blockNumber as string) > 0n && hex(o.blockHash, 64) && uint(o.timestamp, 64)
    && BigInt(o.timestamp as string) >= BigInt(record.issuedAt) && BigInt(o.timestamp as string) < BigInt(record.expiresAt));
  return { ...record, status, role: "recipient", binding, typedData, observation: o as Extract<ClubConsentReviewV3, { status: "signature_required" }>["observation"] };
}
export function clubConsentSigningJsonV3(review: Extract<ClubConsentReviewV3, { status: "signature_required" }>) {
  return JSON.stringify({ ...review.typedData, types: { EIP712Domain: [
    { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" }], ...review.typedData.types } });
}
export async function verifyClubOwnerSignatureV3(typedData: ReturnType<typeof safeRewardConsentMessageV3>, signer: Address, signature: unknown): Promise<Hex> {
  const address = getAddress(signer), message = structuredClone(typedData);
  valid(typeof signature === "string" && /^0x[0-9a-fA-F]{128}(1[bBcC])$/.test(signature));
  const normalized = (signature as string).toLowerCase() as Hex;
  const recovered = await recoverTypedDataAddress({ ...message, signature: normalized });
  valid(recovered.toLowerCase() === address.toLowerCase()); return normalized;
}
/** Encoding only: actual reviewed Safe owner membership/quorum is still
 * independently verified by EIP-1271 on the server and at payout. */
export async function combineClubOwnerSignaturesV3(typedData: ReturnType<typeof safeRewardConsentMessageV3>,
  inputs: readonly { signer: Address; signature: Hex }[]): Promise<Hex> {
  valid(inputs.length === 2);
  const fixed = inputs.map(p => ({ signer: getAddress(p.signer), signature: p.signature })).sort((a, b) => a.signer.toLowerCase().localeCompare(b.signer.toLowerCase()));
  valid(fixed[0].signer.toLowerCase() !== fixed[1].signer.toLowerCase());
  const message = structuredClone(typedData);
  return concatHex(await Promise.all(fixed.map(p => verifyClubOwnerSignatureV3(message, p.signer, p.signature))));
}
export const clubConsentDigestV3 = (review: Extract<ClubConsentReviewV3, { status: "signature_required" }>) => hashTypedData(review.typedData);
