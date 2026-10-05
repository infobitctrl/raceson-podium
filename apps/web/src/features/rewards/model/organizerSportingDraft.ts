import type { RewardSportingSource, RewardSportingRow, RewardSportingRecord } from "@raceson/domain/rewards";

export type SportingDraft = {
  reference: string;
  selections: Record<string, { selected: string; evidence: string }>;
  memberships: Record<string, { classification: string; evidence: string }>;
  ranks: Record<string, Record<string, string>>;
  records: Record<string, { choice: "none" | "approved"; approval: RewardSportingRecord | null }>;
};
export const emptySportingDraft = (): SportingDraft => ({ reference: "", selections: {}, memberships: {}, ranks: {}, records: {} });
export function sportingTime(ms: string | null) {
  if (ms === null) return "—"; const n = BigInt(ms);
  return `${n / 3600000n}:${String(n / 60000n % 60n).padStart(2, "0")}:${String(n / 1000n % 60n).padStart(2, "0")}.${String(n % 1000n).padStart(3, "0")}`;
}
export const sportingGroupKey = (r: RewardSportingRow) => `${r.roundId}:${r.athleteId}`;
export function sportingGroups(source: RewardSportingSource) {
  const groups = new Map<string, RewardSportingRow[]>();
  for (const row of source.items) if (row.participationStatus === "finished") {
    const key = sportingGroupKey(row); const rows = groups.get(key) ?? []; rows.push(row); groups.set(key, rows);
  }
  return [...groups].map(([key, rows]) => ({ key, rows }));
}
export function selectedSportingRows(source: RewardSportingSource, draft: SportingDraft) {
  return sportingGroups(source).flatMap(g => {
    const selected = draft.selections[g.key]?.selected ?? (g.rows.length === 1 ? g.rows[0].sourceId : "");
    return g.rows.filter(r => r.sourceId === selected);
  });
}
export function sportingMembers(source: RewardSportingSource, draft: SportingDraft, classificationId: string) {
  return selectedSportingRows(source, draft).filter(r => r.classificationIds.includes(classificationId)
    || (r.possibleClassificationIds.includes(classificationId) && draft.memberships[r.sourceId]?.classification === classificationId));
}
export function suggestSportingRanks(source: RewardSportingSource, draft: SportingDraft) {
  return Object.fromEntries(source.classifications.map(c => {
    const members = [...sportingMembers(source, draft, c.id)].sort((a, b) => {
      const left = BigInt(a.finishTimeMs!), right = BigInt(b.finishTimeMs!);
      return left < right ? -1 : left > right ? 1 : a.sourceId.localeCompare(b.sourceId);
    });
    let rank = 0;
    return [c.id, Object.fromEntries(members.map((r, i) => {
      if (i === 0 || r.finishTimeMs !== members[i - 1].finishTimeMs) rank = i + 1;
      return [r.sourceId, String(rank)];
    }))];
  }));
}
function need(v: unknown, code: string): asserts v { if (!v) throw Error(code); }
const evidence = (v: string | undefined) => typeof v === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,99}$/.test(v);
/** Builds sporting decisions only; no amount, wallet, actor or readiness field. */
export function buildSportingReview(source: RewardSportingSource, draft: SportingDraft) {
  need(source.nextCursor === null && source.items.length === source.resultCount, "load_all");
  need(!source.rounds.some(r => r.openCaseIds.length), "open_cases");
  if (source.pot === "race") need(evidence(draft.reference), "reference");
  const adjudications = sportingGroups(source).flatMap(g => {
    const decision = draft.selections[g.key], selected = decision?.selected ?? (g.rows.length === 1 ? g.rows[0].sourceId : "");
    need(selected === "exclude" || g.rows.some(r => r.sourceId === selected), "duplicates");
    if (g.rows.length === 1 && selected === g.rows[0].sourceId) return [];
    need(evidence(decision?.evidence), "duplicates");
    return [{ roundId: g.rows[0].roundId, athleteId: g.rows[0].athleteId, sourceIds: g.rows.map(r => r.sourceId).sort(),
      selectedSourceId: selected === "exclude" ? null : selected, approvalId: decision!.evidence }];
  });
  const base = { schemaVersion: 1 as const, adjudications };
  if (source.pot === "league") return { ...base, roundReviews: [] };
  const selected = selectedSportingRows(source, draft), round = source.rounds[0];
  const memberships = selected.filter(r => r.possibleClassificationIds.length > 0).map(r => {
    const decision = draft.memberships[r.sourceId];
    need(decision && (decision.classification === "none" || r.possibleClassificationIds.includes(decision.classification))
      && evidence(decision.evidence), "memberships");
    return { sourceId: r.sourceId, classificationIds: decision.classification === "none" ? [] : [decision.classification], evidenceId: decision.evidence };
  });
  const podiums = source.classifications.map(c => ({ classificationId: c.id, approvalId: `${draft.reference}.podium.${c.id}`,
    entries: sportingMembers(source, draft, c.id).map(r => {
      const value = draft.ranks[c.id]?.[r.sourceId]; need(value && /^[1-9][0-9]{0,4}$/.test(value) && Number(value) <= 20000, "ranks");
      return { sourceId: r.sourceId, rank: Number(value) };
    }) }));
  const records = round.races.flatMap(race => (["M", "F"] as const).map(gender => {
    const id = `${race.id}:${gender}`, decision = draft.records[id]; need(decision, "records");
    if (decision.choice === "none") return { id, raceId: race.id, gender, baseline: null };
    const a = decision.approval;
    need(a && a.snapshotId === source.snapshotId && a.raceId === race.id && a.gender === gender, "records");
    return { id, raceId: race.id, gender, baseline: { ...a.baseline } };
  }));
  return { ...base, roundReviews: [{ roundId: round.id, memberships, podiums, records }] };
}
export type SportingReviewWire = ReturnType<typeof buildSportingReview>;
export type SportingReviewRequest = { snapshotId: string; expectedRevision: number; review: SportingReviewWire };
export type SportingReviewConfirmation = SportingReviewRequest & { previewDigest: string; idempotencyKey: string; confirmReview: true };
