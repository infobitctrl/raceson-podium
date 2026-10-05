import { compareRewardKeys } from "./arithmetic.js";
import { decodeNativeFinaleSourceV3, inspectNativeFinaleSourceV3, type NativeFinaleSourceV3 } from "./native-finale-source-v3.js";
import { decodeStoredRewardSnapshot, type StoredRewardSnapshot } from "./published-preview-v2.js";
import { requireHistoricalCatalogueV3 } from "./historical-catalogue-v3.js";
import { historicalAllocationSourceV3, type HistoricalSourceDecisionV3 } from "./historical-source-v3.js";
import { decodeRewardAllocationSourceV3, type RewardAllocationSourceV3 } from "./allocation-preview-v3.js";
import { validateRewardSourceMappingV2, type RewardSourceCatalogueV2, type RewardSourceMappingV2 } from "./source-mapping-v2.js";
import { programmeApprovalRequestIdV3 as uuid } from "./programme-approval-v3.js";

const fail = () => { throw new Error("invalid_reward_finale_continuity"); };
function check(v: unknown): asserts v { if (!v) fail(); }
function object(v: unknown, keys: string[]) {
  check(v && typeof v === "object" && !Array.isArray(v));
  const fields = Object.getOwnPropertyDescriptors(v);
  check(Reflect.ownKeys(v).length === keys.length && keys.every(k => fields[k]?.enumerable && "value" in fields[k]!));
  return Object.fromEntries(keys.map(k => [k, fields[k]!.value])) as Record<string, unknown>;
}
function list(v: unknown): unknown[] {
  check(Array.isArray(v) && v.length <= 10000);
  const fields = Object.getOwnPropertyDescriptors(v);
  check(Reflect.ownKeys(v).length === v.length + 1);
  return Array.from({ length: v.length }, (_, i) => {
    const field = fields[String(i)]; check(field?.enumerable && "value" in field); return field.value as unknown;
  });
}
function unique(ids: string[]) { check(new Set(ids).size === ids.length); }
function target(value: unknown) {
  const t = object(value, ["kind", "beneficiaryId"]); check(t.kind === "historical" || t.kind === "new_native");
  return { kind: t.kind as "historical" | "new_native", beneficiaryId: uuid(t.beneficiaryId) };
}

/** Sporting continuity only. No account, DOB, wallet, payout or generic UUID
 * rename: newcomers keep their native ID; returning participants require an
 * explicit reference to an identity actually present in the four-round import.
 * Partial selections are valid drafts, never complete source evidence.
 */
export function decodeNativeFinaleContinuityV3(value: unknown) {
  const v = object(value, ["schema", "athletes", "clubs", "classifications"]);
  check(v.schema === "raceson-native-finale-continuity-v3");
  const athletes = list(v.athletes).map(value => { const a = object(value, ["nativeAthleteId", "target"]);
    return { nativeAthleteId: uuid(a.nativeAthleteId), target: target(a.target) }; });
  const clubs = list(v.clubs).map(value => { const c = object(value, ["nativeClubId", "target"]);
    return { nativeClubId: uuid(c.nativeClubId), target: target(c.target) }; });
  const classifications = list(v.classifications).map(value => { const c = object(value, ["resultId", "categoryId"]);
    return { resultId: uuid(c.resultId), categoryId: uuid(c.categoryId) }; });
  unique(athletes.map(a => a.nativeAthleteId)); unique(clubs.map(c => c.nativeClubId)); unique(classifications.map(c => c.resultId));
  // Two different native records may not collapse into a single finisher/club.
  unique(athletes.map(a => a.target.beneficiaryId)); unique(clubs.map(c => c.target.beneficiaryId));
  return { schema: "raceson-native-finale-continuity-v3" as const,
    athletes: athletes.sort((a, b) => compareRewardKeys(a.nativeAthleteId, b.nativeAthleteId)),
    clubs: clubs.sort((a, b) => compareRewardKeys(a.nativeClubId, b.nativeClubId)),
    classifications: classifications.sort((a, b) => compareRewardKeys(a.resultId, b.resultId)) };
}
export type NativeFinaleContinuityV3 = ReturnType<typeof decodeNativeFinaleContinuityV3>;

function digest(v: unknown) { check(typeof v === "string" && /^[0-9a-f]{64}$/.test(v)); return v; }
function instant(v: unknown) { check(typeof v === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v)
  && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v); return v; }
export function decodeNativeContinuityChangeV3(value: unknown) {
  const c = object(value, ["requestId", "expectedReviewId", "contextHash", "selection", "decision"]);
  check(c.decision === "confirmed" || c.decision === "held");
  return { requestId: uuid(c.requestId), expectedReviewId: c.expectedReviewId === null ? null : uuid(c.expectedReviewId),
    contextHash: digest(c.contextHash), selection: decodeNativeFinaleContinuityV3(c.selection), decision: c.decision as "confirmed" | "held" };
}
export type NativeContinuityChangeV3 = ReturnType<typeof decodeNativeContinuityChangeV3>;
export function decodeNativeContinuityDecisionV3(value: unknown) {
  if (value === null) return null;
  const r = object(value, ["id", "previousReviewId", "contextHash", "selection", "decision", "reviewedAt"]);
  const c = decodeNativeContinuityChangeV3({ requestId: r.id, expectedReviewId: r.previousReviewId, contextHash: r.contextHash,
    selection: r.selection, decision: r.decision });
  check(c.requestId !== c.expectedReviewId);
  return { id: c.requestId, previousReviewId: c.expectedReviewId, contextHash: c.contextHash,
    selection: c.selection, decision: c.decision, reviewedAt: instant(r.reviewedAt) };
}
export function decodeNativeContinuityViewV3(value: unknown) {
  const v = object(value, ["schema", "draftId", "organizationId", "chainId", "revision", "bindingId", "contextHash", "review", "recordedReview",
    "reviewState", "options", "sourceReady", "proposedWei", "retainedWei", "allocationApproved", "payableWei"]);
  check(v.schema === "raceson-native-continuity-review-v3" && [31337, 10143].includes(v.chainId as number)
    && Number.isSafeInteger(v.revision) && Number(v.revision) > 0 && typeof v.sourceReady === "boolean"
    && v.allocationApproved === false && v.payableWei === "0");
  check(["missing", "stale", "held", "confirmed_selection", "incomplete"].includes(v.reviewState as string));
  const options = object(v.options, ["athletes", "clubs", "historicalAthletes", "historicalClubs", "categories", "rows"]);
  function named(value: unknown) { return list(value).map(value => { const r = object(value, ["id", "name"]);
    check(typeof r.name === "string" && r.name.length > 0 && r.name.length <= 512); return { id: uuid(r.id), name: r.name }; }); }
  const athletes = named(options.athletes), clubs = named(options.clubs), historicalAthletes = named(options.historicalAthletes), historicalClubs = named(options.historicalClubs);
  const categories = list(options.categories).map(value => { const c = object(value, ["id", "name", "competitionId"]);
    check(typeof c.name === "string" && c.name.length > 0 && c.name.length <= 512);
    return { id: uuid(c.id), name: c.name, competitionId: uuid(c.competitionId) }; });
  const rows = list(options.rows).map(value => { const r = object(value, ["id", "athleteId", "clubId", "competitionId", "finished"]);
    check(typeof r.finished === "boolean");
    const row = { id: uuid(r.id), athleteId: uuid(r.athleteId), clubId: r.clubId === null ? null : uuid(r.clubId),
      competitionId: uuid(r.competitionId), finished: r.finished };
    check(athletes.some(a => a.id === row.athleteId) && (row.clubId === null || clubs.some(c => c.id === row.clubId)));
    return row; });
  for (const items of [athletes, clubs, historicalAthletes, historicalClubs, categories, rows]) unique(items.map(i => i.id));
  for (const amount of [v.proposedWei, v.retainedWei]) check(typeof amount === "string" && /^(0|[1-9]\d{0,77})$/.test(amount));
  const review = decodeNativeContinuityDecisionV3(v.review), recordedReview = decodeNativeContinuityDecisionV3(v.recordedReview), contextHash = digest(v.contextHash);
  check(v.reviewState === "missing" ? review === null : review !== null);
  if (review) check((v.reviewState === "stale") === (review.contextHash !== contextHash));
  if (v.reviewState === "confirmed_selection") check(review?.decision === "confirmed" && v.sourceReady);
  if (v.reviewState === "held") check(review?.decision === "held");
  return { schema: "raceson-native-continuity-review-v3" as const, draftId: uuid(v.draftId), organizationId: uuid(v.organizationId),
    chainId: v.chainId as 31337 | 10143, revision: v.revision as number, bindingId: v.bindingId === null ? null : uuid(v.bindingId), contextHash,
    review, recordedReview, reviewState: v.reviewState as "missing" | "stale" | "held" | "confirmed_selection" | "incomplete",
    options: { athletes, clubs, historicalAthletes, historicalClubs, categories, rows }, sourceReady: v.sourceReady,
    proposedWei: v.proposedWei as string, retainedWei: v.retainedWei as string, allocationApproved: false as const, payableWei: "0" as const };
}
export type NativeContinuityViewV3 = ReturnType<typeof decodeNativeContinuityViewV3>;
export type NativeFinaleContinuityHoldV3 = "source_not_final" | "athlete_unlinked" | "club_unlinked" | "classification_missing" | "invalid_overall_ranks";

export function inspectNativeFinaleContinuityV3(snapshotInput: StoredRewardSnapshot,
  nativeInput: NativeFinaleSourceV3, selectionInput: NativeFinaleContinuityV3) {
  const snapshot = decodeStoredRewardSnapshot(snapshotInput), native = decodeNativeFinaleSourceV3(nativeInput);
  const selection = decodeNativeFinaleContinuityV3(selectionInput), rows = native.document.races.flatMap(r => r.rows);
  const athletes = new Set(rows.map(r => r.athleteId)), clubs = new Set(rows.flatMap(r => r.clubId ? [r.clubId] : []));
  const historicAthletes = new Set(snapshot.results.map(r => r.athleteId));
  const historicClubs = new Set([...snapshot.clubs.map(c => c.clubId), ...snapshot.results.flatMap(r => r.clubId ? [r.clubId] : [])]);
  function validateTarget(t: ReturnType<typeof target>, nativeId: string, oldIds: Set<string>) {
    if (t.kind === "historical") check(oldIds.has(t.beneficiaryId));
    else check(t.beneficiaryId === nativeId && !oldIds.has(nativeId));
  }
  for (const a of selection.athletes) { check(athletes.has(a.nativeAthleteId)); validateTarget(a.target, a.nativeAthleteId, historicAthletes); }
  for (const c of selection.clubs) { check(clubs.has(c.nativeClubId)); validateTarget(c.target, c.nativeClubId, historicClubs); }
  const byResult = new Map(native.document.races.flatMap(r => r.rows.map(row => [row.id, { row, competitionId: r.competitionId }] as const)));
  for (const c of selection.classifications) {
    const result = byResult.get(c.resultId); check(result);
    check(snapshot.catalogue.categories.some(category => category.id === c.categoryId && category.target === "individual"
      && category.competitionId === result.competitionId));
  }
  const holds = new Set<NativeFinaleContinuityHoldV3>();
  if (inspectNativeFinaleSourceV3(native).state !== "final_source_observed") holds.add("source_not_final");
  if (selection.athletes.length !== athletes.size) holds.add("athlete_unlinked");
  if (selection.clubs.length !== clubs.size) holds.add("club_unlinked");
  const classified = new Set(selection.classifications.map(c => c.resultId));
  if (rows.some(r => r.participationStatus === "finished" && !classified.has(r.id))) holds.add("classification_missing");
  // Validate the complete official overall order before splitting categories.
  // Otherwise a broken order like 1,1,2 could be laundered into valid category ranks.
  for (const race of native.document.races) {
    const finished = race.rows.filter(r => r.participationStatus === "finished")
      .sort((a, b) => (a.rankOverall ?? 0) - (b.rankOverall ?? 0) || compareRewardKeys(a.id, b.id));
    for (let i = 0; i < finished.length;) {
      if (finished[i]!.rankOverall !== i + 1) holds.add("invalid_overall_ranks");
      const rank = finished[i]!.rankOverall;
      do { i++; } while (i < finished.length && finished[i]!.rankOverall === rank);
    }
  }
  return { selection, state: holds.size ? "held" as const : "complete_selection" as const, holds: [...holds],
    athleteCount: athletes.size, clubCount: clubs.size, allocationApproved: false as const, payableWei: "0" as const };
}

/** Pure adapter. Caller must authenticate and cryptographically bind a stored
 * continuity decision before passing confirmed=true and its commitment digest.
 * This function does not grant that authority. Club tables and final league
 * standings are deliberately not derived from arbitrary individual point sums.
 */
export function nativeFinaleAllocationSourceV3(input: {
  snapshot: StoredRewardSnapshot; catalogue: RewardSourceCatalogueV2; mapping: RewardSourceMappingV2;
  historicalContextHash: string; historicalDecisions: HistoricalSourceDecisionV3[];
  native: NativeFinaleSourceV3; continuity: { selection: NativeFinaleContinuityV3; confirmed: boolean; digest: string } | null;
}): RewardAllocationSourceV3 {
  const snapshot = decodeStoredRewardSnapshot(input.snapshot), native = decodeNativeFinaleSourceV3(input.native);
  const catalogue = requireHistoricalCatalogueV3(snapshot, input.catalogue), mapping = validateRewardSourceMappingV2(input.mapping, catalogue);
  const source = historicalAllocationSourceV3(snapshot, mapping, input.historicalContextHash, input.historicalDecisions,
    new Date(native.observedAt).toISOString());
  const finale = catalogue.rounds.find(r => r.slot === 5), binding = native.document.binding;
  if (!binding || !finale || mapping.rounds[4]!.roundId === null) return source;
  check(finale.id === binding.id && finale.editionId === binding.editionId && mapping.rounds[4]!.roundId === binding.id);
  check(finale.races.length === binding.races.length && finale.races.every(r => binding.races.some(b => b.raceId === r.id && b.competitionId === r.competitionId)));
  const importedCompetitions = new Set(snapshot.catalogue.categories.filter(c => c.target === "individual").map(c => c.competitionId));
  check(binding.races.length === importedCompetitions.size && binding.races.every(r => importedCompetitions.has(r.competitionId)));
  const oldIds = new Set(source.rounds.flatMap(r => r.results.map(row => row.id)));
  const oldRaceIds = new Set(snapshot.catalogue.rounds.flatMap(r => r.races.map(race => race.id)));
  check(native.document.races.every(r => !oldRaceIds.has(r.raceId) && r.rows.every(row => !oldIds.has(row.id))));
  if (!input.continuity) return source;
  check(typeof input.continuity.confirmed === "boolean" && /^[0-9a-f]{64}$/.test(input.continuity.digest));
  const inspected = inspectNativeFinaleContinuityV3(snapshot, native, input.continuity.selection);
  if (!input.continuity.confirmed || inspected.state !== "complete_selection") return source;
  const { selection } = inspected;
  const athleteIds = new Map(selection.athletes.map(a => [a.nativeAthleteId, a.target.beneficiaryId]));
  const clubIds = new Map(selection.clubs.map(c => [c.nativeClubId, c.target.beneficiaryId]));
  const categories = new Map(selection.classifications.map(c => [c.resultId, c.categoryId]));
  const rows = native.document.races.flatMap(r => r.rows.map(row => ({ row, distanceMetres: r.distanceMetres })));
  const publishedAt = native.document.races.map(r => new Date(r.review.officialPublishedAt!).toISOString()).sort().at(-1)!;
  // Native is the portal publication workflow, not proof of a real sporting
  // event. A synthetic programme must retain its synthetic evidence label.
  const evidence = { kind: snapshot.version === 3 ? "synthetic" as const : "native_final" as const,
    digest: input.continuity.digest, publishedAt, held: false };
  const results = rows.map(({ row, distanceMetres }) => ({ id: row.id, athleteId: athleteIds.get(row.athleteId)!,
    categoryId: categories.get(row.id) ?? null, clubId: row.clubId === null ? null : clubIds.get(row.clubId)!,
    status: row.participationStatus as "finished" | "dns" | "dnf" | "dsq",
    distanceMetres: distanceMetres && /^[1-9]\d{0,8}$/.test(distanceMetres) ? distanceMetres : null }));
  source.rounds[4] = { slot: 5, roundId: binding.id, evidence, resultsComplete: true, expectedResultCount: rows.length, results };
  for (const category of snapshot.catalogue.categories.filter(c => c.target === "individual")) {
    const candidates = rows.filter(({ row }) => row.participationStatus === "finished" && categories.get(row.id) === category.id)
      .map(({ row }) => ({ sourceRowId: row.id, beneficiaryId: athleteIds.get(row.athleteId)!, order: row.rankOverall! }))
      .sort((a, b) => a.order - b.order || compareRewardKeys(a.beneficiaryId, b.beneficiaryId));
    let rank = 0;
    source.standings.push({ slot: 5, categoryId: category.id, complete: true, evidence, roundDigests: [evidence.digest],
      rows: candidates.map((row, i) => { if (i === 0 || row.order !== candidates[i - 1]!.order) rank = i + 1;
        return { sourceRowId: row.sourceRowId, beneficiaryId: row.beneficiaryId, rank }; }) });
  }
  // No league publication is manufactured by five completed races. All original
  // historical rounds/decisions survive byte-for-byte; unclaimed identities have
  // exactly the same ranks/weights as claimed ones (claim state is not an input).
  return decodeRewardAllocationSourceV3(source);
}
