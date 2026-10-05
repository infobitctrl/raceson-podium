import { allocateRewardWeights, compareRewardKeys, requireReward } from "./arithmetic.js";
import { decodeRewardProgrammeDraftV2, previewRewardProgrammeDraftV2, previewRewardRankSlotsV2, type RewardProgrammeDraftV2 } from "./programme-draft-v2.js";
import { decodeRewardSourceMappingV2, type RewardSourceMappingV2 } from "./source-mapping-v2.js";

/** A minimized calculation input, NOT authenticated publication or payment authority.
 * Adapters must attest completeness, sporting eligibility and official ranks.
 * Hashes are opaque source references here; future persistence must bind and
 * recompute the whole immutable input. No browser-supplied input may approve it.
 * V2 imported/frozen evidence and its review marker are intentionally unchanged.
 */
export type RewardAllocationSourceV3 = {
  version: 3;
  kind: "synthetic_rehearsal" | "minimized_source";
  sourceLeagueId: string;
  sourceSeasonId: string;
  capturedAt: string;
  categories: Array<{ id: string; target: "individual" | "club" }>;
  rounds: Array<{
    slot: number; roundId: string | null; evidence: RewardSourceEvidenceV3 | null;
    resultsComplete: boolean; expectedResultCount: number;
    results: Array<{
      id: string; athleteId: string; categoryId: string | null; clubId: string | null;
      status: "finished" | "dns" | "dnf" | "dsq" | "unknown";
      distanceMetres: string | null;
    }>;
  }>;
  league: { evidence: RewardSourceEvidenceV3; roundDigests: string[] } | null;
  standings: Array<{
    slot: number | null; categoryId: string; complete: boolean;
    evidence: RewardSourceEvidenceV3; roundDigests: string[];
    rows: Array<{ sourceRowId: string; beneficiaryId: string; rank: number }>;
  }>;
};
export type RewardSourceEvidenceV3 = {
  kind: "historical_final" | "native_final" | "synthetic";
  digest: string; publishedAt: string; held: boolean;
};
export type RewardAllocationHoldV3 = "source_missing" | "source_held" | "incomplete_results" |
  "ambiguous_results" | "missing_distance" | "league_not_final" | "source_changed" |
  "standings_missing" | "incomplete_standings" | "invalid_standings" | "category_overlap";

const code = "invalid_v3_allocation_source";
function check(v: unknown): asserts v { requireReward(v, code); }
function object(v: unknown, keys: string[]) {
  check(v && typeof v === "object" && !Array.isArray(v)); const r = v as Record<string, unknown>;
  check(Object.keys(r).length === keys.length && keys.every(k => Object.hasOwn(r, k))); return r;
}
function uuid(v: unknown): string {
  check(typeof v === "string" && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(v)
    && v !== "00000000-0000-0000-0000-000000000000"); return v;
}
function hash(v: unknown): string { check(typeof v === "string" && /^[0-9a-f]{64}$/.test(v)); return v; }
function integer(v: unknown, max: number, min = 0): number { check(typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max); return v; }
function flag(v: unknown): boolean { check(typeof v === "boolean"); return v; }
function rows(v: unknown, max: number): unknown[] { check(Array.isArray(v) && v.length <= max); return v; }
function unique(v: string[]) { check(new Set(v).size === v.length); }
function instant(v: unknown): string {
  check(typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)
    && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v); return v;
}

export function decodeRewardAllocationSourceV3(value: unknown): RewardAllocationSourceV3 {
  const r = object(value, ["version", "kind", "sourceLeagueId", "sourceSeasonId", "capturedAt", "categories", "rounds", "league", "standings"]);
  check(r.version === 3 && (r.kind === "synthetic_rehearsal" || r.kind === "minimized_source"));
  const capturedAt = instant(r.capturedAt);
  function evidence(value: unknown): RewardSourceEvidenceV3 {
    const e = object(value, ["kind", "digest", "publishedAt", "held"]);
    check(r.kind === "synthetic_rehearsal" ? e.kind === "synthetic" : e.kind === "historical_final" || e.kind === "native_final");
    const publishedAt = instant(e.publishedAt); check(publishedAt <= capturedAt);
    return { kind: e.kind as RewardSourceEvidenceV3["kind"], digest: hash(e.digest), publishedAt, held: flag(e.held) };
  }
  const categories = rows(r.categories, 64).map(value => {
    const c = object(value, ["id", "target"]); check(c.target === "individual" || c.target === "club");
    return { id: uuid(c.id), target: c.target as "individual" | "club" };
  }); unique(categories.map(c => c.id));
  const categoryById = new Map(categories.map(c => [c.id, c]));
  const rounds = rows(r.rounds, 5).map((value, i) => {
    const round = object(value, ["slot", "roundId", "evidence", "resultsComplete", "expectedResultCount", "results"]);
    check(round.slot === i + 1);
    const resultRows = rows(round.results, 10000).map(value => {
      const row = object(value, ["id", "athleteId", "categoryId", "clubId", "status", "distanceMetres"]);
      check(["finished", "dns", "dnf", "dsq", "unknown"].includes(row.status as string));
      const categoryId = row.categoryId === null ? null : uuid(row.categoryId);
      check(categoryId === null || categoryById.get(categoryId)?.target === "individual");
      check(row.distanceMetres === null || typeof row.distanceMetres === "string" && /^[1-9]\d{0,8}$/.test(row.distanceMetres));
      return { id: uuid(row.id), athleteId: uuid(row.athleteId), categoryId, clubId: row.clubId === null ? null : uuid(row.clubId),
        status: row.status as RewardAllocationSourceV3["rounds"][number]["results"][number]["status"], distanceMetres: row.distanceMetres as string | null };
    });
    const result = { slot: i + 1, roundId: round.roundId === null ? null : uuid(round.roundId), evidence: round.evidence === null ? null : evidence(round.evidence),
      resultsComplete: flag(round.resultsComplete), expectedResultCount: integer(round.expectedResultCount, 10000), results: resultRows };
    check(result.roundId !== null || result.evidence === null && !result.resultsComplete && !result.expectedResultCount && !result.results.length);
    return result;
  });
  check(rounds.length === 5); unique(rounds.flatMap(r => r.roundId ? [r.roundId] : []));
  unique(rounds.flatMap(r => r.results.map(row => row.id)));
  const leagueRow = r.league === null ? null : object(r.league, ["evidence", "roundDigests"]);
  const league = leagueRow ? { evidence: evidence(leagueRow.evidence), roundDigests: rows(leagueRow.roundDigests, 5).map(hash) } : null;
  const standings = rows(r.standings, 384).map(value => {
    const table = object(value, ["slot", "categoryId", "complete", "evidence", "roundDigests", "rows"]);
    const categoryId = uuid(table.categoryId); check(categoryById.has(categoryId));
    const tableRows = rows(table.rows, 10000).map(value => {
      const row = object(value, ["sourceRowId", "beneficiaryId", "rank"]);
      return { sourceRowId: uuid(row.sourceRowId), beneficiaryId: uuid(row.beneficiaryId), rank: integer(row.rank, 10000, 1) };
    }); unique(tableRows.map(row => row.beneficiaryId)); unique(tableRows.map(row => row.sourceRowId));
    return { slot: table.slot === null ? null : integer(table.slot, 5, 1), categoryId, complete: flag(table.complete), evidence: evidence(table.evidence),
      roundDigests: rows(table.roundDigests, 5).map(hash), rows: tableRows.sort((a, b) => a.rank - b.rank || compareRewardKeys(a.beneficiaryId, b.beneficiaryId)) };
  });
  unique(standings.map(t => `${t.slot}:${t.categoryId}`));
  check(standings.reduce((n, t) => n + t.rows.length, 0) <= 100000);
  return { version: 3, kind: r.kind, sourceLeagueId: uuid(r.sourceLeagueId), sourceSeasonId: uuid(r.sourceSeasonId), capturedAt, categories,
    rounds, league, standings: standings.sort((a, b) => (a.slot ?? 6) - (b.slot ?? 6) || compareRewardKeys(a.categoryId, b.categoryId)) };
}

/** Strict competition ranks (1,1,3), NOT a sort key that can promote rank 2 to 1. */
function validRanks(table: RewardAllocationSourceV3["standings"][number]) {
  for (let i = 0; i < table.rows.length;) {
    if (table.rows[i]!.rank !== i + 1) return false;
    const rank = table.rows[i]!.rank;
    do { i++; } while (i < table.rows.length && table.rows[i]!.rank === rank);
  }
  return true;
}
function equal(a: readonly string[], b: readonly string[]) { return a.length === b.length && a.every((v, i) => v === b[i]); }

export function previewRewardAllocationV3(ruleInput: RewardProgrammeDraftV2, mappingInput: RewardSourceMappingV2, sourceInput: RewardAllocationSourceV3) {
  const rules = decodeRewardProgrammeDraftV2(ruleInput), mapping = decodeRewardSourceMappingV2(mappingInput), source = decodeRewardAllocationSourceV3(sourceInput);
  const budget = previewRewardProgrammeDraftV2(rules), categories = new Map(source.categories.map(c => [c.id, c]));
  for (const mapped of mapping.rounds) check(mapped.roundId === null || mapped.roundId === source.rounds[mapped.slot - 1]!.roundId);
  for (const shares of [...mapping.rounds.map(r => r.categories), mapping.leagueCategories]) {
    check(shares.every(s => categories.has(s.categoryId)));
    for (const target of ["individual", "club"]) check(shares.filter(s => categories.get(s.categoryId)!.target === target).reduce((n, s) => n + s.shareBps, 0) <= 10000);
  }
  const roundHolds: Array<RewardAllocationHoldV3 | null> = source.rounds.map((r, i) => {
    if (!r.evidence || !mapping.rounds[i]!.roundId) return "source_missing";
    if (r.evidence.held) return "source_held";
    if (!r.resultsComplete || r.results.length !== r.expectedResultCount) return "incomplete_results";
    // More than one result for an athlete in a round is unresolved even if one
    // says DNF. Do not guess which start/result represents the official finish.
    if (r.results.some(row => row.status === "unknown") || new Set(r.results.map(row => row.athleteId)).size !== r.results.length) return "ambiguous_results";
    return null;
  });
  const digests = source.rounds.flatMap(r => r.evidence ? [r.evidence.digest] : []);
  const leagueHold: RewardAllocationHoldV3 | null = roundHolds.some(Boolean) || !source.league ? "league_not_final"
    : source.league.evidence.held ? "source_held" : !equal(source.league.roundDigests, digests) ? "source_changed"
    : source.rounds.some(r => r.evidence!.publishedAt > source.league!.evidence.publishedAt) ? "source_changed" : null;
  function familyPreview(slot: number | null, family: { key: string; amount: bigint }) {
    const target = family.key === "athlete_standings" ? "individual" : "club";
    const selected = (slot === null ? mapping.leagueCategories : mapping.rounds[slot - 1]!.categories).filter(s => categories.get(s.categoryId)!.target === target);
    const split = allocateRewardWeights(family.amount, [...selected.map(s => ({ key: s.categoryId, weight: BigInt(s.shareBps) })),
      { key: "unassigned", weight: BigInt(10000 - selected.reduce((n, s) => n + s.shareBps, 0)) }]).allocations;
    const allResults = (slot === null ? source.rounds : [source.rounds[slot - 1]!]).flatMap(r => r.results).filter(r => r.status === "finished");
    const tables = source.standings.filter(t => t.slot === slot && selected.some(s => s.categoryId === t.categoryId));
    const overlapping = new Set<string>();
    const seen = new Set<string>();
    for (const table of tables) for (const row of table.rows) { if (seen.has(row.beneficiaryId)) overlapping.add(row.beneficiaryId); seen.add(row.beneficiaryId); }
    const previews = selected.map(selectedCategory => {
      const categoryId = selectedCategory.categoryId, amountWei = split.find(s => s.key === categoryId)!.amount;
      const slots = previewRewardRankSlotsV2(amountWei, slot === null ? rules.leagueRankWeights : rules.raceRankWeights);
      const table = tables.find(t => t.categoryId === categoryId);
      let hold: RewardAllocationHoldV3 | null = slot === null ? leagueHold : roundHolds[slot - 1]!;
      const expectedDigests = slot === null ? digests : source.rounds[slot - 1]!.evidence ? [source.rounds[slot - 1]!.evidence!.digest] : [];
      const expectedPublishedAt = slot === null ? source.league?.evidence.publishedAt : source.rounds[slot - 1]!.evidence?.publishedAt;
      if (!hold && target === "individual" && allResults.some(r => r.categoryId === null)) hold = "ambiguous_results";
      if (!hold && !table) hold = "standings_missing";
      if (!hold && table) {
        if (table.evidence.held) hold = "source_held";
        else if (!table.complete) hold = "incomplete_standings";
        else if (!equal(table.roundDigests, expectedDigests) || !expectedPublishedAt || table.evidence.publishedAt < expectedPublishedAt) hold = "source_changed";
        else if (!validRanks(table)) hold = "invalid_standings";
        else if (table.rows.some(r => overlapping.has(r.beneficiaryId))) hold = "category_overlap";
        else {
          const eligible = new Set(allResults.filter(r => target === "club" ? r.clubId !== null : r.categoryId === categoryId).map(r => target === "club" ? r.clubId! : r.athleteId));
          // League minimum-finish/best-N eligibility and club scoring belong to
          // the final official table, not a new reward-specific points engine.
          if (table.rows.some(r => !eligible.has(r.beneficiaryId)) || slot !== null && target === "individual" && table.rows.length !== eligible.size) hold = "invalid_standings";
        }
      }
      const awards: Array<{ beneficiaryId: string; sourceRowId: string; rank: number; amountWei: bigint }> = [];
      if (!hold && table) for (let i = 0; i < table.rows.length;) {
        let end = i + 1; while (end < table.rows.length && table.rows[end]!.rank === table.rows[i]!.rank) end++;
        const group = table.rows.slice(i, end), occupiedWei = slots.slice(i, end).reduce((n, s) => n + s.amountWei, 0n);
        const tied = new Map(allocateRewardWeights(occupiedWei, group.map(r => ({ key: r.beneficiaryId, weight: 1n }))).allocations.map(a => [a.key, a.amount]));
        for (const row of group) awards.push({ ...row, amountWei: tied.get(row.beneficiaryId)! });
        i = end;
      }
      const proposedWei = awards.reduce((n, a) => n + a.amountWei, 0n);
      return { categoryId, target, budgetWei: amountWei, proposedWei, retainedWei: amountWei - proposedWei, hold, awards, slots };
    });
    const proposedWei = previews.reduce((n, p) => n + p.proposedWei, 0n);
    return { key: family.key, budgetWei: family.amount, proposedWei, retainedWei: family.amount - proposedWei,
      unassignedWei: split.find(s => s.key === "unassigned")!.amount, categories: previews };
  }
  const rounds = budget.rounds.map((r, i) => {
    const families = r.families.map(f => familyPreview(i + 1, f)), proposedWei = families.reduce((n, f) => n + f.proposedWei, 0n);
    return { slot: i + 1, budgetWei: r.amountWei, proposedWei, retainedWei: r.amountWei - proposedWei, families };
  });
  const leagueFamilies = budget.leagueFamilies.filter(f => f.key !== "participation_metres").map(f => familyPreview(null, f));
  const participationBudget = budget.leagueFamilies.find(f => f.key === "participation_metres")!.amount;
  let participationHold: RewardAllocationHoldV3 | null = leagueHold;
  const finished = source.rounds.flatMap(r => r.results.filter(row => row.status === "finished"));
  if (!participationHold && finished.some(r => r.distanceMetres === null)) participationHold = "missing_distance";
  const distances = new Map<string, { metres: bigint; finishes: number; resultIds: string[] }>();
  if (!participationHold) for (const result of finished) {
    const prior = distances.get(result.athleteId) ?? { metres: 0n, finishes: 0, resultIds: [] };
    prior.metres += BigInt(result.distanceMetres!); prior.finishes++; prior.resultIds.push(result.id); distances.set(result.athleteId, prior);
  }
  const awards = allocateRewardWeights(participationBudget, [...distances].map(([key, value]) => ({ key, weight: value.metres }))).allocations.map(a => ({
    beneficiaryId: a.key, amountWei: a.amount, metres: a.weight, finishes: distances.get(a.key)!.finishes, resultIds: distances.get(a.key)!.resultIds.sort(compareRewardKeys),
  }));
  const participationProposed = awards.reduce((n, a) => n + a.amountWei, 0n);
  const participation = { budgetWei: participationBudget, proposedWei: participationProposed, retainedWei: participationBudget - participationProposed,
    hold: participationHold, totalMetres: [...distances.values()].reduce((n, d) => n + d.metres, 0n), awards };
  const leagueProposed = leagueFamilies.reduce((n, f) => n + f.proposedWei, participationProposed);
  const proposedWei = rounds.reduce((n, r) => n + r.proposedWei, leagueProposed);
  return { version: 3 as const, kind: source.kind, state: "unapproved_allocation_preview" as const, payableWei: 0n,
    budgetWei: budget.budgetWei, proposedWei, retainedWei: budget.budgetWei - proposedWei, rounds,
    league: { budgetWei: budget.leagueBudgetWei, proposedWei: leagueProposed, retainedWei: budget.leagueBudgetWei - leagueProposed, hold: leagueHold, families: leagueFamilies, participation } };
}
