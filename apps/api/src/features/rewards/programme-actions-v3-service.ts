import { readProgrammeExecutionStatusV3, readProgrammeLifecycleV3, readProgrammeLifecycleJobV3, rewardRoundPublicationV3, rewardDocumentUuid as uuid,
  type ProgrammeExecutionScopeV3, type RewardAccountIdentity, type RewardLedgerRpc } from "@raceson/db/rewards";
import { requireReward, parseRewardSourceTimestamp } from "@raceson/domain/rewards";
import { programmeExecutionProgressV3 } from "@raceson/domain/rewards/programme-execution-status-v3";
import { decodeProgrammeActionsV3, decodeProgrammeActionRequestV3, nextProgrammeActionV3, type ProgrammeActionsV3 } from "@raceson/domain/rewards/programme-actions-v3";
import { canonicalRewardJson, type RewardNonceReader } from "@raceson/rewards-chain";
import type { RewardProgrammeReaderV3 } from "@raceson/rewards-chain/programme-v3";
import { prepareProgrammeLifecycleV3, loadVerifiedProgrammeLifecycleV3 } from "./programme-lifecycle-v3-service.js";
import { queueVerifiedProgrammeLifecycleV3 } from "./programme-lifecycle-worker-v3.js";
import type { ProgrammeExecutionStatusV3 } from "@raceson/domain/rewards/programme-execution-status-v3";
import type { RoundPublicationViewV3 } from "@raceson/domain/rewards/round-publication-v3";

export type ProgrammeActionReaderV3 = RewardProgrammeReaderV3 & RewardNonceReader;
const same = (a: unknown, b: unknown) => canonicalRewardJson(a) === canonicalRewardJson(b);
export type ProgrammeActionDependenciesV3 = { rpc?: RewardLedgerRpc; reader?: ProgrammeActionReaderV3 };
type PublicationAdapter<P> = {
  read: (actor: RewardAccountIdentity, scope: ProgrammeExecutionScopeV3, execution: ProgrammeExecutionStatusV3) => Promise<P | null>;
  next: (execution: ProgrammeExecutionStatusV3, publication: P | null) => ReturnType<typeof nextProgrammeActionV3>;
  binding: (publication: P | null) => Record<string, unknown>;
  stable: (publication: P) => unknown;
};
const historical: Omit<PublicationAdapter<RoundPublicationViewV3>, "read"> = {
  next: nextProgrammeActionV3,
  binding: publication => {
    requireReward(publication?.supported && publication.current && publication.review && publication.publication, "reward_round_publication_required");
    return { reviewId: publication.review.id, publicationId: publication.publication.id, reviewPeriod: String(publication.review.seconds),
      reviewStartedAt: (parseRewardSourceTimestamp(publication.review.startedAt) / 1000000n).toString(),
      officialPublishedAt: (parseRewardSourceTimestamp(publication.publication.publishedAt) / 1000000n).toString(),
      publicationEvidenceHash: publication.publication.evidenceHash };
  }, stable: p => ({ review: p.review, publication: p.publication, current: p.current }),
};
export async function programmeActionsV3(identity: RewardAccountIdentity, input: ProgrammeExecutionScopeV3,
  change: unknown, dependencies: ProgrammeActionDependenciesV3) {
  requireReward(Number.isInteger(input.slot) && input.slot >= 1 && input.slot <= 4, "invalid_reward_programme_action");
  const state = await composeProgrammeActionsV3(identity, input, change, dependencies, { ...historical,
    read: (actor, scope, view) => rewardRoundPublicationV3(actor, { ...scope, packageHash: view.packageHash }, undefined, dependencies.rpc) });
  return decodeProgrammeActionsV3({ schema: "raceson-programme-actions-v3", ...state });
}

/** Demo-only read/prepare/queue composition. No signer, broadcast transport,
 * arbitrary RPC URL, publication clock or athlete destination is accepted. */
export async function composeProgrammeActionsV3<P>(identity: RewardAccountIdentity, input: ProgrammeExecutionScopeV3,
  change: unknown, dependencies: ProgrammeActionDependenciesV3, adapter: PublicationAdapter<P>) {
  const actor = { userId: uuid(identity.userId), sessionId: uuid(identity.sessionId) };
  const scope = { chainId: input.chainId, draftId: uuid(input.draftId), slot: input.slot, approvalId: uuid(input.approvalId), uploadId: uuid(input.uploadId) };
  const request = change === undefined ? null : decodeProgrammeActionRequestV3(change), { rpc, reader } = dependencies;
  const execution = await readProgrammeExecutionStatusV3(actor, scope, rpc);
  const readPublication = async (view: typeof execution) => programmeExecutionProgressV3(view).uploadComplete
    ? adapter.read(actor, scope, view) : null;
  const publication = await readPublication(execution);
  if (request) {
    requireReward(request.packageHash === execution.packageHash, "reward_programme_lifecycle_conflict");
    if (request.kind === "prepare") {
      const selected = { ...scope, intentId: request.requestId };
      const old = await readProgrammeLifecycleV3(actor, selected, rpc);
      const next = old.intent ? { action: old.intent.body.action, predecessorId: old.intent.predecessorId,
        batchStart: old.intent.body.action === "upload_awards" ? old.intent.body.batchStart : null,
        batchSize: old.intent.body.action === "upload_awards" ? old.intent.body.batchSize : null } : adapter.next(execution, publication);
      requireReward(next && next.predecessorId === request.expectedPredecessorId, "reward_programme_lifecycle_conflict");
      // Exact retries keep their immutable body/nonce even after a source hold.
      // For new work SQL rechecks current authority after the fixed reader's IO.
      requireReward(reader, "reward_programme_action_reader_required");
      let binding;
      if (next.action === "stage_allocation" || next.action === "activate") {
        if (old.intent && "publication" in old.intent.body) binding = old.intent.body.publication;
        else binding = adapter.binding(publication);
      }
      await prepareProgrammeLifecycleV3(actor, { ...selected, predecessorId: next.predecessorId,
        body: { action: next.action, batchStart: next.batchStart, batchSize: next.batchSize, packageHash: request.packageHash, ...request.fees,
          ...(binding ? { publication: JSON.parse(canonicalRewardJson(binding)) } : {}) } },
      { rpc, reader });
    } else {
      const selected = { ...scope, intentId: request.intentId, attemptId: request.attemptId };
      const verified = await loadVerifiedProgrammeLifecycleV3(actor, selected, rpc);
      // Reject a swapped hash BEFORE the queue mutation, not only in its reply.
      requireReward(verified.verified.transactionHash === request.transactionHash, "reward_programme_lifecycle_job_conflict");
      await queueVerifiedProgrammeLifecycleV3(actor, { ...selected, jobId: request.requestId }, rpc);
    }
  }
  const fresh = request ? await readProgrammeExecutionStatusV3(actor, scope, rpc) : execution;
  const last = fresh.steps.at(-1);
  let selected: ProgrammeActionsV3["selected"] = null;
  if (last) {
    const target = { ...scope, intentId: last.intentId }, saved = await readProgrammeLifecycleV3(actor, target, rpc);
    const { job } = await readProgrammeLifecycleJobV3(actor, target, rpc);
    requireReward(saved.intent, "reward_programme_lifecycle_required");
    const i = saved.intent;
    requireReward(i.step === last.step && i.body.action === last.action && (i.body.action === "upload_awards" ? i.body.batchStart : null) === last.batchStart
      && (i.body.action === "upload_awards" ? i.body.batchSize : null) === last.batchSize && i.body.packageHash === fresh.packageHash
      && (saved.attempt?.body.transactionHash ?? null) === last.transactionHash
      && (!job || job.transactionHash === last.transactionHash && job.attemptId === saved.attempt?.id && job.state === last.state),
    "reward_programme_lifecycle_conflict");
    selected = { intentId: i.id, operatorAddress: i.operatorAddress, nonce: i.nonce.toString(),
      fees: { gasLimit: i.body.fees.gasLimit.toString(), maxFeePerGas: i.body.fees.maxFeePerGas.toString(),
        maxPriorityFeePerGas: i.body.fees.maxPriorityFeePerGas.toString(), maxGasCostWei: i.body.fees.maxGasCostWei.toString() },
      attemptId: saved.attempt?.id ?? null, jobId: job?.jobId ?? null };
  }
  // Fresh Auth/source read also fences any state transition during composition.
  requireReward(same(fresh, await readProgrammeExecutionStatusV3(actor, scope, rpc)), "reward_programme_lifecycle_conflict");
  const finalPublication = await readPublication(fresh);
  requireReward(publication === null || finalPublication !== null && same(adapter.stable(publication), adapter.stable(finalPublication)),
  "reward_programme_lifecycle_conflict");
  return { execution: fresh, selected, publication: finalPublication,
    ack: request ? { kind: request.kind, requestId: request.requestId } : null };
}
