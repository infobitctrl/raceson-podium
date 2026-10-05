import { programmeApprovalRequestIdV3 as uuid } from "./programme-approval-v3.js";
const check = (v: unknown): void => { if (!v) throw Error("invalid_reward_final_publication_view"); };
function object(v: unknown, keys: string[]) {
  check(v && typeof v === "object" && !Array.isArray(v));
  const fields = Object.getOwnPropertyDescriptors(v!);
  check(Reflect.ownKeys(v as object).length === keys.length && keys.every(k => fields[k]?.enumerable && "value" in fields[k]!));
  return Object.fromEntries(keys.map(k => [k, fields[k]!.value])) as Record<string, unknown>;
}
const hash = (v: unknown) => { check(typeof v === "string" && /^[0-9a-f]{64}$/.test(v as string)); return v as string; };
const seconds = (v: unknown) => { check(typeof v === "string" && /^(0|[1-9][0-9]{0,19})$/.test(v as string)
  && BigInt(v as string) < 1n << 64n); return v as string; };
const period = (v: unknown) => { const s = seconds(v); check(BigInt(s) <= 2592000n); return s; };
type Scope = { chainId: number; draftId: string; slot: number; approvalId: string; uploadId: string; packageHash?: string };

/** Browser-safe aggregate summary only; private race evidence is never accepted.
 * Historical round publication has a different schema and is not re-labelled. */
export function decodeFinalPublicationViewV3(value: unknown, expected: Scope) {
  const r = object(value, ["schema", "chainId", "draftId", "slot", "approvalId", "uploadId", "contextHash", "packageHash", "evidenceHash",
    "current", "reasons", "timing", "publication", "historicalAcknowledgement", "publicationBound", "stageReady", "payableWei"]);
  check(r.schema === "raceson-final-publication-view-v3" && [31337, 10143].includes(r.chainId as number) && [5, 6].includes(r.slot as number));
  const scope = { chainId: r.chainId as 31337 | 10143, draftId: uuid(r.draftId), slot: r.slot as 5 | 6,
    approvalId: uuid(r.approvalId), uploadId: uuid(r.uploadId) };
  check(Object.entries(scope).every(([k, v]) => v === expected[k as keyof Scope]));
  const contextHash = hash(r.contextHash), packageHash = hash(r.packageHash), evidenceHash = r.evidenceHash === null ? null : hash(r.evidenceHash);
  check(expected.packageHash === undefined || expected.packageHash === packageHash);
  check(typeof r.current === "boolean" && typeof r.historicalAcknowledgement === "boolean" && typeof r.publicationBound === "boolean"
    && r.stageReady === false && r.payableWei === "0" && Array.isArray(r.reasons));
  const descriptors = Object.getOwnPropertyDescriptors(r.reasons as unknown[]);
  check(Reflect.ownKeys(r.reasons as object).length === (r.reasons as unknown[]).length + 1 && (r.reasons as unknown[]).length <= 1);
  const reasons = Array.from({ length: (r.reasons as unknown[]).length }, (_, i) => {
    const d = descriptors[String(i)]; check(d?.enumerable && "value" in d);
    check(d && ["reward_final_publication_not_ready", "reward_final_review_policy_mismatch"].includes(d.value)); return d!.value as string;
  });
  let timing = null;
  if (r.timing !== null) {
    const t = object(r.timing, ["clockKind", "reviewPeriod", "finalRoundReviewPeriod", "reviewStartedAt", "officialPublishedAt", "nativeRaceCount"]);
    const reviewPeriod = period(t.reviewPeriod), finalRoundReviewPeriod = period(t.finalRoundReviewPeriod);
    const reviewStartedAt = seconds(t.reviewStartedAt), officialPublishedAt = seconds(t.officialPublishedAt);
    const kind = scope.slot === 5 ? "native_round_review" : reviewPeriod === "0" ? "explicit_zero_league_review" : "final_round_review";
    check(t.clockKind === kind && (scope.slot === 5 || reviewPeriod !== "0" ? reviewPeriod === finalRoundReviewPeriod : reviewStartedAt === officialPublishedAt)
      && BigInt(reviewStartedAt) > 0n && BigInt(officialPublishedAt) >= BigInt(reviewStartedAt) + BigInt(reviewPeriod)
      && Number.isInteger(t.nativeRaceCount) && Number(t.nativeRaceCount) >= 1 && Number(t.nativeRaceCount) <= 64);
    timing = { clockKind: kind, reviewPeriod, finalRoundReviewPeriod, reviewStartedAt, officialPublishedAt, nativeRaceCount: t.nativeRaceCount as number };
  }
  check((timing !== null) === (evidenceHash !== null) && (timing !== null) === (reasons.length === 0) && (r.current || timing === null));
  let publication = null;
  if (r.publication !== null) {
    const p = object(r.publication, ["id", "contextHash", "evidenceHash", "recordedAt", "binding"]), id = uuid(p.id);
    const b = object(p.binding, ["reviewId", "publicationId", "reviewPeriod", "reviewStartedAt", "officialPublishedAt", "publicationEvidenceHash"]);
    const binding = { reviewId: uuid(b.reviewId), publicationId: uuid(b.publicationId), reviewPeriod: period(b.reviewPeriod),
      reviewStartedAt: seconds(b.reviewStartedAt), officialPublishedAt: seconds(b.officialPublishedAt), publicationEvidenceHash: `0x${hash(p.evidenceHash)}` };
    check(binding.reviewId === id && binding.publicationId === id && b.publicationEvidenceHash === binding.publicationEvidenceHash
      && BigInt(binding.reviewStartedAt) > 0n && BigInt(binding.officialPublishedAt) >= BigInt(binding.reviewStartedAt) + BigInt(binding.reviewPeriod)
      && typeof p.recordedAt === "string" && Number.isFinite(Date.parse(p.recordedAt)) && new Date(p.recordedAt).toISOString() === p.recordedAt);
    publication = { id, contextHash: hash(p.contextHash), evidenceHash: hash(p.evidenceHash), recordedAt: p.recordedAt as string, binding };
    if (timing) check(publication.contextHash === contextHash && publication.evidenceHash === evidenceHash
      && binding.reviewPeriod === timing.reviewPeriod && binding.reviewStartedAt === timing.reviewStartedAt && binding.officialPublishedAt === timing.officialPublishedAt);
  }
  check(r.publicationBound === (publication !== null && timing !== null));
  return { schema: "raceson-final-publication-view-v3" as const, ...scope, contextHash, packageHash, evidenceHash, current: r.current as boolean,
    reasons, timing, publication, historicalAcknowledgement: r.historicalAcknowledgement as boolean, publicationBound: r.publicationBound as boolean,
    stageReady: false as const, payableWei: "0" as const };
}
export type FinalPublicationViewV3 = ReturnType<typeof decodeFinalPublicationViewV3>;
