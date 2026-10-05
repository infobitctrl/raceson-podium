import { parseRewardUnits, requireReward } from "./arithmetic.js";
import { parseRewardSourceTimestamp } from "./source-evidence.js";
import { rewardDistributionUuid as uuid } from "./distribution-view.js";

/** Exact server/browser read projections, never signing or chain authority. */
function demand(value: unknown): asserts value { requireReward(value, "invalid_reward_club_portal_document"); }
function object(value: unknown, keys: readonly string[]) {
  demand(value !== null && typeof value === "object" && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value)));
  const fields = Object.getOwnPropertyDescriptors(value);
  demand(!Object.getOwnPropertySymbols(value).length && Object.keys(fields).length === keys.length
    && keys.every(k => fields[k]?.enumerable && "value" in fields[k]));
  return value as Record<string, unknown>;
}
function amount(value: unknown, bits = 256): string {
  demand(typeof value === "string" && /^(0|[1-9][0-9]{0,77})$/.test(value));
  demand(parseRewardUnits(value, 0) < (1n << BigInt(bits))); return value;
}
function label(v: unknown): string | null {
  demand(v === null || (typeof v === "string" && v.length > 0 && v.trim() === v && [...v].length <= 256)); return v;
}
function address(v: unknown): `0x${string}` {
  demand(typeof v === "string" && /^0x[0-9a-f]{40}$/.test(v) && BigInt(v) > 1n); return v as `0x${string}`;
}
function hash(v: unknown): `0x${string}` {
  demand(typeof v === "string" && /^0x[0-9a-f]{64}$/.test(v) && BigInt(v) > 0n); return v as `0x${string}`;
}
function stamp(v: unknown): string { parseRewardSourceTimestamp(v); return v as string; }
const awardKeys = ["entitlementId", "programmeId", "campaignId", "clubId", "clubName", "scopeKey", "pot", "chainId", "amountWei", "roundNumber", "raceName"];
function award(d: Record<string, unknown>, chainId: 31337 | 10143) {
  demand((chainId === 31337 || chainId === 10143) && d.chainId === chainId && (d.pot === "race" || d.pot === "league"));
  demand(d.pot === "race" ? typeof d.roundNumber === "number" && Number.isInteger(d.roundNumber) && d.roundNumber >= 1 && d.roundNumber <= 5
    : d.scopeKey === "rounds-1-5" && d.roundNumber === null && d.raceName === null);
  const amountWei = amount(d.amountWei); demand(BigInt(amountWei) > 0n);
  return { entitlementId: uuid(d.entitlementId), programmeId: uuid(d.programmeId), campaignId: uuid(d.campaignId), clubId: uuid(d.clubId),
    clubName: label(d.clubName), scopeKey: d.pot === "race" ? uuid(d.scopeKey) : "rounds-1-5", pot: d.pot as "race" | "league", chainId,
    amountWei, roundNumber: d.roundNumber as number | null, raceName: label(d.raceName) };
}
export function decodeClubRewardAward(value: unknown, chainId: 31337 | 10143) { return award(object(value, awardKeys), chainId); }
export type ClubRewardAward = ReturnType<typeof decodeClubRewardAward>;
export function decodeClubRewardClaim(value: unknown, chainId: 31337 | 10143) {
  const d = object(value, [...awardKeys, "intentId", "recipientAddress", "issuedAt", "expiresAt", "preparedAt", "recipientConsentRecordedAt", "operatorApprovalRecordedAt"]);
  const issuedAt = amount(d.issuedAt, 64), expiresAt = amount(d.expiresAt, 64), preparedAt = stamp(d.preparedAt);
  demand(BigInt(issuedAt) > 0n && BigInt(expiresAt) > BigInt(issuedAt) && BigInt(expiresAt) - BigInt(issuedAt) <= 86400n);
  const recipientConsentRecordedAt = d.recipientConsentRecordedAt === null ? null : stamp(d.recipientConsentRecordedAt);
  const operatorApprovalRecordedAt = d.operatorApprovalRecordedAt === null ? null : stamp(d.operatorApprovalRecordedAt);
  demand(recipientConsentRecordedAt === null || parseRewardSourceTimestamp(recipientConsentRecordedAt) >= parseRewardSourceTimestamp(preparedAt));
  demand(operatorApprovalRecordedAt === null || (recipientConsentRecordedAt !== null
    && parseRewardSourceTimestamp(operatorApprovalRecordedAt) >= parseRewardSourceTimestamp(recipientConsentRecordedAt)));
  return { ...award(d, chainId), intentId: uuid(d.intentId), recipientAddress: address(d.recipientAddress), issuedAt, expiresAt,
    preparedAt, recipientConsentRecordedAt, operatorApprovalRecordedAt };
}
export type ClubRewardClaim = ReturnType<typeof decodeClubRewardClaim>;
export function decodeClubPortalPage<T>(value: unknown, after: string | null, decode: (v: unknown) => T, id: (v: T) => string) {
  const d = object(value, ["items", "nextCursor"]); demand(Array.isArray(d.items) && d.items.length <= 25);
  const fields = Object.getOwnPropertyDescriptors(d.items);
  demand(!Object.getOwnPropertySymbols(d.items).length && Object.keys(fields).length === d.items.length + 1);
  let previous = after === null ? null : uuid(after);
  const items = Array.from({ length: d.items.length }, (_, n) => {
    demand(fields[n]?.enumerable && "value" in fields[n]); const item = decode(fields[n].value), next = id(item);
    demand(previous === null || next > previous); previous = next; return item;
  });
  const nextCursor = d.nextCursor === null ? null : uuid(d.nextCursor);
  demand(nextCursor === null || (items.length === 25 && nextCursor === previous)); return { items, nextCursor };
}
const stages = ["no_confirmation", "queued", "processing", "submission_unconfirmed", "confirmed"] as const;
export function decodeClubRewardPayment(value: unknown, history: ClubRewardClaim) {
  const fixed = decodeClubRewardClaim(history, history.chainId), d = object(value, ["claim", "status", "receipt"]);
  const claim = decodeClubRewardClaim(d.claim, fixed.chainId);
  // Display labels and newly recorded proof timestamps may change; immutable
  // claim identity/economics/window cannot. This does not reverify signatures.
  for (const k of ["intentId", "programmeId", "campaignId", "entitlementId", "clubId", "scopeKey", "pot", "chainId", "amountWei", "recipientAddress", "issuedAt", "expiresAt", "preparedAt"] as const)
    demand(claim[k] === fixed[k]);
  demand(stages.some(s => s === d.status) && (d.status === "confirmed") === (d.receipt !== null));
  const status = d.status as typeof stages[number];
  if (d.receipt === null) return { claim, status, receipt: null };
  const r = object(d.receipt, ["transactionHash", "contractAddress", "blockNumber", "blockHash", "blockTimestamp", "logIndex", "safeReceivedLogIndex", "finalizedBlock", "recordedAt", "observedAt"]);
  const f = object(r.finalizedBlock, ["number", "hash", "timestamp"]);
  const blockNumber = amount(r.blockNumber), blockTimestamp = amount(r.blockTimestamp, 64), finalizedNumber = amount(f.number), finalizedTime = amount(f.timestamp);
  const blockHash = hash(r.blockHash), finalizedHash = hash(f.hash), recordedAt = stamp(r.recordedAt), observedAt = stamp(r.observedAt);
  demand(BigInt(blockNumber) > 0n && BigInt(blockNumber) <= BigInt(finalizedNumber) && BigInt(blockTimestamp) <= BigInt(finalizedTime)
    && BigInt(blockTimestamp) >= BigInt(claim.issuedAt) && BigInt(blockTimestamp) < BigInt(claim.expiresAt)
    && (blockNumber !== finalizedNumber || (blockHash === finalizedHash && blockTimestamp === finalizedTime))
    && typeof r.logIndex === "number" && Number.isSafeInteger(r.logIndex) && r.logIndex >= 0
    && typeof r.safeReceivedLogIndex === "number" && Number.isSafeInteger(r.safeReceivedLogIndex) && r.safeReceivedLogIndex === r.logIndex + 1
    && claim.operatorApprovalRecordedAt !== null && parseRewardSourceTimestamp(observedAt) >= parseRewardSourceTimestamp(claim.operatorApprovalRecordedAt)
    && parseRewardSourceTimestamp(recordedAt) >= parseRewardSourceTimestamp(observedAt));
  return { claim, status, receipt: { transactionHash: hash(r.transactionHash), contractAddress: address(r.contractAddress),
    blockNumber, blockHash, blockTimestamp, logIndex: r.logIndex, safeReceivedLogIndex: r.safeReceivedLogIndex,
    finalizedBlock: { number: finalizedNumber, hash: finalizedHash, timestamp: finalizedTime }, recordedAt, observedAt } };
}
export type ClubRewardPayment = ReturnType<typeof decodeClubRewardPayment>;
