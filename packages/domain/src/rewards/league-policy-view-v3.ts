import { decodeLeaguePolicyDecisionV3, decodeLeagueScoringPolicyV3, type proposeLeagueStandingsV3 } from "./league-standings-v3.js";
import { programmeApprovalRequestIdV3 as uuid } from "./programme-approval-v3.js";
import { canonicalRewardProposalV2 as canonical } from "./frozen-proposal-v2.js";

type Proposal = ReturnType<typeof proposeLeagueStandingsV3>;
function check(v: unknown): asserts v { if (!v) throw new Error("invalid_reward_league_policy_view"); }
function object(v: unknown, keys: string[]) {
  check(v && typeof v === "object" && !Array.isArray(v));
  const fields = Object.getOwnPropertyDescriptors(v);
  check(Reflect.ownKeys(v).length === keys.length && keys.every(k => fields[k]?.enumerable && "value" in fields[k]!));
  return Object.fromEntries(keys.map(k => [k, fields[k]!.value])) as Record<string, unknown>;
}
function list(v: unknown, max = 25000): unknown[] {
  check(Array.isArray(v) && v.length <= max);
  const fields = Object.getOwnPropertyDescriptors(v); check(Reflect.ownKeys(v).length === v.length + 1);
  return Array.from({ length: v.length }, (_, i) => { const f = fields[String(i)]; check(f?.enumerable && "value" in f); return f.value; });
}
function integer(v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER) { check(Number.isSafeInteger(v) && Number(v) >= min && Number(v) <= max); return v as number; }
function bool(v: unknown) { check(typeof v === "boolean"); return v; }
function name(v: unknown) { check(typeof v === "string" && v.length > 0 && v.length <= 512 && !/[\u0000-\u001f\u007f]/.test(v)); return v; }
function digest(v: unknown) { check(typeof v === "string" && /^[0-9a-f]{64}$/.test(v)); return v; }
function metres(v: unknown) { check(typeof v === "string" && /^(0|[1-9][0-9]{0,30})$/.test(v)); return v; }
function slot(v: unknown) { return integer(v, 1, 5); }
function unique(v: string[]) { check(new Set(v).size === v.length); }
function notPayable(v: Record<string, unknown>) { check(v.finalPublished === false && v.allocationApproved === false && v.payableWei === "0"); }

/** Private display contract, not publication or payment authority. Source proofs
 * and the proposal commitment are checked by the server, never browser flags. */
function proposal(value: unknown): Proposal | null {
  if (value === null) return null;
  const p = object(value, ["schema", "state", "policy", "holds", "athleteTables", "clubTables", "participation", "finalPublished", "allocationApproved", "payableWei"]);
  check(p.schema === "raceson-league-standings-proposal-v3" && (p.state === "held" || p.state === "unapproved_proposal")); notPayable(p);
  const policy = decodeLeagueScoringPolicyV3(p.policy);
  const holds = list(p.holds, 2048).map(value => {
    const h = object(value, ["slot", "categoryId", "reason"]);
    check(["source_not_final", "incomplete_results", "ambiguous_results", "category_changed", "standings_missing", "invalid_standings", "source_changed"].includes(h.reason as string));
    return { slot: h.slot === null ? null : slot(h.slot), categoryId: h.categoryId === null ? null : uuid(h.categoryId), reason: h.reason as Proposal["holds"][number]["reason"] };
  });
  const athleteTables = list(p.athleteTables, 64).map(value => {
    const t = object(value, ["categoryId", "rows"]), categoryId = uuid(t.categoryId), rule = policy.categories.find(c => c.categoryId === categoryId); check(rule);
    const rows = list(t.rows).map(value => {
      const r = object(value, ["beneficiaryId", "rank", "eligible", "points", "rounds"]);
      const rounds = list(r.rounds, 5).map(value => { const x = object(value, ["slot", "sourceRowId", "rank", "points", "counted"]);
        return { slot: slot(x.slot), sourceRowId: uuid(x.sourceRowId), rank: integer(x.rank, 1), points: integer(x.points, 0, 1000000), counted: bool(x.counted) }; });
      unique(rounds.map(r => String(r.slot))); unique(rounds.map(r => r.sourceRowId));
      const points = integer(r.points), eligible = bool(r.eligible), rank = r.rank === null ? null : integer(r.rank, 1);
      check(rounds.length > 0 && eligible === (rounds.length >= rule.minimumRounds) && eligible === (rank !== null)
        && rounds.filter(r => r.counted).length === Math.min(rule.bestN, rounds.length)
        && points === rounds.reduce((s, r) => s + (r.counted ? r.points : 0), 0));
      return { beneficiaryId: uuid(r.beneficiaryId), rank, eligible, points, rounds };
    }); unique(rows.map(r => r.beneficiaryId));
    return { categoryId, rows };
  }); unique(athleteTables.map(t => t.categoryId));
  const clubTables = list(p.clubTables, 6).map(value => {
    const t = object(value, ["slot", "categoryId", "rows"]), s = t.slot === null ? null : slot(t.slot), categoryId = uuid(t.categoryId);
    check(categoryId === policy.club.categoryId);
    const rows = list(t.rows).map(value => {
      const r = object(value, ["beneficiaryId", "rank", "points", "scoredRounds", "contributions"]);
      const contributions = list(r.contributions).map(value => { const c = object(value, ["athleteId", "sourceRowId", "slot", "points", "counted"]);
        const round = slot(c.slot); check(s === null || s === round);
        return { athleteId: uuid(c.athleteId), sourceRowId: uuid(c.sourceRowId), slot: round, points: integer(c.points, 0, 1000000), counted: bool(c.counted) }; });
      unique(contributions.map(c => c.sourceRowId)); unique(contributions.map(c => `${c.athleteId}:${c.slot}`));
      const points = integer(r.points), scoredRounds = integer(r.scoredRounds, 0, 5);
      check(points === contributions.reduce((sum, c) => sum + (c.counted ? c.points : 0), 0));
      for (let i = 1; i <= 5; i++) check(contributions.filter(c => c.slot === i && c.counted).length <= policy.club.membersPerRound);
      return { beneficiaryId: uuid(r.beneficiaryId), rank: integer(r.rank, 1), points, scoredRounds, contributions };
    }); unique(rows.map(r => r.beneficiaryId));
    return { slot: s, categoryId, rows };
  }); unique(clubTables.map(t => String(t.slot)));
  const part = object(p.participation, ["hold", "totalMetres", "rows"]); check(part.hold === null || part.hold === "source_not_ready" || part.hold === "missing_distance");
  const distanceRows = list(part.rows).map(value => { const r = object(value, ["beneficiaryId", "metres", "resultIds"]), resultIds = list(r.resultIds, 5).map(uuid);
    check(resultIds.length > 0); unique(resultIds); return { beneficiaryId: uuid(r.beneficiaryId), metres: metres(r.metres), resultIds }; });
  unique(distanceRows.map(r => r.beneficiaryId)); unique(distanceRows.flatMap(r => r.resultIds));
  const totalMetres = metres(part.totalMetres); check(BigInt(totalMetres) === distanceRows.reduce((s, r) => s + BigInt(r.metres), 0n));
  check(part.hold === null || distanceRows.length === 0);
  if (p.state === "held") check(holds.length > 0 && !athleteTables.length && !clubTables.length && part.hold === "source_not_ready");
  else check(!holds.length && athleteTables.length === policy.categories.length && clubTables.length === 6 && part.hold !== "source_not_ready");
  return { schema: "raceson-league-standings-proposal-v3", state: p.state, policy, holds, athleteTables, clubTables,
    participation: { hold: part.hold, totalMetres, rows: distanceRows }, finalPublished: false, allocationApproved: false, payableWei: "0" };
}
export function decodeLeaguePolicyViewV3(value: unknown) {
  const v = object(value, ["schema", "draftId", "organizationId", "chainId", "revision", "contextHash", "reviewState", "review", "recordedReview", "categories", "labels", "proposalHash", "proposal", "finalPublished", "allocationApproved", "payableWei"]);
  check(v.schema === "raceson-league-policy-workspace-v3" && (v.chainId === 31337 || v.chainId === 10143)); notPayable(v);
  const contextHash = digest(v.contextHash), review = decodeLeaguePolicyDecisionV3(v.review), recordedReview = decodeLeaguePolicyDecisionV3(v.recordedReview);
  const reviewState: "missing" | "stale" | "held" | "selected" = !review ? "missing" : review.contextHash !== contextHash ? "stale" : review.decision === "held" ? "held" : "selected";
  check(v.reviewState === reviewState);
  const categories = list(v.categories, 65).map(value => { const c = object(value, ["id", "name", "target"]);
    check(c.target === "individual" || c.target === "club"); return { id: uuid(c.id), name: name(c.name), target: c.target as "individual" | "club" }; });
  unique(categories.map(c => c.id)); check(categories.some(c => c.target === "individual") && categories.filter(c => c.target === "club").length === 1);
  const p = proposal(v.proposal), proposalHash = v.proposalHash === null ? null : digest(v.proposalHash);
  check((reviewState === "selected") === (p !== null) && (p !== null) === (proposalHash !== null));
  if (p) check(canonical(p.policy) === canonical(review!.policy) && p.policy.categories.length + 1 === categories.length
    && p.policy.categories.every(c => categories.some(t => t.id === c.categoryId && t.target === "individual"))
    && categories.some(c => c.id === p.policy.club.categoryId && c.target === "club"));
  const l = object(v.labels, ["athletes", "clubs"]);
  const labels = (value: unknown, allowed: Set<string>) => { const rows = list(value).map(value => { const n = object(value, ["id", "name"]), id = uuid(n.id); check(allowed.has(id)); return { id, name: name(n.name) }; }); unique(rows.map(r => r.id)); return rows; };
  const athleteIds = new Set(p?.athleteTables.flatMap(t => t.rows.map(r => r.beneficiaryId)) ?? []);
  const clubIds = new Set(p?.clubTables.flatMap(t => t.rows.map(r => r.beneficiaryId)) ?? []);
  return { schema: "raceson-league-policy-workspace-v3" as const, draftId: uuid(v.draftId), organizationId: uuid(v.organizationId), chainId: v.chainId,
    revision: integer(v.revision, 1), contextHash, reviewState, review, recordedReview, categories,
    labels: { athletes: labels(l.athletes, athleteIds), clubs: labels(l.clubs, clubIds) }, proposalHash, proposal: p,
    finalPublished: false as const, allocationApproved: false as const, payableWei: "0" as const };
}
export type LeaguePolicyViewV3 = ReturnType<typeof decodeLeaguePolicyViewV3>;
