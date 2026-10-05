/** Browser-safe, metadata-only publication view. A saved publication is not an
 * activation receipt or recipient consent. Historical imports need their own adapter. */
import { parseRewardSourceTimestamp as micros } from "./source-evidence.js";
function check(v: unknown): asserts v { if (!v) throw Error("invalid_reward_round_publication"); }
function object(v: unknown, keys: string[]) {
  check(v && typeof v === "object" && !Array.isArray(v)); const fields = Object.getOwnPropertyDescriptors(v);
  check(Reflect.ownKeys(v).length === keys.length && keys.every(k => fields[k]?.enumerable && "value" in fields[k]!));
  return Object.fromEntries(keys.map(k => [k, fields[k]!.value])) as Record<string, unknown>;
}
const uuid = (v: unknown) => { check(typeof v === "string" && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(v)
  && v !== "00000000-0000-0000-0000-000000000000"); return v; };
const hash = (v: unknown) => { check(typeof v === "string" && /^[0-9a-f]{64}$/.test(v)); return v; };
const time = (v: unknown) => { check(typeof v === "string"); micros(v); return v; };
export type RoundPublicationScopeV3 = { chainId: number; draftId: string; slot: number; approvalId: string; uploadId: string; packageHash: string };
export function decodeRoundPublicationChangeV3(value: unknown) {
  const r = object(value, ["action", "requestId", "reviewId", "packageHash"]);
  check(r.action === "start" || r.action === "publish");
  check(r.action === "start" ? r.reviewId === null : r.reviewId !== null);
  return { action: r.action, requestId: uuid(r.requestId), reviewId: r.reviewId === null ? null : uuid(r.reviewId), packageHash: hash(r.packageHash) };
}
export type RoundPublicationChangeV3 = ReturnType<typeof decodeRoundPublicationChangeV3>;
export function decodeRoundPublicationV3(value: unknown, scope: RoundPublicationScopeV3) {
  check([31337, 10143].includes(scope.chainId) && Number.isInteger(scope.slot) && scope.slot >= 1 && scope.slot <= 4);
  uuid(scope.draftId); uuid(scope.approvalId); uuid(scope.uploadId); hash(scope.packageHash);
  const r = object(value, ["schema", "chainId", "draftId", "slot", "approvalId", "uploadId", "packageHash", "supported", "current", "observedAt", "review", "publication", "canPublish"]);
  check(r.schema === "raceson-round-publication-view-v3" && r.chainId === scope.chainId && r.draftId === scope.draftId
    && r.slot === scope.slot && r.approvalId === scope.approvalId && r.uploadId === scope.uploadId && r.packageHash === scope.packageHash
    && typeof r.supported === "boolean" && typeof r.current === "boolean" && typeof r.canPublish === "boolean");
  check(!r.supported || scope.chainId === 31337
    || scope.chainId === 10143 && scope.draftId === "9a000000-0000-4000-8000-000000000052");
  const observedAt = time(r.observedAt);
  let review = null, publication = null;
  if (r.review !== null) {
    const p = object(r.review, ["id", "seconds", "startedAt", "endsAt"]);
    check(typeof p.seconds === "number" && Number.isInteger(p.seconds) && p.seconds >= 0 && p.seconds <= 2592000);
    review = { id: uuid(p.id), seconds: p.seconds, startedAt: time(p.startedAt), endsAt: time(p.endsAt) };
    check(micros(review.endsAt) - micros(review.startedAt) === BigInt(review.seconds) * 1000000n && micros(review.startedAt) <= micros(observedAt));
  }
  if (r.publication !== null) {
    const p = object(r.publication, ["id", "publishedAt", "evidenceHash"]);
    check(review && typeof p.evidenceHash === "string" && /^0x[0-9a-f]{64}$/.test(p.evidenceHash) && BigInt(p.evidenceHash) > 0n);
    publication = { id: uuid(p.id), publishedAt: time(p.publishedAt), evidenceHash: p.evidenceHash as `0x${string}` };
    check(micros(publication.publishedAt) >= micros(review.endsAt) && micros(publication.publishedAt) <= micros(observedAt));
  }
  check(r.canPublish === Boolean(r.supported && r.current && review && !publication && micros(observedAt) >= micros(review.endsAt)));
  return { ...scope, supported: r.supported, current: r.current, observedAt, review, publication, canPublish: r.canPublish };
}
export type RoundPublicationViewV3 = ReturnType<typeof decodeRoundPublicationV3>;
