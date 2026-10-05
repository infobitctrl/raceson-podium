import { createHash } from "node:crypto";
import { canonicalRewardJson } from "@raceson/rewards-chain";
import { decodeNativeFinaleContinuityV3, inspectNativeFinaleContinuityV3, nativeFinaleAllocationSourceV3,
  decodeNativeContinuityChangeV3, decodeNativeContinuityViewV3, type NativeContinuityChangeV3 } from "@raceson/domain/rewards/native-finale-continuity-v3";
import { decodeNativeFinaleSourceV3, inspectNativeFinaleSourceV3 } from "@raceson/domain/rewards/native-finale-source-v3";
import { nativeContinuityFactsV3, RewardLedgerStoreError, type RewardAccountIdentity, type RewardLedgerRpc } from "@raceson/db/rewards";
import { decodeStoredRewardSnapshot } from "@raceson/domain/rewards/published-preview-v2";
import { decodeSavedRewardPlanningDraft } from "@raceson/domain/rewards/programme-draft-v2";
import { decodeRewardMappingWorkspaceV2 } from "@raceson/domain/rewards/source-mapping-v2";
import { decodeHistoricalSourceDecisionV3 } from "@raceson/domain/rewards/historical-source-v3";
import { previewRewardAllocationV3 } from "@raceson/domain/rewards/allocation-preview-v3";
import { programmeApprovalRequestIdV3 as uuid } from "@raceson/domain/rewards/programme-approval-v3";

const invalid = () => { throw new Error("invalid_reward_finale_continuity"); };
function check(v: unknown): asserts v { if (!v) invalid(); }
const hash = (value: unknown) => createHash("sha256").update(canonicalRewardJson(value)).digest("hex");
function digest(value: unknown) { check(typeof value === "string" && /^[0-9a-f]{64}$/.test(value)); return value; }
function review(value: unknown) {
  if (value === null) return null;
  check(value && typeof value === "object" && !Array.isArray(value));
  const fields = Object.getOwnPropertyDescriptors(value), keys = ["id", "contextHash", "selection", "decision", "reviewedAt"];
  check(Reflect.ownKeys(value).length === keys.length && keys.every(k => fields[k]?.enumerable && "value" in fields[k]!));
  const r = Object.fromEntries(keys.map(k => [k, fields[k]!.value]));
  check(r.decision === "confirmed" || r.decision === "held");
  check(typeof r.reviewedAt === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(r.reviewedAt)
    && Number.isFinite(Date.parse(r.reviewedAt)) && new Date(r.reviewedAt).toISOString() === r.reviewedAt);
  return { id: uuid(r.id), contextHash: digest(r.contextHash), selection: decodeNativeFinaleContinuityV3(r.selection),
    decision: r.decision, reviewedAt: r.reviewedAt };
}

/** Pure calculator. HTTP uses nativeContinuityReviewV3 below, never caller facts. */
export function previewNativeFinaleContinuityV3(input: {
  record: unknown; workspace: unknown; snapshot: unknown; native: unknown;
  historicalContextHash: string; historicalDecisions: unknown[]; review: unknown;
}) {
  const record = decodeSavedRewardPlanningDraft(input.record), workspace = decodeRewardMappingWorkspaceV2(input.workspace);
  const snapshot = decodeStoredRewardSnapshot(input.snapshot), native = decodeNativeFinaleSourceV3(input.native);
  check(record.draftId === workspace.draftId && record.revision === workspace.rulesRevision
    && native.document.draftId === record.draftId && native.document.organizationId === record.organizationId
    && native.document.chainId === record.chainId && native.document.recordRevision === record.revision);
  check(Array.isArray(input.historicalDecisions) && input.historicalDecisions.length <= 4);
  const decisions = input.historicalDecisions.map(decodeHistoricalSourceDecisionV3);
  const context = { schema: "raceson-native-finale-continuity-context-v3", draftId: record.draftId, organizationId: record.organizationId,
    seasonId: record.seasonId, chainId: record.chainId, rulesRevision: record.revision, rules: record.rules, mapping: workspace.mapping,
    sourceLeagueId: snapshot.sourceLeagueId, sourceSeasonId: snapshot.sourceSeasonId,
    historicalContextHash: digest(input.historicalContextHash), historicalSourceHash: hash(snapshot), nativeSourceHash: hash(native.document) };
  const contextHash = hash(context), recorded = review(input.review);
  if (recorded) check(recorded.reviewedAt <= new Date(native.observedAt).toISOString());
  const current = recorded?.contextHash === contextHash;
  const inspection = current ? inspectNativeFinaleContinuityV3(snapshot, native, recorded!.selection) : null;
  if (current && recorded!.decision === "confirmed" && inspection?.state === "complete_selection") {
    check(native.document.races.every(r => new Date(r.review.officialPublishedAt!).toISOString() <= recorded!.reviewedAt));
  }
  // The round commitment covers source + exact reviewed mappings, not just the
  // native publication. Changing a link/category invalidates downstream league
  // digests even if every native result and review timestamp stayed unchanged.
  const commitment = current ? hash({ schema: "raceson-native-finale-continuity-commitment-v3", context, review: recorded }) : null;
  const source = nativeFinaleAllocationSourceV3({ snapshot, catalogue: workspace.catalogue, mapping: workspace.mapping,
    historicalContextHash: context.historicalContextHash, historicalDecisions: decisions, native,
    continuity: current ? { selection: recorded!.selection, confirmed: recorded!.decision === "confirmed", digest: commitment! } : null });
  return { schema: "raceson-native-finale-continuity-preview-v3" as const, context, contextHash,
    nativeSourceHash: context.nativeSourceHash, historicalSourceHash: context.historicalSourceHash,
    reviewState: !recorded ? "missing" as const : !current ? "stale" as const : recorded.decision === "held" ? "held" as const
      : inspection?.state === "complete_selection" ? "confirmed_selection" as const : "incomplete" as const,
    inspection, commitment, source, preview: previewRewardAllocationV3(record.rules, workspace.mapping, source),
    allocationApproved: false as const, payableWei: "0" as const };
}

type Facts = Awaited<ReturnType<typeof nativeContinuityFactsV3>>;
function calculation(facts: Facts) {
  const r = facts.review;
  return previewNativeFinaleContinuityV3({ ...facts, review: r ? {
    id: r.id, contextHash: r.contextHash, selection: r.selection, decision: r.decision, reviewedAt: r.reviewedAt } : null });
}
function sameRequest(r: Facts["recordedReview"], c: NativeContinuityChangeV3) {
  return r && r.id === c.requestId && r.previousReviewId === c.expectedReviewId && r.contextHash === c.contextHash
    && r.decision === c.decision && canonicalRewardJson(r.selection) === canonicalRewardJson(c.selection);
}
function project(facts: Facts) {
  const calculated = calculation(facts), rows = facts.native.document.races.flatMap(r => r.rows.map(row => ({ id: row.id,
    athleteId: row.athleteId, clubId: row.clubId, competitionId: r.competitionId, finished: row.participationStatus === "finished" })));
  const names = (ids: string[], labels: { id: string; name: string | null }[]) => {
    const byId = new Map(labels.map(r => [r.id, r.name]));
    return [...new Set(ids)].sort().map(id => ({ id, name: byId.get(id) ?? id }));
  };
  const old = facts.snapshot, round = calculated.preview.rounds[4]!;
  return decodeNativeContinuityViewV3({ schema: "raceson-native-continuity-review-v3", draftId: facts.record.draftId,
    organizationId: facts.record.organizationId, chainId: facts.record.chainId, revision: facts.record.revision,
    bindingId: facts.native.document.binding?.id ?? null, contextHash: calculated.contextHash, review: facts.review, recordedReview: facts.recordedReview,
    reviewState: calculated.reviewState, sourceReady: inspectNativeFinaleSourceV3(facts.native).state === "final_source_observed",
    options: { athletes: names(rows.map(r => r.athleteId), facts.labels.athletes),
      clubs: names(rows.flatMap(r => r.clubId ? [r.clubId] : []), facts.labels.clubs),
      historicalAthletes: names(old.results.map(r => r.athleteId), old.results.map(r => ({ id: r.athleteId, name: r.athleteName }))),
      historicalClubs: names([...old.clubs.map(c => c.clubId), ...old.results.flatMap(r => r.clubId ? [r.clubId] : [])],
        [...old.clubs.map(c => ({ id: c.clubId, name: c.name })), ...old.results.flatMap(r => r.clubId ? [{ id: r.clubId, name: r.clubName }] : [])]),
      categories: old.catalogue.categories.filter(c => c.target === "individual").map(c => ({ id: c.id, name: `${c.competitionName} · ${c.name}`, competitionId: c.competitionId })), rows },
    proposedWei: String(round.proposedWei), retainedWei: String(round.retainedWei), allocationApproved: false, payableWei: "0" });
}

/** Current actor/session/draft locks and source CAS live in SQL. The HTTP body
 * contains choices only; canonical context and clock come from private facts. */
export async function nativeContinuityReviewV3(identity: RewardAccountIdentity, chainId: 31337 | 10143, draftId: string,
  change?: NativeContinuityChangeV3, rpc?: RewardLedgerRpc) {
  const c = change ? decodeNativeContinuityChangeV3(change) : null, scope = { chainId, draftId, requestId: c?.requestId ?? null };
  const facts = await nativeContinuityFactsV3(identity, scope, undefined, rpc);
  if (!c) return project(facts);
  if (facts.recordedReview) {
    if (!sameRequest(facts.recordedReview, c)) throw new RewardLedgerStoreError("reward_continuity_conflict");
    return project(facts); // original acknowledgement and current hold stay separate
  }
  const current = calculation(facts);
  if (current.contextHash !== c.contextHash) throw new RewardLedgerStoreError("reward_planning_revision_changed");
  if ((facts.review?.id ?? null) !== c.expectedReviewId) throw new RewardLedgerStoreError("reward_continuity_conflict");
  const inspected = inspectNativeFinaleContinuityV3(facts.snapshot, facts.native, c.selection);
  if (c.decision === "confirmed" && inspected.state !== "complete_selection") throw new RewardLedgerStoreError("reward_continuity_not_ready");
  const saved = await nativeContinuityFactsV3(identity, scope, { expectedReviewId: c.expectedReviewId, contextText: canonicalRewardJson(current.context),
    guardHash: facts.guardHash, selection: inspected.selection, decision: c.decision }, rpc);
  if (!sameRequest(saved.recordedReview, c)) throw new RewardLedgerStoreError("reward_continuity_conflict");
  return project(saved);
}
