import { parseRewardSourceTimestamp, splitRewardProgramme, type RewardSourceConfiguration } from "@raceson/domain/rewards";
import { createAdminSupabaseClient } from "../supabase.js";
import { RewardLedgerStoreError, type RewardLedgerRpc, type RewardSportingReviewBody } from "./programme-ledger.js";
import { decodeRewardConfiguration, decodeRewardSportingReview, rewardDocumentInteger, rewardDocumentUuid } from "./stored-documents.js";

export type RewardCalculationReference = { campaignId: string; actorUserId: string } & (
  { snapshotId: string; reviewId?: never } | { reviewId: string; snapshotId?: never }
);
export type RewardCalculationContext = {
  programme: { id: string; operatorUserId: string; environment: "local_simulation" | "testnet_pilot";
    chainId: 31337 | 10143; budgetWei: bigint; configuration: RewardSourceConfiguration };
  campaign: { id: string; scopeKey: string; pot: "race" | "league"; roundIds: string[]; budgetWei: bigint };
  snapshot: { snapshotId: string; capturedAt: string; sourceFingerprintSha256: string; source: unknown };
  review: null | { id: string; revision: number; reviewedAt: string; reviewedByUserId: string; body: RewardSportingReviewBody };
};
function demand(condition: unknown): asserts condition {
  if (!condition) throw new RewardLedgerStoreError("invalid_reward_calculation_context");
}
function object(value: unknown): Record<string, unknown> {
  demand(value !== null && typeof value === "object" && !Array.isArray(value)); return value as Record<string, unknown>;
}
function timestamp(value: unknown): string { parseRewardSourceTimestamp(value); return value as string; }
const uuid = rewardDocumentUuid;
const amount = rewardDocumentInteger;
const safeErrors = new Set(["reward_operator_permission_required", "invalid_reward_calculation_reference", "reward_calculation_reference_mismatch"]);

/** Server only. Never return this document, source or review from public APIs.
 * Authentication supplies the actor; SQL checks current designated authority.
 * The exact old review can be read for a retry; writes enforce latest/fresh source. */
export async function readRewardCalculationContext(input: RewardCalculationReference, injected?: RewardLedgerRpc): Promise<RewardCalculationContext> {
  const campaignId = uuid(input.campaignId); const actorId = uuid(input.actorUserId);
  demand((input.snapshotId === undefined) !== (input.reviewId === undefined));
  const snapshotId = input.snapshotId === undefined ? null : uuid(input.snapshotId);
  const reviewId = input.reviewId === undefined ? null : uuid(input.reviewId);
  const rpc: RewardLedgerRpc = injected ?? ((name, args) => createAdminSupabaseClient().rpc(name, args));
  let response: { data: unknown; error: unknown };
  try { response = await rpc("service_read_reward_calculation_context", {
    p_campaign_id: campaignId, p_actor_user_id: actorId, p_source_snapshot_id: snapshotId, p_review_id: reviewId,
  }); } catch { throw new RewardLedgerStoreError("reward_ledger_unavailable"); }
  if (response.error) {
    const error = typeof response.error === "object" ? response.error as Record<string, unknown> : {};
    throw new RewardLedgerStoreError(typeof error.message === "string" && safeErrors.has(error.message) ? error.message : "reward_ledger_store_failed");
  }
  return decodeRewardCalculationContext(response.data, { campaignId, actorUserId: actorId,
    ...(reviewId === null ? { snapshotId: snapshotId! } : { reviewId }) });
}

/** Also used by larger service-only bundles containing an exact stored review. */
export function decodeRewardCalculationContext(value: unknown, input: RewardCalculationReference): RewardCalculationContext {
  const campaignId = uuid(input.campaignId); const actorId = uuid(input.actorUserId);
  demand((input.snapshotId === undefined) !== (input.reviewId === undefined));
  const snapshotId = input.snapshotId === undefined ? null : uuid(input.snapshotId);
  const reviewId = input.reviewId === undefined ? null : uuid(input.reviewId);
  try {
    const raw = object(value); demand(raw.schemaVersion === 1);
    const programme = object(raw.programme); const campaign = object(raw.campaign); const snapshot = object(raw.snapshot);
    const configuration = decodeRewardConfiguration(programme.configuration);
    demand(programme.organizationId === configuration.organizationId && programme.seasonId === configuration.seasonId
      && programme.operatorUserId === actorId && campaign.id === campaignId);
    const environment = programme.environment; const chainId = programme.chainId;
    demand((environment === "local_simulation" && chainId === 31337) || (environment === "testnet_pilot" && chainId === 10143));
    const budgetWei = amount(programme.budgetWei); demand(budgetWei >= 9n);
    const split = splitRewardProgramme(budgetWei, configuration.rounds.map((row) => row.id));
    const expected = split.rounds.find((row) => row.key === campaign.scopeKey);
    const pot = expected ? "race" : "league";
    demand(campaign.pot === pot && (expected || campaign.scopeKey === "rounds-1-5"));
    const rounds = expected ? [expected.key] : configuration.rounds.map((row) => row.id).sort();
    demand(Array.isArray(campaign.roundIds) && JSON.stringify(campaign.roundIds) === JSON.stringify(rounds)
      && amount(campaign.budgetWei) === (expected?.amount ?? split.leagueBudget));
    demand(snapshotId === null || snapshot.snapshotId === snapshotId);
    demand(typeof snapshot.sourceFingerprintSha256 === "string" && /^[0-9a-f]{64}$/.test(snapshot.sourceFingerprintSha256));
    let review: RewardCalculationContext["review"] = null;
    if (reviewId === null) demand(raw.review === null);
    else {
      const stored = object(raw.review);
      demand(stored.id === reviewId && stored.reviewedByUserId === actorId
        && Number.isSafeInteger(stored.revision) && (stored.revision as number) > 0);
      review = { id: reviewId, revision: stored.revision as number, reviewedAt: timestamp(stored.reviewedAt),
        reviewedByUserId: actorId, body: decodeRewardSportingReview(stored.body) };
    }
    return { programme: { id: uuid(programme.id), operatorUserId: actorId,
      environment: environment as "local_simulation" | "testnet_pilot", chainId: chainId as 31337 | 10143, budgetWei, configuration },
    campaign: { id: campaignId, scopeKey: campaign.scopeKey as string, pot, roundIds: rounds, budgetWei: amount(campaign.budgetWei) },
    snapshot: { snapshotId: uuid(snapshot.snapshotId), capturedAt: timestamp(snapshot.capturedAt),
      sourceFingerprintSha256: snapshot.sourceFingerprintSha256, source: snapshot.source }, review };
  } catch { throw new RewardLedgerStoreError("invalid_reward_calculation_context"); }
}
