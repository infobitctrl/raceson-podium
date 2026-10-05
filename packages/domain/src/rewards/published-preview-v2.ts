import { allocateRewardWeights, compareRewardKeys, requireReward } from "./arithmetic.js";
import { decodeRewardSourceCatalogueV2, previewRewardSourceMappingV2, type RewardSourceCatalogueV2, type RewardSourceMappingV2 } from "./source-mapping-v2.js";
import type { RewardProgrammeDraftV2 } from "./programme-draft-v2.js";

/** Minimized published sporting evidence. Never an identity claim or payout manifest. */
export type PublishedRewardSnapshotV2 = {
  version: 2; sourceOrigin: "https://www.raceson.com"; sourceLeagueId: string; sourceSeasonId: string; capturedAt: string;
  catalogue: RewardSourceCatalogueV2;
  results: Array<{ id: string; publicationId: string; publicationState: "official" | "corrected"; publishedAt: string; runId: string;
    athleteId: string; athleteName: string | null; raceId: string; classificationIds: string[]; participationStatus: string | null;
    finishTimeMs: number | null; rankOverall: number | null; clubId: string | null; clubName: string | null }>;
  clubs: Array<{ clubId: string; name: string | null; rounds: Array<{ slot: number; sourceRoundId: string; points: number }> }>;
};
/** Versioned, unmistakably invented input for the isolated compact pilot.
 * It is not a production export, a profile claim or a review-clock attestation.
 * V2 import/freeze consumers deliberately retain their strict V2 decoder. */
export type SyntheticRewardSnapshotV3 = Omit<PublishedRewardSnapshotV2, "version" | "sourceOrigin"> & {
  version: 3; sourceOrigin: "urn:raceson:synthetic:compact-20:v3" | "urn:raceson:synthetic:privy-10:v3" | "urn:raceson:synthetic:workflow-20260930:v1" | "urn:raceson:synthetic:workflow-20260930:v2";
};
export type StoredRewardSnapshot = PublishedRewardSnapshotV2 | SyntheticRewardSnapshotV3;
const error = "invalid_v2_published_snapshot";
const check = (v: unknown) => requireReward(v, error);
function object(v: unknown, keys: string[]) {
  check(v && typeof v === "object" && !Array.isArray(v)); const r = v as Record<string, unknown>;
  check(Object.keys(r).length === keys.length && keys.every(k => Object.hasOwn(r, k))); return r;
}
function text(v: unknown) { check(typeof v === "string" && v.length > 0 && v.length <= 512); return v as string; }
function uuid(v: unknown) { check(typeof v === "string" && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(v) && !/^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(v)); return v as string; }
function integer(v: unknown, min = 0, max = 1e12) { check(typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max); return v as number; }
function rows(v: unknown, max: number) { check(Array.isArray(v) && v.length <= max); return v as unknown[]; }
function unique(ids: string[]) { check(new Set(ids).size === ids.length); }
function instant(v: unknown) { const s = text(v); check(/^\d{4}-\d{2}-\d{2}T/.test(s) && /(?:Z|[+-]\d{2}:\d{2})$/.test(s) && Number.isFinite(Date.parse(s))); return s; }
export function decodePublishedRewardSnapshotV2(value: unknown): PublishedRewardSnapshotV2 {
  const decoded = decodeStoredRewardSnapshot(value);
  check(decoded.version === 2); return decoded as PublishedRewardSnapshotV2;
}
export function decodeStoredRewardSnapshot(value: unknown): StoredRewardSnapshot {
  const r = object(value, ["version", "sourceOrigin", "sourceLeagueId", "sourceSeasonId", "capturedAt", "catalogue", "results", "clubs"]);
  const privyPilot = r.version === 3 && r.sourceOrigin === "urn:raceson:synthetic:privy-10:v3";
  const workflow = r.version === 3 && (r.sourceOrigin === "urn:raceson:synthetic:workflow-20260930:v1" || r.sourceOrigin === "urn:raceson:synthetic:workflow-20260930:v2");
  const synthetic = workflow || privyPilot || r.version === 3 && r.sourceOrigin === "urn:raceson:synthetic:compact-20:v3";
  check(synthetic || r.version === 2 && r.sourceOrigin === "https://www.raceson.com");
  const catalogue = decodeRewardSourceCatalogueV2(r.catalogue);
  check(catalogue.rounds.length === 4 && catalogue.rounds.every((r, i) => r.slot === i + 1 && r.status === "completed"));
  const races = catalogue.rounds.flatMap(r => r.races); unique(races.map(r => r.id));
  const results = rows(r.results, 10000).map(v => {
    const row = object(v, ["id", "publicationId", "publicationState", "publishedAt", "runId", "athleteId", "athleteName", "raceId", "classificationIds", "participationStatus", "finishTimeMs", "rankOverall", "clubId", "clubName"]);
    check(row.publicationState === "official" || row.publicationState === "corrected");
    const raceId = uuid(row.raceId), race = races.find(c => c.id === raceId); check(race);
    const classificationIds = rows(row.classificationIds, 64).map(uuid); unique(classificationIds);
    check(classificationIds.every(id => catalogue.categories.some(c => c.id === id && c.competitionId === race!.competitionId && c.target === "individual")));
    check(row.publicationId === race!.publicationId && row.publicationState === race!.publicationState);
    return { id: uuid(row.id), publicationId: uuid(row.publicationId), publicationState: row.publicationState as "official" | "corrected", publishedAt: instant(row.publishedAt), runId: uuid(row.runId),
      athleteId: uuid(row.athleteId), athleteName: row.athleteName === null ? null : text(row.athleteName), raceId, classificationIds,
      participationStatus: row.participationStatus === null ? null : text(row.participationStatus), finishTimeMs: row.finishTimeMs === null ? null : integer(row.finishTimeMs),
      rankOverall: row.rankOverall === null ? null : integer(row.rankOverall, 1), clubId: row.clubId === null ? null : uuid(row.clubId), clubName: row.clubName === null ? null : text(row.clubName) };
  });
  unique(results.map(r => r.id));
  for (const race of races) { const found = results.filter(r => r.raceId === race.id); check(found.length === race.resultCount); check(new Set(found.map(r => r.runId)).size <= 1); }
  const clubs = rows(r.clubs, 1000).map(v => {
    const row = object(v, ["clubId", "name", "rounds"]);
    const rounds = rows(row.rounds, 4).map(v => { const r = object(v, ["slot", "sourceRoundId", "points"]); const slot = integer(r.slot, 1, 4);
      check(catalogue.rounds.some(c => c.slot === slot && c.id === r.sourceRoundId));
      return { slot, sourceRoundId: uuid(r.sourceRoundId), points: integer(r.points) }; });
    unique(rounds.map(r => String(r.slot)));
    return { clubId: uuid(row.clubId), name: row.name === null ? null : text(row.name), rounds };
  }); unique(clubs.map(c => c.clubId));
  const body = { sourceLeagueId: uuid(r.sourceLeagueId), sourceSeasonId: uuid(r.sourceSeasonId), capturedAt: instant(r.capturedAt), catalogue, results, clubs };
  if (workflow) {
    // Owner-approved separate fixture; existing claimed demo profiles are the
    // only cross-namespace identifiers. No ownership, age or consent is asserted.
    const prefix = "9b000000-0000-4000-8000-";
    const recipients = ["9a000000-0000-4000-8000-000000001060", "9a000000-0000-4000-8000-000000001061"];
    const ids = [body.sourceLeagueId, body.sourceSeasonId,
      ...catalogue.rounds.flatMap(round => [round.id, round.editionId, ...round.races.flatMap(race => [race.id, race.competitionId, race.publicationId])]),
      ...catalogue.categories.flatMap(category => [category.id, category.competitionId]),
      ...results.flatMap(row => [row.id, row.publicationId, row.runId, row.raceId, ...row.classificationIds])];
    check(ids.every(id => id !== null && /^9b000000-0000-4000-8000-\d{12}$/.test(id)));
    check(body.sourceLeagueId === `${prefix}000000000050` && body.sourceSeasonId === `${prefix}${r.sourceOrigin === "urn:raceson:synthetic:workflow-20260930:v2" ? "000000000151" : "000000000051"}`);
    check(results.length === 8 && clubs.length === 0 && catalogue.categories.length === 8
      && catalogue.categories.filter(c => c.target === "individual").length === 7
      && catalogue.categories.every(c => c.eligibility.demoOnly === true));
    check(results.every(row => recipients.includes(row.athleteId) && row.clubId === null && row.clubName === null
      && row.athleteName?.includes("Synthetic") && row.participationStatus === "finished"));
    for (const round of catalogue.rounds) {
      check(round.name.includes("Synthetic"));
      const members = results.filter(row => round.races.some(race => race.id === row.raceId));
      check(members.map(row => row.athleteId).sort().join(",") === recipients.join(","));
    }
    return { version: 3, sourceOrigin: r.sourceOrigin as SyntheticRewardSnapshotV3["sourceOrigin"], ...body };
  }
  if (synthetic) {
    // This finite source cannot smuggle real profile/event identifiers into the
    // test cohort. Expanding the cohort needs a separately versioned source.
    const ids = [body.sourceLeagueId, body.sourceSeasonId,
      ...catalogue.rounds.flatMap(round => [round.id, round.editionId, ...round.races.flatMap(race => [race.id, race.competitionId, race.publicationId])]),
      ...catalogue.categories.flatMap(category => [category.id, category.competitionId]),
      ...results.flatMap(row => [row.id, row.publicationId, row.runId, row.athleteId, row.raceId, row.clubId, ...row.classificationIds]),
      ...clubs.flatMap(club => [club.clubId, ...club.rounds.map(round => round.sourceRoundId)])];
    const prefix = privyPilot ? "9a000000" : "8a000000", count = privyPilot ? 10 : 20;
    check(ids.every(id => id !== null && new RegExp(`^${prefix}-0000-4000-8000-\\d{12}$`).test(id)));
    check(body.sourceLeagueId === `${prefix}-0000-4000-8000-000000000050` && body.sourceSeasonId === `${prefix}-0000-4000-8000-000000000051`);
    check(results.length === count * 4 && new Set(results.map(row => row.athleteId)).size === count && clubs.length === 4
      && catalogue.categories.length === 8 && catalogue.categories.filter(category => category.target === "individual").length === 7
      && catalogue.categories.every(category => category.eligibility.demoOnly === true));
    const cohort = [...new Set(results.map(row => row.athleteId))].sort().join(",");
    for (const round of catalogue.rounds) {
      const rows = results.filter(row => round.races.some(race => race.id === row.raceId));
      check(rows.length === count && rows.map(row => row.athleteId).sort().join(",") === cohort);
    }
    return { version: 3, sourceOrigin: privyPilot ? "urn:raceson:synthetic:privy-10:v3" : "urn:raceson:synthetic:compact-20:v3", ...body };
  }
  // The reserved pilot identity cannot be relabelled as a production export.
  check(body.sourceLeagueId !== "8a000000-0000-4000-8000-000000000050"
    && body.sourceSeasonId !== "8a000000-0000-4000-8000-000000000051"
    && body.sourceLeagueId !== "9a000000-0000-4000-8000-000000000050"
    && body.sourceSeasonId !== "9a000000-0000-4000-8000-000000000051"
    && body.sourceLeagueId !== "9b000000-0000-4000-8000-000000000050"
    && body.sourceSeasonId !== "9b000000-0000-4000-8000-000000000051"
    && body.sourceSeasonId !== "9b000000-0000-4000-8000-000000000151");
  return { version: 2, sourceOrigin: "https://www.raceson.com", ...body };
}

type Candidate = { beneficiaryId: string; name: string | null; order: number; evidenceIds: string[]; evidenceValue: number };
export type PublishedRewardAllocation = { beneficiaryId: string; name: string | null; place: number; amountWei: bigint; evidenceIds: string[]; evidenceValue: number };
/** Competition ranking: tied candidates consume all occupied prize slots. */
export function previewPublishedPrizeSlots(slots: Array<{ rank: number; amountWei: bigint }>, candidates: Candidate[]) {
  const ordered = [...candidates].sort((a, b) => a.order - b.order || compareRewardKeys(a.beneficiaryId, b.beneficiaryId));
  unique(ordered.map(c => c.beneficiaryId));
  const awards: PublishedRewardAllocation[] = [];
  for (let i = 0; i < ordered.length;) {
    let end = i + 1; while (end < ordered.length && ordered[end]!.order === ordered[i]!.order) end++;
    const group = ordered.slice(i, end), budget = slots.slice(i, end).reduce((n, s) => n + s.amountWei, 0n);
    const split = allocateRewardWeights(budget, group.map(c => ({ key: c.beneficiaryId, weight: 1n }))).allocations;
    for (const c of group) awards.push({ beneficiaryId: c.beneficiaryId, name: c.name, place: i + 1, amountWei: split.find(a => a.key === c.beneficiaryId)!.amount,
      evidenceIds: c.evidenceIds, evidenceValue: c.evidenceValue });
    i = end;
  }
  return { awards, unusedWei: slots.reduce((n, s) => n + s.amountWei, 0n) - awards.reduce((n, a) => n + a.amountWei, 0n) };
}

export function previewPublishedRewardsV2(rules: RewardProgrammeDraftV2, mapping: RewardSourceMappingV2, input: StoredRewardSnapshot) {
  const snapshot = decodeStoredRewardSnapshot(input), budgets = previewRewardSourceMappingV2(rules, mapping, snapshot.catalogue);
  const finished = snapshot.results.filter(r => r.participationStatus === "finished" && r.finishTimeMs !== null && r.finishTimeMs > 0);
  const duplicateIds = new Set<string>();
  for (const round of snapshot.catalogue.rounds) {
    const ids = new Map<string, number>();
    for (const r of finished.filter(r => round.races.some(c => c.id === r.raceId))) ids.set(r.athleteId, (ids.get(r.athleteId) ?? 0) + 1);
    for (const [id, count] of ids) if (count > 1) duplicateIds.add(`${round.slot}:${id}`);
  }
  const rounds = mapping.rounds.map((mapped, index) => {
    const source = snapshot.catalogue.rounds.find(r => r.id === mapped.roundId);
    const categories = budgets[index]!.families.flatMap(f => f.categories.map(category => {
      const definition = snapshot.catalogue.categories.find(c => c.id === category.categoryId)!;
      const race = source?.races.find(r => r.competitionId === definition.competitionId);
      let blockedReason: "source_missing" | "ambiguous_results" | null = !source ? "source_missing" : null;
      let candidates: Candidate[] = [];
      if (definition.target === "individual") {
        if (!race) blockedReason = "source_missing";
        const raceRows = finished.filter(r => r.raceId === race?.id);
        // Unknown or overlapping classifications can change occupied ranks. Hold
        // the category instead of dropping those athletes and enriching others.
        if (raceRows.some(r => r.classificationIds.length !== 1 || r.rankOverall === null || duplicateIds.has(`${mapped.slot}:${r.athleteId}`))) blockedReason = "ambiguous_results";
        candidates = raceRows.filter(r => r.classificationIds.includes(definition.id)).map(r => ({ beneficiaryId: r.athleteId, name: r.athleteName,
          order: r.rankOverall!, evidenceIds: [r.id], evidenceValue: r.rankOverall! }));
      } else if (source) {
        candidates = snapshot.clubs.flatMap(c => { const row = c.rounds.find(r => r.sourceRoundId === source.id && r.points > 0);
          return row ? [{ beneficiaryId: c.clubId, name: c.name, order: -row.points, evidenceIds: [row.sourceRoundId], evidenceValue: row.points }] : []; });
      }
      const allocation = blockedReason ? { awards: [], unusedWei: category.amountWei } : previewPublishedPrizeSlots(category.slots, candidates);
      return { categoryId: category.categoryId, target: definition.target, label: `${definition.competitionName} · ${definition.name}`,
        budgetWei: category.amountWei, blockedReason, ...allocation };
    }));
    const budgetWei = budgets[index]!.families.reduce((n, f) => n + f.amountWei, 0n);
    const proposedWei = categories.reduce((n, c) => n + c.awards.reduce((sum, a) => sum + a.amountWei, 0n), 0n);
    return { slot: mapped.slot, sourceName: source?.name ?? null, budgetWei, proposedWei, retainedWei: budgetWei - proposedWei, categories };
  });
  // Display completed metres only. No four-round denominator masquerades as
  // the final five-round participation distribution.
  const metres = new Map<string, { athleteId: string; name: string | null; metres: bigint; finishes: number }>();
  for (const round of snapshot.catalogue.rounds) for (const r of finished.filter(r => round.races.some(c => c.id === r.raceId))) {
    if (duplicateIds.has(`${round.slot}:${r.athleteId}`)) continue;
    const distance = round.races.find(c => c.id === r.raceId)!.distanceMetres; if (!distance) continue;
    const previous = metres.get(r.athleteId) ?? { athleteId: r.athleteId, name: r.athleteName, metres: 0n, finishes: 0 };
    previous.metres += BigInt(distance); previous.finishes++; metres.set(r.athleteId, previous);
  }
  return { state: "unapproved_snapshot_preview" as const, payableWei: 0n, reviewStartedAt: null,
    resultCount: snapshot.results.length, finishedCount: finished.length, duplicateAthleteRounds: duplicateIds.size,
    unclassifiedFinishes: finished.filter(r => r.classificationIds.length !== 1).length,
    rounds, leagueRetainedWei: budgets[5]!.families.reduce((n, f) => n + f.amountWei, 0n),
    participation: [...metres.values()].sort((a, b) => a.metres === b.metres ? compareRewardKeys(a.athleteId, b.athleteId) : a.metres > b.metres ? -1 : 1) };
}
