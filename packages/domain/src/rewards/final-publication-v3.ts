import { decodeFinalAllocationSourceReviewV3 } from "./final-allocation-document-v3.js";
import { programmeApprovalRequestIdV3 as uuid } from "./programme-approval-v3.js";
import { canonicalRewardProposalV2 as canonical } from "./frozen-proposal-v2.js";

function check(v: unknown, code = "invalid_reward_final_publication"): asserts v { if (!v) throw new Error(code); }
function object(v: unknown, keys: string[]) {
  check(v && typeof v === "object" && !Array.isArray(v));
  const d = Object.getOwnPropertyDescriptors(v);
  check(Reflect.ownKeys(v).length === keys.length && keys.every(k => d[k]?.enumerable && "value" in d[k]!));
  return Object.fromEntries(keys.map(k => [k, d[k]!.value])) as Record<string, unknown>;
}
const hash = (v: unknown) => { check(typeof v === "string" && /^[0-9a-f]{64}$/.test(v)); return v; };
const instant = (v: unknown) => { check(typeof v === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(v)
  && Number.isFinite(Date.parse(v)) && Date.parse(v) >= 1000); return v; };
const period = (v: unknown) => { check(typeof v === "string" && /^(0|[1-9]\d{0,6})$/.test(v) && Number(v) <= 2592000); return v; };
const second = (v: string) => BigInt(Math.floor(Date.parse(v) / 1000)).toString();
const raceKeys = ["raceId", "competitionId", "policyId", "reviewSeconds", "configuredAt", "startedByPublicationId", "startedAt", "endsAt",
  "finalPublicationId", "officialPublishedAt"];
function clocks(value: unknown) {
  check(Array.isArray(value) && value.length > 0 && value.length <= 64);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  check(Reflect.ownKeys(value).length === value.length + 1);
  const rows = Array.from({ length: value.length }, (_, index) => {
    const entry = descriptors[String(index)]; check(entry?.enumerable && "value" in entry);
    const r = object(entry.value, raceKeys);
    const row = { raceId: uuid(r.raceId), competitionId: uuid(r.competitionId), policyId: uuid(r.policyId), reviewSeconds: period(r.reviewSeconds),
      configuredAt: instant(r.configuredAt), startedByPublicationId: uuid(r.startedByPublicationId), startedAt: instant(r.startedAt), endsAt: instant(r.endsAt),
      finalPublicationId: uuid(r.finalPublicationId), officialPublishedAt: instant(r.officialPublishedAt) };
    check(Date.parse(row.configuredAt) <= Date.parse(row.startedAt)
      && Date.parse(row.endsAt) - Date.parse(row.startedAt) === Number(row.reviewSeconds) * 1000
      && Date.parse(row.officialPublishedAt) >= Date.parse(row.endsAt));
    return row;
  }).sort((a, b) => a.raceId < b.raceId ? -1 : a.raceId > b.raceId ? 1 : 0);
  for (const key of ["raceId", "competitionId", "policyId", "finalPublicationId"] as const)
    check(new Set(rows.map(r => r[key])).size === rows.length);
  return rows;
}
const keys = ["schema", "chainId", "draftId", "slot", "approvalId", "uploadId", "contextHash", "documentHash", "packageHash", "sourceReview",
  "finalRoundReviewPeriod", "reviewPeriod", "nativeRaces", "clockKind", "reviewStartedAt", "officialPublishedAt"];
export type FinalPublicationEvidenceInputV3 = {
  chainId: 31337 | 10143; draftId: string; slot: 5 | 6; approvalId: string; uploadId: string;
  contextHash: string; documentHash: string; packageHash: string; sourceReview: unknown;
  finalRoundReviewPeriod: string; reviewPeriod: string; nativeRaces: unknown;
};

/** Binds completed native source clocks, never creates a timer. Full source
 * currentness/authority still belongs to the source-locked repository. A league
 * with the same policy inherits the finale's completed review. Explicit zero
 * means no additional league window, not skipping the native race review. */
export function buildFinalPublicationEvidenceV3(input: FinalPublicationEvidenceInputV3) {
  const s = object(input, keys.filter(k => !["schema", "clockKind", "reviewStartedAt", "officialPublishedAt"].includes(k)));
  check((s.chainId === 31337 || s.chainId === 10143) && (s.slot === 5 || s.slot === 6));
  const sourceReview = decodeFinalAllocationSourceReviewV3(s.sourceReview), nativeRaces = clocks(s.nativeRaces);
  check((s.slot === 5) === (sourceReview.kind === "native_finale"));
  const reviewPeriod = period(s.reviewPeriod), finalRoundReviewPeriod = period(s.finalRoundReviewPeriod);
  check(nativeRaces.every(r => r.reviewSeconds === finalRoundReviewPeriod)
    && (s.slot === 5 ? reviewPeriod === finalRoundReviewPeriod : reviewPeriod === "0" || reviewPeriod === finalRoundReviewPeriod),
  "reward_final_review_policy_mismatch");
  const lastOfficial = Math.max(...nativeRaces.map(r => Date.parse(r.officialPublishedAt)));
  const official = sourceReview.kind === "published_league" ? sourceReview.publishedAt : new Date(lastOfficial).toISOString();
  check(Date.parse(official) >= lastOfficial);
  const clockKind = s.slot === 5 ? "native_round_review" as const : reviewPeriod === "0" ? "explicit_zero_league_review" as const : "final_round_review" as const;
  const started = clockKind === "explicit_zero_league_review" ? official
    : new Date(Math.max(...nativeRaces.map(r => Date.parse(r.startedAt)))).toISOString();
  const reviewStartedAt = second(started), officialPublishedAt = second(official);
  // Both seconds are floored; equal integer policies preserve the completed
  // interval. The SQL writer additionally checks the original full timestamps.
  check(BigInt(officialPublishedAt) >= BigInt(reviewStartedAt) + BigInt(reviewPeriod));
  return { schema: "raceson-final-publication-evidence-v3" as const, chainId: s.chainId, draftId: uuid(s.draftId), slot: s.slot,
    approvalId: uuid(s.approvalId), uploadId: uuid(s.uploadId), contextHash: hash(s.contextHash), documentHash: hash(s.documentHash),
    packageHash: hash(s.packageHash), sourceReview, finalRoundReviewPeriod, reviewPeriod, nativeRaces, clockKind, reviewStartedAt, officialPublishedAt };
}
export function decodeFinalPublicationEvidenceV3(value: unknown) {
  const v = object(value, keys), { schema: _schema, clockKind: _kind, reviewStartedAt: _start, officialPublishedAt: _end, ...input } = v;
  const built = buildFinalPublicationEvidenceV3(input as FinalPublicationEvidenceInputV3);
  check(canonical(built) === canonical(v)); return built;
}
export function finalPublicationBindingV3(id: string, evidenceHash: string, evidence: ReturnType<typeof decodeFinalPublicationEvidenceV3>) {
  const d = decodeFinalPublicationEvidenceV3(evidence);
  // These identify the aggregate attestation, not fabricated race-publication
  // rows. Each actual policy/publication ID remains in the private evidence.
  return { reviewId: uuid(id), publicationId: uuid(id), reviewPeriod: d.reviewPeriod, reviewStartedAt: d.reviewStartedAt,
    officialPublishedAt: d.officialPublishedAt, publicationEvidenceHash: `0x${hash(evidenceHash)}` as `0x${string}` };
}
