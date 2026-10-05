import { decodeRewardResultReviewV3, type RewardResultReviewV3 } from "./result-review-v3.js";
import { programmeApprovalRequestIdV3 as uuid } from "./programme-approval-v3.js";

const fail = () => { throw new Error("invalid_reward_native_finale"); };
function check(v: unknown): asserts v { if (!v) fail(); }
function object(v: unknown, keys: string[]) {
  check(v && typeof v === "object" && !Array.isArray(v));
  const fields = Object.getOwnPropertyDescriptors(v);
  check(Reflect.ownKeys(v).length === keys.length && keys.every(k => fields[k]?.enumerable && "value" in fields[k]!));
  return Object.fromEntries(keys.map(k => [k, fields[k]!.value])) as Record<string, unknown>;
}
function list(v: unknown, max: number): unknown[] { check(Array.isArray(v) && v.length <= max); return v; }
function text(v: unknown) { check(typeof v === "string" && v.length > 0 && v.length <= 128); return v; }
function flag(v: unknown) { check(typeof v === "boolean"); return v; }
function count(v: unknown) { check(Number.isSafeInteger(v) && Number(v) >= 0 && Number(v) <= 10000); return Number(v); }
function revision(v: unknown) { check(Number.isSafeInteger(v) && Number(v) > 0 && Number(v) <= 2147483646); return Number(v); }
function decimal(v: unknown) { check(typeof v === "string" && /^(?:0|[1-9]\d{0,18})(?:\.\d{1,6})?$/.test(v)); return v; }
function nullable<T>(v: unknown, decode: (v: unknown) => T): T | null { return v === null ? null : decode(v); }
function time(v: unknown) {
  check(typeof v === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(v) && Number.isFinite(Date.parse(v)));
  return v;
}
function unique(v: string[]) { check(new Set(v).size === v.length); }
const reviewKeys = ["schema", "categoryId", "organizationId", "state", "revision", "reviewSeconds", "policyId", "configuredAt", "locked", "held",
  "startedAt", "startedByPublicationId", "endsAt", "latestPublicationId", "finalPublicationId", "officialPublishedAt", "allocationApproved"];

/** Minimized native sporting observation. Source IDs are in the local native
 * namespace, not automatically the imported athlete/category identity. No wallet,
 * DOB, names or complaint text. This is not an immutable approval or entitlement.
 */
export function decodeNativeFinaleSourceV3(value: unknown) {
  const envelope = object(value, ["document", "observedAt"]), observedAt = time(envelope.observedAt);
  const d = object(envelope.document, ["schema", "draftId", "chainId", "organizationId", "recordRevision", "binding", "edition", "races"]);
  check(d.schema === "raceson-native-finale-source-v3" && [31337, 10143].includes(Number(d.chainId)) && typeof d.chainId === "number");
  const organizationId = uuid(d.organizationId);
  const binding = nullable(d.binding, value => {
    const b = object(value, ["id", "editionId", "races"]);
    const races = list(b.races, 64).map(value => { const p = object(value, ["competitionId", "raceId"]);
      return { competitionId: uuid(p.competitionId), raceId: uuid(p.raceId) }; });
    check(races.length > 0); unique(races.map(r => r.raceId)); unique(races.map(r => r.competitionId));
    return { id: uuid(b.id), editionId: uuid(b.editionId), races };
  });
  const edition = nullable(d.edition, value => { const e = object(value, ["id", "status", "isPractice", "removed"]);
    return { id: uuid(e.id), status: text(e.status), isPractice: flag(e.isPractice), removed: flag(e.removed) }; });
  check(binding === null ? edition === null : edition?.id === binding.editionId);
  const races = list(d.races, 64).map(value => {
    const r = object(value, ["raceId", "competitionId", "status", "removed", "resultsMode", "distanceMetres", "review", "publication", "run", "expectedResultCount", "rows"]);
    const raceId = uuid(r.raceId), competitionId = uuid(r.competitionId);
    check(binding?.races.some(p => p.raceId === raceId && p.competitionId === competitionId));
    const reviewWithTime = decodeRewardResultReviewV3({ ...object(r.review, reviewKeys), observedAt });
    check(reviewWithTime.categoryId === raceId && reviewWithTime.organizationId === organizationId);
    const { observedAt: _observedAt, ...review } = reviewWithTime;
    const publication = nullable(r.publication, value => { const p = object(value, ["id", "raceId", "runId", "state", "publishedAt"]);
      check(p.raceId === raceId && p.id === review.latestPublicationId);
      return { id: uuid(p.id), raceId, runId: uuid(p.runId), state: text(p.state), publishedAt: time(p.publishedAt) }; });
    check((publication?.id ?? null) === review.latestPublicationId);
    const run = nullable(r.run, value => { const p = object(value, ["id", "raceId", "status", "completedAt"]);
      check(publication?.runId === p.id && p.raceId === raceId);
      return { id: uuid(p.id), raceId, status: text(p.status), completedAt: nullable(p.completedAt, time) }; });
    check(publication !== null || run === null);
    const rows = list(r.rows, 10000).map(value => {
      const row = object(value, ["id", "raceId", "runId", "athleteId", "clubId", "registrationMatches", "participationStatus", "resultStatus", "finishTimeMs", "rankOverall", "clubPoints"]);
      check(row.raceId === raceId && row.runId === run?.id);
      const rank = nullable(row.rankOverall, count); check(rank !== 0);
      return { id: uuid(row.id), raceId, runId: uuid(row.runId), athleteId: uuid(row.athleteId), clubId: nullable(row.clubId, uuid),
        registrationMatches: flag(row.registrationMatches), participationStatus: nullable(row.participationStatus, text), resultStatus: text(row.resultStatus),
        finishTimeMs: nullable(row.finishTimeMs, decimal), rankOverall: rank, clubPoints: nullable(row.clubPoints, decimal) };
    });
    check(rows.length <= count(r.expectedResultCount));
    return { raceId, competitionId, status: text(r.status), removed: flag(r.removed), resultsMode: text(r.resultsMode),
      distanceMetres: nullable(r.distanceMetres, decimal), review, publication, run, expectedResultCount: count(r.expectedResultCount), rows };
  });
  check(races.length === (binding?.races.length ?? 0)); unique(races.map(r => r.raceId)); unique(races.flatMap(r => r.rows.map(row => row.id)));
  check(races.reduce((n, r) => n + r.rows.length, 0) <= 10000);
  return { document: { schema: "raceson-native-finale-source-v3" as const, draftId: uuid(d.draftId), chainId: d.chainId as 31337 | 10143,
    organizationId, recordRevision: revision(d.recordRevision), binding, edition, races }, observedAt };
}
export type NativeFinaleSourceV3 = ReturnType<typeof decodeNativeFinaleSourceV3>;
export type NativeFinaleReviewV3 = Omit<RewardResultReviewV3, "observedAt">;
export type NativeFinaleHoldV3 = "binding_missing" | "race_not_completed" | "review_not_final" | "source_inconsistent" | "ambiguous_results" | "distance_missing";

/** Sporting diagnostics only; never merge names/UUIDs into historical identities
 * or normalize unknown/DNS/DNF/DSQ rows into finishes. No league denominator is
 * emitted until explicit category/identity continuity and final standings exist.
 */
export function inspectNativeFinaleSourceV3(input: NativeFinaleSourceV3) {
  const { document: d } = decodeNativeFinaleSourceV3(input);
  const holds = new Set<NativeFinaleHoldV3>();
  if (!d.binding) holds.add("binding_missing");
  if (d.edition && (d.edition.status !== "completed" || d.edition.removed)) holds.add("race_not_completed");
  const athletes = new Set<string>(); let finished = 0, metres = 0n;
  for (const r of d.races) {
    if (r.status !== "completed" || r.removed || r.resultsMode !== "standard") holds.add("race_not_completed");
    if (r.review.state !== "final") holds.add("review_not_final");
    if (!r.publication || !r.run || r.run.status !== "succeeded" || !r.run.completedAt
      || Date.parse(r.run.completedAt) > Date.parse(r.publication.publishedAt)
      || r.rows.length !== r.expectedResultCount || !["official", "corrected"].includes(r.publication.state)
      || r.publication.id !== r.review.finalPublicationId
      || Date.parse(r.publication.publishedAt) !== Date.parse(r.review.officialPublishedAt ?? "")) holds.add("source_inconsistent");
    for (const row of r.rows) {
      if (athletes.has(row.athleteId) || !row.registrationMatches || !["finished", "dns", "dnf", "dsq"].includes(row.participationStatus ?? "")
        || !["provisional", "official", "corrected"].includes(row.resultStatus)) holds.add("ambiguous_results");
      athletes.add(row.athleteId);
      if (row.participationStatus === "finished") {
        finished++;
        if (!row.finishTimeMs || !/^[1-9]\d*$/.test(row.finishTimeMs) || !row.rankOverall) holds.add("ambiguous_results");
        if (!r.distanceMetres || !/^[1-9]\d{0,8}$/.test(r.distanceMetres)) holds.add("distance_missing");
        else metres += BigInt(r.distanceMetres);
      }
    }
  }
  return { state: holds.size ? "held" as const : "final_source_observed" as const, holds: [...holds], resultCount: d.races.reduce((n, r) => n + r.rows.length, 0),
    finishedCount: finished, observedFinishedMetres: metres.toString(), identityNamespace: "native_demo" as const,
    allocationApproved: false as const, payableWei: "0" as const };
}
