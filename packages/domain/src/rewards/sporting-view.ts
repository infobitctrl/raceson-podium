import { parseRewardUnits, requireRewardKey } from "./arithmetic.js";
import { parseRewardSourceTimestamp } from "./source-evidence.js";
import { rewardDistributionUuid as uuid } from "./distribution-view.js";
import { rewardPreviewFamilies, type RewardPreparationSelection } from "./preparation-view.js";

function demand(v: unknown): asserts v { if (!v) throw Error("invalid_reward_sporting_document"); }
function object(v: unknown, keys: readonly string[]) {
  demand(v !== null && typeof v === "object" && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v)));
  const fields = Object.getOwnPropertyDescriptors(v);
  demand(!Object.getOwnPropertySymbols(v).length && Object.keys(fields).length === keys.length && keys.every(k => fields[k]?.enumerable && "value" in fields[k]));
  return v as Record<string, unknown>;
}
function array<T>(v: unknown, max: number, decode: (v: unknown) => T): T[] {
  demand(Array.isArray(v) && v.length <= max); const fields = Object.getOwnPropertyDescriptors(v);
  demand(!Object.getOwnPropertySymbols(v).length && Object.keys(fields).length === v.length + 1);
  return Array.from({ length: v.length }, (_, i) => { demand(fields[i]?.enumerable && "value" in fields[i]); return decode(fields[i].value); });
}
function count(v: unknown, max = 20_000) { demand(typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= max); return v; }
function amount(v: unknown) { demand(typeof v === "string" && /^(0|[1-9][0-9]{0,77})$/.test(v)); parseRewardUnits(v, 0); return v; }
function label(v: unknown) { demand(v === null || (typeof v === "string" && v.trim() === v && v.length > 0 && [...v].length <= 256)); return v as string | null; }
function key(v: unknown) { demand(typeof v === "string"); requireRewardKey(v); return v; }
function timestamp(v: unknown) { parseRewardSourceTimestamp(v); return v as string; }
function ids(v: unknown, max = 7) { const list = array(v, max, uuid); demand(new Set(list).size === list.length); return list; }
const scopeKeys = ["programmeId", "chainId", "campaignId"];
function scope(d: Record<string, unknown>, expected: RewardPreparationSelection) {
  demand((expected.chainId === 10143 || expected.chainId === 31337) && d.chainId === expected.chainId
    && d.programmeId === uuid(expected.programmeId) && d.campaignId === uuid(expected.campaignId));
  return { programmeId: expected.programmeId, campaignId: expected.campaignId, chainId: expected.chainId };
}
export function decodeRewardSportingSource(v: unknown, expected: RewardPreparationSelection, snapshotId: string | null, after: string | null = null) {
  const d = object(v, [...scopeKeys, "latestReviewId", "latestRevision", "allocationId", "source"]), fixed = scope(d, expected);
  const latestReviewId = d.latestReviewId === null ? null : uuid(d.latestReviewId), latestRevision = count(d.latestRevision, 2147483646),
    allocationId = d.allocationId === null ? null : uuid(d.allocationId);
  demand((latestRevision === 0) === (latestReviewId === null));
  const base = { ...fixed, latestReviewId, latestRevision, allocationId };
  if (d.source === null) { demand(snapshotId === null && after === null && latestRevision === 0 && allocationId === null); return { ...base, source: null }; }
  const s = object(d.source, ["snapshotId", "capturedAt", "pot", "budgetWei", "resultCount", "finishedCount", "uncertainMembershipCount", "duplicateGroupCount", "classifications", "rounds", "items", "nextCursor"]);
  const sourceId = uuid(s.snapshotId); demand(snapshotId === null || uuid(snapshotId) === sourceId); demand(after === null || snapshotId !== null);
  demand(s.pot === "race" || s.pot === "league");
  const pot: "race" | "league" = s.pot;
  const resultCount = count(s.resultCount), finishedCount = count(s.finishedCount), uncertainMembershipCount = count(s.uncertainMembershipCount), duplicateGroupCount = count(s.duplicateGroupCount);
  demand(finishedCount <= resultCount && uncertainMembershipCount <= finishedCount && duplicateGroupCount * 2 <= finishedCount);
  const classifications = array(s.classifications, 7, v => {
    const c = object(v, ["id", "name", "competitionId", "gender", "minimumAgeHundredths", "maximumAgeHundredths"]);
    demand(c.gender === null || c.gender === "M" || c.gender === "F");
    const min = c.minimumAgeHundredths === null ? null : amount(c.minimumAgeHundredths), max = c.maximumAgeHundredths === null ? null : amount(c.maximumAgeHundredths);
    demand((min === null || BigInt(min) <= 15000n) && (max === null || BigInt(max) <= 15000n) && (min === null || max === null || BigInt(min) <= BigInt(max)));
    return { id: uuid(c.id), name: label(c.name), competitionId: uuid(c.competitionId), gender: c.gender, minimumAgeHundredths: min, maximumAgeHundredths: max };
  });
  demand(classifications.length === 7 && new Set(classifications.map(c => c.id)).size === 7);
  const rounds = array(s.rounds, 5, v => {
    const r = object(v, ["id", "number", "sourceReviewEndsAtSeconds", "openCaseIds", "races"]), number = count(r.number, 5); demand(number > 0);
    const races = array(r.races, 2, v => { const race = object(v, ["id", "competitionId", "distanceMetres"]), distanceMetres = amount(race.distanceMetres);
      demand(BigInt(distanceMetres) > 0n); return { id: uuid(race.id), competitionId: uuid(race.competitionId), distanceMetres }; });
    demand(races.length === 2 && new Set(races.map(r => r.competitionId)).size === 2);
    demand(classifications.every(c => races.some(r => r.competitionId === c.competitionId)));
    return { id: uuid(r.id), number, sourceReviewEndsAtSeconds: amount(r.sourceReviewEndsAtSeconds), openCaseIds: ids(r.openCaseIds, 20_000), races };
  });
  demand(rounds.length === (s.pot === "race" ? 1 : 5) && new Set(rounds.map(r => r.id)).size === rounds.length && new Set(rounds.map(r => r.number)).size === rounds.length);
  demand(new Set(rounds.flatMap(r => r.races.map(r => r.id))).size === rounds.length * 2);
  let previous = after === null ? null : uuid(after);
  const items = array(s.items, 25, v => {
    const r = object(v, ["sourceId", "roundId", "raceId", "publicationId", "athleteId", "athleteName", "representedClubId", "clubName", "finishTimeMs", "distanceMetres",
      "participationStatus", "resultStatus", "classificationIds", "possibleClassificationIds", "sameAthleteRoundFinishCount", "publishedRanks"]);
    const sourceId = uuid(r.sourceId), roundId = uuid(r.roundId), raceId = uuid(r.raceId), round = rounds.find(x => x.id === roundId), race = round?.races.find(x => x.id === raceId);
    demand(race && (previous === null || sourceId > previous)); previous = sourceId;
    const known = ids(r.classificationIds), possible = ids(r.possibleClassificationIds);
    demand(known.length <= 1 && [...known, ...possible].every(id => classifications.some(c => c.id === id && c.competitionId === race.competitionId))
      && !known.some(id => possible.includes(id)));
    const ranks = object(r.publishedRanks, ["overall", "gender", "ageCategory"]);
    const rank = (v: unknown) => { if (v === null) return null; const n = count(v); demand(n > 0); return n; };
    const distanceMetres = amount(r.distanceMetres), finishTimeMs = r.finishTimeMs === null ? null : amount(r.finishTimeMs);
    demand(distanceMetres === race.distanceMetres && (finishTimeMs === null || BigInt(finishTimeMs) > 0n));
    return { sourceId, roundId, raceId, publicationId: uuid(r.publicationId), athleteId: uuid(r.athleteId), athleteName: label(r.athleteName),
      representedClubId: r.representedClubId === null ? null : uuid(r.representedClubId), clubName: label(r.clubName), finishTimeMs, distanceMetres,
      participationStatus: key(r.participationStatus), resultStatus: key(r.resultStatus), classificationIds: known, possibleClassificationIds: possible,
      sameAthleteRoundFinishCount: count(r.sameAthleteRoundFinishCount), publishedRanks: { overall: rank(ranks.overall), gender: rank(ranks.gender), ageCategory: rank(ranks.ageCategory) } };
  });
  demand(items.length <= resultCount && (s.nextCursor === null || (items.length === 25 && uuid(s.nextCursor) === previous)));
  if (after === null && s.nextCursor === null) demand(items.length === resultCount);
  return { ...base, source: { snapshotId: sourceId, capturedAt: timestamp(s.capturedAt), pot, budgetWei: amount(s.budgetWei),
    resultCount, finishedCount, uncertainMembershipCount, duplicateGroupCount, classifications, rounds, items, nextCursor: s.nextCursor as string | null } };
}
export function decodeRewardSportingPreview(v: unknown, expected: RewardPreparationSelection & { snapshotId: string; expectedRevision: number }, pot: "race" | "league") {
  const p = object(v, [...scopeKeys, "snapshotId", "expectedRevision", "previewDigest", "budgetWei", "allocatedWei", "unallocatedWei", "awardCount", "selectedFinishCount", "excludedFinishCount", "sourceReviewEndsAtSeconds", "families"]), fixed = scope(p, expected);
  demand(p.snapshotId === uuid(expected.snapshotId) && p.expectedRevision === count(expected.expectedRevision, 2147483645));
  demand(typeof p.previewDigest === "string" && /^[0-9a-f]{64}$/.test(p.previewDigest));
  const budgetWei = amount(p.budgetWei), allocatedWei = amount(p.allocatedWei), unallocatedWei = amount(p.unallocatedWei);
  demand(BigInt(allocatedWei) + BigInt(unallocatedWei) === BigInt(budgetWei));
  const budgets = rewardPreviewFamilies(pot, BigInt(budgetWei)), families = array(p.families, 3, v => {
    const f = object(v, ["family", "budgetWei", "allocatedWei"]), rule = budgets.find(b => b.key === f.family); demand(rule);
    const budget = amount(f.budgetWei), allocated = amount(f.allocatedWei); demand(budget === rule.amount.toString() && BigInt(allocated) <= BigInt(budget));
    return { family: rule.key, budgetWei: budget, allocatedWei: allocated };
  });
  demand(families.length === budgets.length && new Set(families.map(f => f.family)).size === families.length
    && families.reduce((sum, f) => sum + BigInt(f.allocatedWei), 0n) === BigInt(allocatedWei));
  const awardCount = count(p.awardCount); demand((awardCount === 0) === (allocatedWei === "0"));
  return { ...fixed, snapshotId: expected.snapshotId, expectedRevision: expected.expectedRevision, previewDigest: p.previewDigest,
    budgetWei, allocatedWei, unallocatedWei, awardCount, selectedFinishCount: count(p.selectedFinishCount), excludedFinishCount: count(p.excludedFinishCount),
    sourceReviewEndsAtSeconds: amount(p.sourceReviewEndsAtSeconds), families };
}
export function decodeRewardSportingCapture(v: unknown, expected: RewardPreparationSelection) {
  const d = object(v, [...scopeKeys, "snapshotId", "capturedAt"]); return { ...scope(d, expected), snapshotId: uuid(d.snapshotId), capturedAt: timestamp(d.capturedAt) };
}
export function decodeRewardSportingSaved(v: unknown, expected: RewardPreparationSelection & { snapshotId: string }) {
  const d = object(v, [...scopeKeys, "snapshotId", "reviewId", "revision", "reviewedAt"]), fixed = scope(d, expected), revision = count(d.revision, 2147483646);
  demand(d.snapshotId === uuid(expected.snapshotId) && revision > 0);
  return { ...fixed, snapshotId: expected.snapshotId, reviewId: uuid(d.reviewId), revision, reviewedAt: timestamp(d.reviewedAt) };
}
export function decodeRewardSportingRecord(v: unknown, expected: RewardPreparationSelection & { snapshotId: string; approvalId: string }) {
  const d = object(v, [...scopeKeys, "snapshotId", "approvalId", "raceId", "gender", "baseline"]), fixed = scope(d, expected);
  demand(d.snapshotId === uuid(expected.snapshotId) && d.approvalId === uuid(expected.approvalId) && (d.gender === "M" || d.gender === "F"));
  const b = object(d.baseline, ["approvalId", "publicationId", "establishedAtMs", "finishTimeMs", "courseComparisonKey"]);
  demand(b.approvalId === expected.approvalId); const finishTimeMs = amount(b.finishTimeMs); demand(BigInt(finishTimeMs) > 0n);
  return { ...fixed, snapshotId: expected.snapshotId, approvalId: expected.approvalId, raceId: uuid(d.raceId), gender: d.gender,
    baseline: { approvalId: expected.approvalId, publicationId: uuid(b.publicationId), establishedAtMs: amount(b.establishedAtMs), finishTimeMs, courseComparisonKey: key(b.courseComparisonKey) } };
}
export type RewardSportingSourceView = ReturnType<typeof decodeRewardSportingSource>;
export type RewardSportingSource = NonNullable<RewardSportingSourceView["source"]>;
export type RewardSportingRow = RewardSportingSource["items"][number];
export type RewardSportingPreview = ReturnType<typeof decodeRewardSportingPreview>;
export type RewardSportingRecord = ReturnType<typeof decodeRewardSportingRecord>;
