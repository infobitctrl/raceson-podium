import { createHash } from "node:crypto";
import { canonicalRewardJson } from "@raceson/rewards-chain";
import { decodeLeaguePolicyChangeV3, proposeLeagueStandingsV3, type LeaguePolicyChangeV3 } from "@raceson/domain/rewards/league-standings-v3";
import { leaguePolicyFactsV3, RewardLedgerStoreError, type RewardAccountIdentity, type RewardLedgerRpc } from "@raceson/db/rewards";
import { previewNativeFinaleContinuityV3 } from "./native-finale-continuity-service.js";
import { decodeLeaguePolicyViewV3 } from "@raceson/domain/rewards/league-policy-view-v3";
type Facts = Awaited<ReturnType<typeof leaguePolicyFactsV3>>;
const hash = (v: unknown) => createHash("sha256").update(canonicalRewardJson(v)).digest("hex");
export function leaguePolicyContextV3(f: Facts["facts"]) {
  // Stable policy scope. Later official results do not silently change an
  // upfront scoring policy; the separate proposal digest binds those results.
  return { schema: "raceson-league-policy-context-v3", draftId: f.record.draftId, organizationId: f.record.organizationId,
    chainId: f.record.chainId, rulesRevision: f.record.revision, rules: f.record.rules, mapping: f.workspace.mapping,
    sourceLeagueId: f.snapshot.sourceLeagueId, sourceSeasonId: f.snapshot.sourceSeasonId,
    categories: f.workspace.catalogue.categories.map(c => ({ id: c.id, competitionId: c.competitionId, target: c.target })).sort((a, b) => a.id.localeCompare(b.id)),
    rounds: f.workspace.catalogue.rounds.map(r => ({ id: r.id, slot: r.slot, editionId: r.editionId,
      races: r.races.map(r => ({ id: r.id, competitionId: r.competitionId })).sort((a, b) => a.id.localeCompare(b.id)) })).sort((a, b) => a.slot - b.slot) };
}
function source(f: Facts["facts"]) {
  const r = f.review;
  const result = previewNativeFinaleContinuityV3({ ...f, review: r ? { id: r.id, contextHash: r.contextHash, selection: r.selection,
    decision: r.decision, reviewedAt: r.reviewedAt } : null }).source;
  // Validate raw imported overall ranks before their classification projection
  // compacts them. A malformed 1,1,2 order must not be laundered into 1,1,3.
  for (const round of f.snapshot.catalogue.rounds) for (const race of round.races) {
    const rows = f.snapshot.results.filter(row => row.raceId === race.id && row.participationStatus === "finished")
      .sort((a, b) => (a.rankOverall ?? 0) - (b.rankOverall ?? 0));
    let valid = true;
    for (let i = 0; i < rows.length;) {
      if (rows[i]!.rankOverall !== i + 1) valid = false;
      const rank = rows[i]!.rankOverall; do { i++; } while (i < rows.length && rows[i]!.rankOverall === rank);
    }
    if (!valid && result.rounds[round.slot - 1]!.evidence) result.rounds[round.slot - 1]!.evidence!.held = true;
  }
  return result;
}
export function leaguePolicyCalculationV3(f: Facts) {
  const context = leaguePolicyContextV3(f.facts), contextHash = hash(context);
  const state = !f.review ? "missing" : f.review.contextHash !== contextHash ? "stale" : f.review.decision === "held" ? "held" : "selected";
  const currentSource = state === "selected" ? source(f.facts) : null;
  const proposal = currentSource ? proposeLeagueStandingsV3(currentSource, f.review!.policy) : null;
  // Entire minimized source is committed, except the refresh timestamp. No
  // opaque browser digest/boolean establishes publication authority.
  const { capturedAt: _observedAt, ...stableSource } = currentSource ?? {};
  const proposalHash = proposal ? hash({ schema: "raceson-league-proposal-commitment-v3", context,
    policyReview: f.review, source: stableSource, proposal }) : null;
  return { context, contextHash, state, currentSource, proposal, proposalHash };
}
export function projectLeaguePolicyV3(f: Facts) {
  const { contextHash, state, proposal, proposalHash } = leaguePolicyCalculationV3(f);
  const old = f.facts.snapshot, continuity = f.facts.review?.selection;
  const names = (ids: string[], historical: { id: string; name: string | null }[], native: { id: string; name: string | null }[]) => {
    const byId = new Map([...native, ...historical].map(n => [n.id, n.name]));
    return [...new Set(ids)].sort().map(id => ({ id, name: byId.get(id) ?? id }));
  };
  // Labels are private display metadata only. Identity is already explicitly
  // reviewed; names never join sources or enter the sporting commitment.
  const nativeAthletes = (continuity?.athletes ?? []).map(a => ({ id: a.target.beneficiaryId, name: f.facts.labels.athletes.find(n => n.id === a.nativeAthleteId)?.name ?? null }));
  const nativeClubs = (continuity?.clubs ?? []).map(c => ({ id: c.target.beneficiaryId, name: f.facts.labels.clubs.find(n => n.id === c.nativeClubId)?.name ?? null }));
  return decodeLeaguePolicyViewV3({ schema: "raceson-league-policy-workspace-v3", draftId: f.facts.record.draftId, chainId: f.facts.record.chainId,
    organizationId: f.facts.record.organizationId, revision: f.facts.record.revision,
    contextHash, reviewState: state, review: f.review, recordedReview: f.recordedReview,
    categories: f.facts.workspace.catalogue.categories.map(c => ({ id: c.id, name: `${c.competitionName} · ${c.name}`, target: c.target })),
    labels: { athletes: names(proposal?.athleteTables.flatMap(t => t.rows.map(r => r.beneficiaryId)) ?? [], old.results.map(r => ({ id: r.athleteId, name: r.athleteName })), nativeAthletes),
      clubs: names(proposal?.clubTables.flatMap(t => t.rows.map(r => r.beneficiaryId)) ?? [], old.clubs.map(c => ({ id: c.clubId, name: c.name })), nativeClubs) },
    proposalHash, proposal, finalPublished: false, allocationApproved: false, payableWei: "0" });
}
function same(r: Facts["recordedReview"], c: LeaguePolicyChangeV3) {
  return r && r.id === c.requestId && r.previousReviewId === c.expectedReviewId && r.contextHash === c.contextHash
    && r.decision === c.decision && canonicalRewardJson(r.policy) === canonicalRewardJson(c.policy);
}
export async function leaguePolicyWorkspaceV3(identity: RewardAccountIdentity, chainId: 31337 | 10143, draftId: string,
  change?: LeaguePolicyChangeV3, rpc?: RewardLedgerRpc) {
  const c = change ? decodeLeaguePolicyChangeV3(change) : null, scope = { chainId, draftId, requestId: c?.requestId ?? null };
  const f = await leaguePolicyFactsV3(identity, scope, undefined, rpc);
  if (!c) return projectLeaguePolicyV3(f);
  if (f.recordedReview) { if (!same(f.recordedReview, c)) throw new RewardLedgerStoreError("reward_league_policy_conflict"); return projectLeaguePolicyV3(f); }
  const context = leaguePolicyContextV3(f.facts);
  if (c.contextHash !== hash(context)) throw new RewardLedgerStoreError("reward_planning_revision_changed");
  if (c.expectedReviewId !== (f.review?.id ?? null)) throw new RewardLedgerStoreError("reward_league_policy_conflict");
  // This validates the complete category policy even when sources are held.
  // Selection may happen before the finale; it is never final-table approval.
  proposeLeagueStandingsV3(source(f.facts), c.policy);
  const saved = await leaguePolicyFactsV3(identity, scope, { expectedReviewId: c.expectedReviewId, contextText: canonicalRewardJson(context),
    guardHash: f.guardHash, policy: c.policy, decision: c.decision }, rpc);
  if (!same(saved.recordedReview, c)) throw new RewardLedgerStoreError("reward_league_policy_conflict");
  return projectLeaguePolicyV3(saved);
}
