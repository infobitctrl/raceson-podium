import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { createSyntheticPilotV3, syntheticPilotIdV3 as id } from "@raceson/domain/rewards/synthetic-pilot-v3";
import { programmeExecutionProgressV3 } from "@raceson/domain/rewards/programme-execution-status-v3";
import { readRewardPublishedPreviewV2, rewardHistoricalSourceV3, readAllocationUploadV3, readProgrammeLifecycleV3,
  readProgrammeExecutionStatusV3, rewardRoundPublicationV3 } from "@raceson/db/rewards";
import { encodeRewardProgrammeLifecycleV3 } from "@raceson/rewards-chain/programme-lifecycle-v3";
import { allocationApprovalV3 } from "../../../apps/api/dist/features/rewards/allocation-approval-v3-service.js";
import { allocationUploadV3 } from "../../../apps/api/dist/features/rewards/allocation-upload-v3-service.js";
import { readRegisteredProgrammeFundingV3 } from "../../../apps/api/dist/features/rewards/programme-registry-v3-service.js";
import { prepareProgrammeLifecycleV3, recordSignedProgrammeLifecycleV3 } from "../../../apps/api/dist/features/rewards/programme-lifecycle-v3-service.js";
import { queueVerifiedProgrammeLifecycleV3, runProgrammeLifecycleJobV3 } from "../../../apps/api/dist/features/rewards/programme-lifecycle-worker-v3.js";
import { compactPilotDraft } from "./compact-pilot-funding.mjs";
import { assertLocalStack } from "./local-demo.mjs";
import { localOrganizer } from "./programme-local-rehearsal.mjs";
import { startProgrammeLocalChain } from "./programme-local-chain.mjs";

/** Fixed synthetic Round 1 only. No athlete records, clocks, consent or keys are
 * fabricated. Existing holds and changed fixture rules stop this rehearsal. */
export async function prepareCompactRoundOne(runtime, session, active = () => {}) {
  active(); assert.equal(await runtime.reader.getChainId(), 31337);
  const { identity, rpc } = session, scope = { chainId: 31337, draftId: compactPilotDraft, slot: 1 };
  const source = await readRewardPublishedPreviewV2(identity, 31337, compactPilotDraft, rpc);
  const fixture = createSyntheticPilotV3(source.snapshot.capturedAt);
  assert.deepEqual(source.snapshot, fixture.snapshot); assert.deepEqual(source.record.rules, fixture.rules);
  let historical = await rewardHistoricalSourceV3(identity, 31337, compactPilotDraft, undefined, rpc);
  const old = historical.decisions.find(d => d.slot === 1); assert.notEqual(old?.decision, "held");
  if (!old?.current) {
    active(); historical = await rewardHistoricalSourceV3(identity, 31337, compactPilotDraft, { requestId: id(801001),
      slot: 1, expectedReviewId: old?.id ?? null, contextHash: historical.contextHash, decision: "confirmed_final" }, rpc);
  }
  assert.equal(historical.source.kind, "synthetic_rehearsal");
  let approval = await allocationApprovalV3(identity, scope, undefined, { rpc, reader: runtime.reader });
  if (!approval.approval) {
    assert.deepEqual(approval.reasons, []); active();
    approval = await allocationApprovalV3(identity, scope, { requestId: id(801002), expectedApprovalId: null,
      contextHash: approval.contextHash, documentHash: approval.documentHash }, { rpc, reader: runtime.reader });
  }
  assert.equal(approval.approval.id, id(801002)); assert.equal(approval.approval.current, true);
  const selected = { ...scope, approvalId: approval.approval.id };
  let upload = await allocationUploadV3(identity, selected, undefined, rpc);
  if (!upload.prepared) { active(); upload = await allocationUploadV3(identity, selected, { requestId: id(801003),
    contextHash: upload.contextHash, documentHash: upload.documentHash }, rpc); }
  assert.equal(upload.prepared.id, id(801003)); assert.equal(upload.current, true);
  const context = { ...selected, uploadId: upload.prepared.id, packageHash: upload.prepared.packageHash };
  let review = await rewardRoundPublicationV3(identity, context, undefined, rpc);
  if (!review.review) { active(); review = await rewardRoundPublicationV3(identity, context, { action: "start", requestId: id(801004),
    reviewId: null, packageHash: context.packageHash }, rpc); }
  assert.equal(review.review.id, id(801004)); assert.equal(review.review.seconds, 86400);
  // This command never publishes, even if the time is now elapsed. That requires
  // the organizer's separate explicit final-results confirmation in the portal.
  return { context, review };
}

export async function executeCompactRoundOne(runtime, session, active = () => {}) {
  const { context, review } = await prepareCompactRoundOne(runtime, session, active), { identity, rpc } = session;
  const facts = await readAllocationUploadV3(identity, context, rpc), count = Number(facts.prepared.package.entitlementCount);
  assert.ok(count > 0 && count <= 64); // Fixed cohort: one exact upload, not a bulk arbitrary sender.
  const fee = 100000000000n, gasLimit = 10000000n;
  await runtime.test.mine({ blocks: 96, interval: 1 }); // Finalize an earlier ambiguous local send; never changes the database review clock.
  let predecessorId = null;
  for (let step = 0; step < 2; step++) {
    active();
    const scope = { ...context, intentId: id(801010 + step) }, action = step === 0 ? "complete_funding" : "upload_awards";
    const saved = await prepareProgrammeLifecycleV3(identity, { ...scope, predecessorId,
      body: { action, batchStart: step === 0 ? null : 0, batchSize: step === 0 ? null : count, packageHash: context.packageHash,
        gasLimit: gasLimit.toString(), maxFeePerGas: fee.toString(), maxPriorityFeePerGas: "0", maxGasCostWei: (gasLimit * fee).toString() } },
    { rpc, reader: runtime.reader });
    const selected = { ...scope, attemptId: id(801020 + step), jobId: id(801030 + step), workerId: id(801040 + step) };
    assert.equal(saved.plan.programme.operatorAddress.toLowerCase(), runtime.operator.address.toLowerCase());
    const prior = await readProgrammeLifecycleV3(identity, scope, rpc);
    if (!prior.attempt) {
      assert.equal(saved.status, "reserved"); const tx = encodeRewardProgrammeLifecycleV3(saved.plan);
      const gas = await runtime.reader.estimateGas({ ...tx, account: runtime.operator.address }) * 12n / 10n;
      assert.ok(gas > 0n && gas <= gasLimit); active();
      const signedTransaction = await runtime.operator.signTransaction({ ...tx, type: "eip1559", gas, maxFeePerGas: fee, maxPriorityFeePerGas: 0n });
      active(); await recordSignedProgrammeLifecycleV3(identity, { ...selected, signedTransaction }, rpc);
    }
    await queueVerifiedProgrammeLifecycleV3(identity, selected, rpc);
    for (let pass = 0; pass < 3; pass++) {
      active(); const result = await runProgrammeLifecycleJobV3(identity, selected, { rpc, reader: runtime.reader,
        broadcast: bytes => { active(); return runtime.reader.sendRawTransaction({ serializedTransaction: bytes }); } });
      if (result.outcome === "confirmed") break;
      // Unknown send stops this pass. A later run reconciles the stored hash.
      assert.ok(["submitted", "pending"].includes(result.outcome), `round_one_${result.outcome}`);
      await runtime.test.mine({ blocks: 96, interval: 1 }); assert.ok(pass < 2, "round_one_unconfirmed");
    }
    predecessorId = scope.intentId;
  }
  const execution = await readProgrammeExecutionStatusV3(identity, context, rpc);
  assert.equal(programmeExecutionProgressV3(execution).uploadComplete, true);
  const record = (await readRewardPublishedPreviewV2(identity, 31337, compactPilotDraft, rpc)).record;
  const funding = await readRegisteredProgrammeFundingV3(identity, record, { rpc, reader: runtime.reader });
  assert.ok(funding.observation.pots.every(p => p.paidWei === "0"));
  return { environment: "local-synthetic-rehearsal", ...context, campaignAddress: execution.campaignAddress,
    allocatedWei: facts.prepared.package.allocatedWei, unallocatedWei: facts.prepared.package.unallocatedWei,
    awardCount: count, reviewStartedAt: review.review.startedAt, reviewEndsAt: review.review.endsAt,
    paidMon: "0", receipts: execution.steps.map(s => ({ action: s.action, transactionHash: s.transactionHash, ...s.receipt })) };
}
export function compactRoundCommand(args) { assert.deepEqual(args, ["rehearse"], "Only fixed local rehearse is supported"); }
async function main() {
  compactRoundCommand(process.argv.slice(2)); assertLocalStack();
  let runtime, session, stopped = false, finish;
  const ended = new Promise(resolve => { finish = resolve; }), deadline = Date.now() + 10 * 60 * 1000;
  const stop = () => { stopped = true; finish(); }, active = () => assert.ok(!stopped && Date.now() < deadline, "round_one_stopped");
  process.once("SIGTERM", stop); process.once("SIGINT", stop);
  try {
    runtime = await startProgrammeLocalChain(); assert.equal(runtime.fresh, false);
    session = await localOrganizer(compactPilotDraft);
    console.log(JSON.stringify(await executeCompactRoundOne(runtime, session, active)));
    await session.signOut(); session = undefined;
    console.log("Round 1 uploaded. Read-only local chain ready. No activation or recipient payout.");
    await ended;
  } finally { try { await session?.signOut(); } finally {
    process.removeListener("SIGTERM", stop); process.removeListener("SIGINT", stop); await runtime?.stop();
  } }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => {
  console.error("Local Round 1 stopped. Inspect saved reviews and exact original receipts before retrying. Private details suppressed."); process.exitCode = 1;
});
