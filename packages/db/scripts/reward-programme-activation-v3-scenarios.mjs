import assert from "node:assert/strict";
import { programmeActionsV3 } from "../../../apps/api/dist/features/rewards/programme-actions-v3-service.js";
import { recordSignedProgrammeLifecycleV3, loadVerifiedProgrammeLifecycleV3 } from "../../../apps/api/dist/features/rewards/programme-lifecycle-v3-service.js";
import { runProgrammeLifecycleJobV3 } from "../../../apps/api/dist/features/rewards/programme-lifecycle-worker-v3.js";
import { readProgrammeLifecycleV3, readProgrammeExecutionStatusV3, rewardRoundPublicationV3 } from "../dist/rewards/index.js";
import { nextProgrammeActionV3 } from "../../domain/dist/rewards/programme-actions-v3.js";
import { programmeActivationProgressV3 } from "../../domain/dist/rewards/programme-execution-status-v3.js";
import { encodeRewardProgrammeLifecycleV3 } from "../../rewards-chain/dist/programme-lifecycle-v3.js";
import { literal as q } from "./reward-integration-fixture.mjs";
import { athleteClaimsV3Scenarios } from "./reward-athlete-claims-v3-scenarios.mjs";
const id = n => `8e000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** Only invoked with the parent validator's scratch DB and disposable chain.
 * The elapsed-review fixture and all new ledger rows are transaction-local and
 * rolled back. Nothing edits the saved demo clock or supplies athlete consent. */
export async function programmeActivationV3Scenarios({ harness, scenario, identity, scope, runtime }) {
  const fees = { gasLimit: "10000000", maxFeePerGas: "100000000000", maxPriorityFeePerGas: "0", maxGasCostWei: "1000000000000000000" };
  const original = await rewardRoundPublicationV3(identity, scope, undefined, harness.rpc);
  await scenario("V3 activation cannot be prepared merely because all awards were uploaded", async () => {
    const view = await programmeActionsV3(identity, scope, undefined, { rpc: harness.rpc, reader: runtime.reader });
    assert.equal(view.publication.publication, null); assert.equal(nextProgrammeActionV3(view.execution, view.publication), null);
    await assert.rejects(programmeActionsV3(identity, scope, { kind: "prepare", requestId: id(1),
      expectedPredecessorId: view.execution.steps.at(-1).intentId, packageHash: scope.packageHash, fees },
    { rpc: harness.rpc, reader: runtime.reader }), /reward_programme_lifecycle_conflict/);
  });
  await scenario("elapsed synthetic publication → saved V3 stage/activate jobs → real receipts, retry and held-source reconciliation", async () => {
    await harness.rollbackFixture(async ({ query, rpc }) => {
      await query(`alter table app_private.reward_round_reviews_v3 disable trigger reward_round_reviews_v3_immutable;
        update app_private.reward_round_reviews_v3 set started_at=clock_timestamp()-interval '24 hours 1 second' where id=${q(original.review.id)};
        alter table app_private.reward_round_reviews_v3 enable trigger reward_round_reviews_v3_immutable;`);
      const publication = await rewardRoundPublicationV3(identity, scope, { action: "publish", requestId: id(2),
        reviewId: original.review.id, packageHash: scope.packageHash }, rpc);
      assert.equal(publication.review.seconds, 86400); assert.equal(publication.publication.id, id(2));
      const actions = change => programmeActionsV3(identity, scope, change, { rpc, reader: runtime.reader });
      let view = await actions(), sends = 0;
      for (const [index, action] of ["stage_allocation", "activate"].entries()) {
        assert.equal(nextProgrammeActionV3(view.execution, view.publication).action, action);
        const request = { kind: "prepare", requestId: id(10 + index), expectedPredecessorId: view.execution.steps.at(-1).intentId,
          packageHash: scope.packageHash, fees };
        view = await actions(request);
        const selected = { ...scope, intentId: request.requestId, attemptId: id(20 + index), jobId: id(30 + index), workerId: id(40 + index) };
        const saved = await readProgrammeLifecycleV3(identity, selected, rpc);
        assert.equal(saved.intent.body.publication.publicationId, id(2));
        assert.equal(saved.intent.body.publication.reviewPeriod, 86400n);
        assert.equal(saved.intent.body.publication.publicationEvidenceHash, publication.publication.evidenceHash);
        // Altered stored witnesses cannot become a new signature or reservation.
        const altered = { ...saved.intent.body.publication, publicationEvidenceHash: `0x${"f".repeat(64)}` };
        await query("savepoint invalid_publication;");
        const bad = await rpc("service_reserve_reward_programme_activation_v3", {
          p_actor_user_id: identity.userId, p_actor_session_id: identity.sessionId, p_chain_id: scope.chainId,
          p_draft_id: scope.draftId, p_slot: scope.slot, p_approval_id: scope.approvalId, p_upload_id: scope.uploadId,
          p_intent_id: selected.intentId, p_predecessor_id: request.expectedPredecessorId, p_pending_nonce: saved.intent.nonce.toString(),
          p_body: { action, batchStart: null, batchSize: null, packageHash: scope.packageHash, ...fees,
            publication: JSON.parse(JSON.stringify(altered, (_, v) => typeof v === "bigint" ? v.toString() : v)) } });
        assert.equal(bad.error?.message, "reward_round_publication_conflict");
        await query("rollback to savepoint invalid_publication;");
        // Exact action retries preserve the reservation and immutable binding.
        assert.deepEqual((await actions(request)).selected, view.selected);
        const { programmeLifecyclePlanV3 } = await import("../../../apps/api/dist/features/rewards/programme-lifecycle-v3-service.js");
        const plan = programmeLifecyclePlanV3(saved), tx = encodeRewardProgrammeLifecycleV3(plan);
        const gas = await runtime.reader.estimateGas({ ...tx, account: runtime.operator.address }) * 12n / 10n;
        const signedTransaction = await runtime.operator.signTransaction({ ...tx, type: "eip1559", gas,
          maxFeePerGas: BigInt(fees.maxFeePerGas), maxPriorityFeePerGas: 0n });
        await recordSignedProgrammeLifecycleV3(identity, { ...selected, signedTransaction }, rpc);
        const verified = await loadVerifiedProgrammeLifecycleV3(identity, selected, rpc);
        const queue = { kind: "queue", requestId: selected.jobId, intentId: selected.intentId, attemptId: selected.attemptId,
          transactionHash: verified.verified.transactionHash, packageHash: scope.packageHash };
        await actions(queue);
        const run = () => runProgrammeLifecycleJobV3(identity, selected, { rpc, reader: runtime.reader, broadcast: async bytes => {
          const hash = await runtime.reader.sendRawTransaction({ serializedTransaction: bytes }); sends++;
          if (index === 0) throw Error("synthetic_lost_stage_reply");
          return hash;
        } });
        assert.equal((await run()).outcome, index === 0 ? "broadcast_unknown" : "submitted");
        await runtime.test.mine({ blocks: 96, interval: 1 });
        if (index === 0) await query(`update app_private.reward_planning_drafts set revision=revision+1 where id=${q(scope.draftId)};`);
        assert.equal((await run()).outcome, "confirmed");
        assert.equal((await run()).outcome, "confirmed"); assert.equal(sends, index + 1);
        if (index === 0) {
          assert.equal((await actions()).execution.current, false);
          await query(`update app_private.reward_planning_drafts set revision=revision-1 where id=${q(scope.draftId)};`);
        }
        view = await actions(); assert.equal(view.execution.steps.at(-1).action, action);
        assert.equal(view.execution.steps.at(-1).state, "confirmed");
        assert.doesNotMatch(JSON.stringify(view), /signedTransaction|privateKey|snapshotSalt|leaseToken/);
      }
      assert.deepEqual(programmeActivationProgressV3(view.execution), { staged: true, activated: true });
      assert.equal(nextProgrammeActionV3(view.execution, view.publication), null);
      assert.equal(view.execution.steps.length, 4); assert.equal(sends, 2);
      const child = view.execution.campaignAddress;
      const { rewardCampaignV3Abi } = await import("../../rewards-chain/dist/campaign-v3.js");
      assert.equal(await runtime.reader.readContract({ address: child, abi: rewardCampaignV3Abi, functionName: "state" }), 3);
      assert.equal(await runtime.reader.readContract({ address: child, abi: rewardCampaignV3Abi, functionName: "paid", args: [0n] }), 0n);
      assert.equal(await runtime.reader.getBalance({ address: child }), 10n * 10n ** 18n);
      await athleteClaimsV3Scenarios({query,rpc,scope,identity,runtime});
    });
    assert.deepEqual((await rewardRoundPublicationV3(identity, scope, undefined, harness.rpc)).review, original.review);
    assert.equal((await rewardRoundPublicationV3(identity, scope, undefined, harness.rpc)).publication, null);
    assert.equal((await readProgrammeExecutionStatusV3(identity, scope, harness.rpc)).steps.length, 2);
  });
}
