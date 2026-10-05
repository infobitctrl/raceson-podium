import { deriveLeagueStandings, deriveLeagueClubStandings, pointsForLeaguePlace,
  type LeagueScoringEntry, type DerivedLeagueStanding } from "../leagues/standings.js";
import { compareRewardKeys } from "./arithmetic.js";
import { decodeRewardAllocationSourceV3, type RewardAllocationSourceV3 } from "./allocation-preview-v3.js";
import { programmeApprovalRequestIdV3 as uuid } from "./programme-approval-v3.js";

const invalid = () => { throw new Error("invalid_reward_league_policy"); };
function check(v: unknown): asserts v { if (!v) invalid(); }
function object(v: unknown, keys: string[]) {
  check(v && typeof v === "object" && !Array.isArray(v));
  const fields = Object.getOwnPropertyDescriptors(v);
  check(Reflect.ownKeys(v).length === keys.length && keys.every(k => fields[k]?.enumerable && "value" in fields[k]!));
  return Object.fromEntries(keys.map(k => [k, fields[k]!.value])) as Record<string, unknown>;
}
function list(v: unknown, max: number) {
  check(Array.isArray(v) && v.length <= max);
  const fields = Object.getOwnPropertyDescriptors(v);
  check(Reflect.ownKeys(v).length === v.length + 1);
  return Array.from({ length: v.length }, (_, i) => { const f = fields[String(i)]; check(f?.enumerable && "value" in f); return f.value as unknown; });
}
function integer(v: unknown, min: number, max: number) { check(Number.isSafeInteger(v) && Number(v) >= min && Number(v) <= max); return v as number; }
export function decodeLeagueScoringPolicyV3(value: unknown) {
  const v = object(value, ["schema", "categories", "club"]);
  check(v.schema === "raceson-league-scoring-policy-v3");
  const categories = list(v.categories, 64).map(value => {
    const c = object(value, ["categoryId", "points", "participationPoints", "bestN", "minimumRounds", "tieBreak"]);
    const points = list(c.points, 256).map(p => integer(p, 0, 1000000));
    check(points.length > 0 && ["best_finish", "most_wins", "last_round"].includes(c.tieBreak as string));
    const bestN = integer(c.bestN, 1, 5), minimumRounds = integer(c.minimumRounds, 0, 5);
    check(minimumRounds <= bestN);
    return { categoryId: uuid(c.categoryId), points, participationPoints: integer(c.participationPoints, 0, 1000000), bestN, minimumRounds,
      tieBreak: c.tieBreak as "best_finish" | "most_wins" | "last_round" };
  }).sort((a, b) => compareRewardKeys(a.categoryId, b.categoryId));
  check(categories.length > 0 && new Set(categories.map(c => c.categoryId)).size === categories.length);
  const club = object(v.club, ["categoryId", "membersPerRound"]);
  const categoryId = uuid(club.categoryId); check(!categories.some(c => c.categoryId === categoryId));
  return { schema: "raceson-league-scoring-policy-v3" as const, categories,
    club: { categoryId, membersPerRound: integer(club.membersPerRound, 1, 10) } };
}
export type LeagueScoringPolicyV3 = ReturnType<typeof decodeLeagueScoringPolicyV3>;
function digest(v: unknown) { check(typeof v === "string" && /^[0-9a-f]{64}$/.test(v)); return v; }
export function decodeLeaguePolicyChangeV3(value: unknown) {
  const c = object(value, ["requestId", "expectedReviewId", "contextHash", "policy", "decision"]);
  check(c.decision === "selected" || c.decision === "held");
  return { requestId: uuid(c.requestId), expectedReviewId: c.expectedReviewId === null ? null : uuid(c.expectedReviewId),
    contextHash: digest(c.contextHash), policy: decodeLeagueScoringPolicyV3(c.policy), decision: c.decision as "selected" | "held" };
}
export type LeaguePolicyChangeV3 = ReturnType<typeof decodeLeaguePolicyChangeV3>;
export function decodeLeaguePolicyDecisionV3(value: unknown) {
  if (value === null) return null;
  const r = object(value, ["id", "previousReviewId", "contextHash", "policy", "decision", "reviewedAt"]);
  const c = decodeLeaguePolicyChangeV3({ requestId: r.id, expectedReviewId: r.previousReviewId, contextHash: r.contextHash, policy: r.policy, decision: r.decision });
  check(c.requestId !== c.expectedReviewId && typeof r.reviewedAt === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(r.reviewedAt)
    && Number.isFinite(Date.parse(r.reviewedAt)) && new Date(r.reviewedAt).toISOString() === r.reviewedAt);
  return { id: c.requestId, previousReviewId: c.expectedReviewId, contextHash: c.contextHash, policy: c.policy, decision: c.decision, reviewedAt: r.reviewedAt };
}

type Hold = { slot: number | null; categoryId: string | null; reason: "source_not_final" | "incomplete_results" | "ambiguous_results" |
  "category_changed" | "standings_missing" | "invalid_standings" | "source_changed" };
type Table = RewardAllocationSourceV3["standings"][number];
function validRanks(rows: Table["rows"]) {
  for (let i = 0; i < rows.length;) { if (rows[i]!.rank !== i + 1) return false;
    const rank = rows[i]!.rank; do { i++; } while (i < rows.length && rows[i]!.rank === rank); }
  return true;
}
function sameAthleteScore(a: DerivedLeagueStanding, b: DerivedLeagueStanding) {
  // The portal uses these sporting tie-break fields in a policy-specific order.
  // Only its last name-based DISPLAY ordering is excluded from reward ranking.
  return a.eligible === b.eligible && a.points === b.points && a.bestFinish === b.bestFinish && a.wins === b.wins && a.lastRoundPoints === b.lastRoundPoints;
}
type Entry = LeagueScoringEntry & { sourceRowId: string; categoryId: string; leaguePoints: number };

/** Builds an UNAPPROVED sporting proposal from all five complete source tables.
 * No clock, publication, profile ownership, consent or payment authority follows.
 * Authoritative category ranks are preserved, including ties; the display-only
 * classifier's alphabetical tie-break must not manufacture a prize advantage.
 */
export function proposeLeagueStandingsV3(sourceInput: RewardAllocationSourceV3, policyInput: LeagueScoringPolicyV3) {
  return proposeStandings(sourceInput, policyInput, null);
}

/** A race's club table uses the same selected scoring policy as the league,
 * but does not depend on other races being final. It is still only a proposal;
 * the caller must bind current official race and policy-review evidence. */
export function proposeRoundClubStandingsV3(sourceInput: RewardAllocationSourceV3, policyInput: LeagueScoringPolicyV3, slot: number) {
  integer(slot, 1, 5);
  const result = proposeStandings(sourceInput, policyInput, slot);
  return { schema: "raceson-round-club-proposal-v3" as const, slot, policy: result.policy,
    state: result.state, holds: result.holds, table: result.clubTables[0] ?? null,
    allocationApproved: false as const, payableWei: "0" as const };
}

function proposeStandings(sourceInput: RewardAllocationSourceV3, policyInput: LeagueScoringPolicyV3, selectedSlot: number | null) {
  const source = decodeRewardAllocationSourceV3(sourceInput), policy = decodeLeagueScoringPolicyV3(policyInput);
  const ids = source.categories.filter(c => c.target === "individual").map(c => c.id).sort(compareRewardKeys);
  check(JSON.stringify(ids) === JSON.stringify(policy.categories.map(c => c.categoryId)));
  const clubs = source.categories.filter(c => c.target === "club");
  check(clubs.length === 1 && clubs[0]!.id === policy.club.categoryId);
  const holds: Hold[] = [], entries: Entry[] = [];
  const categoryByAthlete = new Map<string, Set<string>>();
  for (const round of source.rounds.filter(r => selectedSlot === null || r.slot === selectedSlot)) {
    const before = holds.length;
    const hold = (reason: Hold["reason"], categoryId: string | null = null) => holds.push({ slot: round.slot, categoryId, reason });
    if (!round.evidence || round.evidence.held) hold("source_not_final");
    if (!round.resultsComplete || round.expectedResultCount !== round.results.length) hold("incomplete_results");
    if (new Set(round.results.map(r => r.athleteId)).size !== round.results.length || round.results.some(r => r.status === "unknown")) hold("ambiguous_results");
    if (holds.length !== before) continue;
    const byId = new Map(round.results.map(r => [r.id, r]));
    if (round.results.some(r => r.status === "finished" && !r.categoryId)) { hold("ambiguous_results"); continue; }
    for (const category of policy.categories) {
      const table = source.standings.find(t => t.slot === round.slot && t.categoryId === category.categoryId);
      if (!table || !table.complete) { hold("standings_missing", category.categoryId); continue; }
      if (table.evidence.held || table.roundDigests.length !== 1 || table.roundDigests[0] !== round.evidence!.digest
        || table.evidence.publishedAt < round.evidence!.publishedAt) { hold("source_changed", category.categoryId); continue; }
      const eligible = round.results.filter(r => r.status === "finished" && r.categoryId === category.categoryId);
      if (!validRanks(table.rows) || table.rows.length !== eligible.length || table.rows.some(r => {
        const row = byId.get(r.sourceRowId); return !row || row.athleteId !== r.beneficiaryId || row.status !== "finished" || row.categoryId !== category.categoryId;
      })) { hold("invalid_standings", category.categoryId); continue; }
      for (const r of table.rows) {
        const result = byId.get(r.sourceRowId)!;
        const categories = categoryByAthlete.get(r.beneficiaryId) ?? new Set<string>(); categories.add(category.categoryId); categoryByAthlete.set(r.beneficiaryId, categories);
        // Opaque stable IDs throughout. Display names and current club membership
        // never resolve imported identity or change represented race-day clubs.
        entries.push({ sourceRowId: r.sourceRowId, categoryId: category.categoryId, athleteId: r.beneficiaryId, athleteSlug: r.beneficiaryId,
          name: r.beneficiaryId, club: result.clubId ?? "Independent", clubSlug: result.clubId, gender: "U", ageCategory: "",
          roundNumber: round.slot, roundStatus: "completed", publicationState: "official", participationStatus: "finished", overall: r.rank,
          leaguePoints: pointsForLeaguePlace(r.rank, category.points, category.participationPoints) });
      }
    }
  }
  if ([...categoryByAthlete.values()].some(c => c.size > 1)) holds.push({ slot: null, categoryId: null, reason: "category_changed" });
  const athleteTables = holds.length ? [] : policy.categories.map(category => {
    const selected = entries.filter(e => e.categoryId === category.categoryId);
    const standings = deriveLeagueStandings(selected, category.points, category.participationPoints, category.bestN, category.minimumRounds, category.tieBreak);
    let rank = 0;
    const rows = standings.map((s, i) => {
      if (!i || !sameAthleteScore(s, standings[i - 1]!)) rank = i + 1;
      const scored = selected.filter(e => e.athleteId === s.athleteId)
        .sort((a, b) => b.leaguePoints - a.leaguePoints || a.overall - b.overall || a.roundNumber - b.roundNumber);
      const counted = new Set(scored.slice(0, category.bestN).map(e => e.sourceRowId));
      return { beneficiaryId: s.athleteId, rank: s.eligible ? rank : null, eligible: s.eligible, points: s.points,
        rounds: scored.sort((a, b) => a.roundNumber - b.roundNumber).map(e => ({ slot: e.roundNumber, sourceRowId: e.sourceRowId,
          rank: e.overall, points: e.leaguePoints, counted: counted.has(e.sourceRowId) })) };
    });
    return { categoryId: category.categoryId, rows };
  });
  function clubTable(slot: number | null) {
    const selected = entries.filter(e => slot === null || e.roundNumber === slot);
    const standings = deriveLeagueClubStandings(selected, [], 0, `best_${policy.club.membersPerRound}`);
    let rank = 0;
    return { slot, categoryId: policy.club.categoryId, rows: standings.map((s, i) => {
      if (!i || s.points !== standings[i - 1]!.points || s.scoredRounds !== standings[i - 1]!.scoredRounds) rank = i + 1;
      const members = new Map(s.memberRows.map(m => [m.athleteId, m]));
      return { beneficiaryId: s.clubSlug, rank, points: s.points, scoredRounds: s.scoredRounds,
        contributions: selected.filter(e => e.clubSlug === s.clubSlug).map(e => ({ athleteId: e.athleteId, sourceRowId: e.sourceRowId,
          slot: e.roundNumber, points: e.leaguePoints, counted: members.get(e.athleteId)!.countedRounds[e.roundNumber - 1] === true })) };
    }) };
  }
  const finished = source.rounds.flatMap(r => r.results.filter(row => row.status === "finished"));
  const missingDistance = finished.some(r => r.distanceMetres === null);
  const metres = new Map<string, { metres: bigint; resultIds: string[] }>();
  if (!holds.length && !missingDistance) for (const r of finished) {
    const item = metres.get(r.athleteId) ?? { metres: 0n, resultIds: [] }; item.metres += BigInt(r.distanceMetres!); item.resultIds.push(r.id); metres.set(r.athleteId, item);
  }
  return { schema: "raceson-league-standings-proposal-v3" as const, state: holds.length ? "held" as const : "unapproved_proposal" as const,
    policy, holds, athleteTables, clubTables: holds.length ? [] : (selectedSlot === null ? [1, 2, 3, 4, 5, null] : [selectedSlot]).map(clubTable),
    participation: { hold: holds.length ? "source_not_ready" as const : missingDistance ? "missing_distance" as const : null,
      totalMetres: [...metres.values()].reduce((sum, r) => sum + r.metres, 0n).toString(), rows: [...metres].sort(([a], [b]) => compareRewardKeys(a, b))
        .map(([beneficiaryId, r]) => ({ beneficiaryId, metres: r.metres.toString(), resultIds: r.resultIds.sort(compareRewardKeys) })) },
    finalPublished: false as const, allocationApproved: false as const, payableWei: "0" as const };
}
