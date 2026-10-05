import assert from "node:assert/strict";
import test from "node:test";
import { readProgrammeLifecycleJobV3, queueProgrammeLifecycleJobV3, stepProgrammeLifecycleJobV3,
  decodeProgrammeLifecycleReceiptV3 } from "../../../packages/db/dist/rewards/index.js";
import { runProgrammeLifecycleJobV3 } from "../dist/features/rewards/programme-lifecycle-worker-v3.js";
const id = n => `8c000000-0000-4000-8000-${String(n).padStart(12, "0")}`, h = n => `0x${String(n).padStart(64, "0")}`;
const identity = () => ({ userId: id(1), sessionId: id(2) });
const scope = () => ({ chainId: 31337, draftId: id(3), slot: 1, approvalId: id(4), uploadId: id(5), intentId: id(6), jobId: id(7), attemptId: id(8), workerId: id(9) });
const job = (state = "queued") => ({ jobId: id(7), intentId: id(6), attemptId: id(8), transactionHash: h(10), createdByUserId: id(1),
  createdAt: "2026-09-10T00:00:00Z", state, mayHaveBroadcast: state === "confirmed", leaseOwner: state === "leased" ? id(9) : null,
  leaseToken: state === "leased" ? id(11) : null, leaseExpiresAt: state === "leased" ? "2026-09-10T00:01:00Z" : null, leaseGeneration: state === "queued" ? 0 : 1 });
const receipt = () => ({ protocolVersion: 3, provenance: { kind: "programme-child", programmeAddress: `0x${"1".repeat(40)}`, deploymentTransactionHash: h(1), slot: 0 },
  action: "complete_funding", campaignAddress: `0x${"2".repeat(40)}`, transactionHash: h(10), nonce: "3", blockNumber: "10", blockHash: h(11),
  blockTimestamp: "1000", gasUsed: "100", effectiveGasPrice: "2", feeWei: "200", finalizedBlock: { number: "11", hash: h(12), timestamp: "1001" },
  accountingAtReceiptBlock: { state: 1, paused: false, accountedFunding: "10", treasuryReturned: "0", budgets: ["10", "0"], allocated: ["0", "0"], paid: ["0", "0"],
    nativeBalance: "10", entitlementCount: "0", uploadDigest: h(0), snapshotDigest: h(0), allocationDigest: h(0), activationNotBefore: "0", claimDeadline: "0", pausedAt: "0" },
  publicationAtReceiptBlock: { reviewPeriod: "86400", reviewStartedAt: "0", officialPublishedAt: "0", publicationEvidenceHash: h(0) } });
const view = () => ({ schema: "raceson-programme-lifecycle-job-v3", job: job("confirmed"),
  receipt: { body: receipt(), recordedAt: "2026-09-10T00:00:00Z", recordedByUserId: id(1) } });
const ok = data => async () => ({ data, error: null });
test("V3 job read needs a matching receipt for confirmation and never returns an unknown signed payload", async () => {
  assert.equal((await readProgrammeLifecycleJobV3(identity(), scope(), ok(view()))).receipt.body.feeWei, 200n);
  for (const mutate of [v => v.receipt = null, v => v.job.state = "leased", v => v.receipt.body.transactionHash = h(99),
    v => v.receipt.recordedByUserId = id(99), v => v.receipt.body.provenance.slot = 1, v => v.job.signedTransaction = "forbidden",
    v => v.receipt.body.publicationAtReceiptBlock.reviewPeriod = "18446744073709551616"]) {
    const v = view(); mutate(v); await assert.rejects(readProgrammeLifecycleJobV3(identity(), scope(), ok(v)));
  }
});
test("V3 receipt transport rejects fee arithmetic, finality, protocol and unbounded/private fields", () => {
  for (const mutate of [r => r.feeWei = "201", r => r.gasUsed = "0", r => r.effectiveGasPrice = "0", r => r.finalizedBlock.number = "9",
    r => r.finalizedBlock.timestamp = "999", r => r.finalizedBlock.number = "10", r => r.protocolVersion = 2,
    r => r.action = "activate", r => r.provenance.slot = 6, r => r.signedTransaction = "forbidden", r => r.nonce = 3]) {
    const r = receipt(); mutate(r); assert.throws(() => decodeProgrammeLifecycleReceiptV3(r));
  }
});
test("V3 lifecycle confirmed history requires no RPC provider or repeat broadcast", async () => {
  const result = await runProgrammeLifecycleJobV3(identity(), scope(), { rpc: ok(view()), reader: new Proxy({}, { get() { throw Error("no chain IO"); } }),
    broadcast() { throw Error("no duplicate broadcast"); } });
  assert.deepEqual(result, { jobId: id(7), outcome: "confirmed" }); assert.doesNotMatch(JSON.stringify(result), /leaseToken|signedTransaction/);
});
test("V3 stage and activation receipts require completed publication and action-specific accounting", () => {
  for (const action of ["stage_allocation", "activate"]) {
    const r = receipt(); r.action = action; r.blockTimestamp = "90000"; r.finalizedBlock.timestamp = "90001";
    r.publicationAtReceiptBlock = { reviewPeriod: "86400", reviewStartedAt: "1", officialPublishedAt: "86401", publicationEvidenceHash: h(7) };
    Object.assign(r.accountingAtReceiptBlock, { state: action === "activate" ? 3 : 2, snapshotDigest: h(8), allocationDigest: h(9),
      activationNotBefore: action === "activate" ? "89999" : "90000", claimDeadline: action === "activate" ? "31626000" : "0" });
    assert.equal(decodeProgrammeLifecycleReceiptV3(r).action, action);
    for (const mutate of [v => v.publicationAtReceiptBlock.reviewStartedAt = "0", v => v.publicationAtReceiptBlock.officialPublishedAt = "86400",
      v => v.publicationAtReceiptBlock.officialPublishedAt = "90001", v => v.publicationAtReceiptBlock.publicationEvidenceHash = h(0),
      v => v.accountingAtReceiptBlock.allocationDigest = h(0), v => v.accountingAtReceiptBlock.snapshotDigest = h(0),
      v => v.accountingAtReceiptBlock.activationNotBefore = "86400", v => v.accountingAtReceiptBlock.state = 1,
      v => action === "activate" ? v.accountingAtReceiptBlock.claimDeadline = "31625999" : v.accountingAtReceiptBlock.activationNotBefore = "89999"]) {
      const changed = structuredClone(r); mutate(changed); assert.throws(() => decodeProgrammeLifecycleReceiptV3(changed));
    }
  }
});
test("V3 job queue captures exact identifiers before asynchronous transport", async () => {
  const a = identity(), s = scope();
  assert.deepEqual(await queueProgrammeLifecycleJobV3(a, s, async (_, args) => {
    a.userId = id(99); s.jobId = id(99); s.slot = 2;
    assert.equal(args.p_actor_user_id, id(1)); assert.equal(args.p_slot, 1); return { data: job(), error: null };
  }), job());
  for (const patch of [{ chainId: 143 }, { slot: 7 }, { jobId: "missing" }]) {
    let called = false; await assert.rejects(queueProgrammeLifecycleJobV3(identity(), { ...scope(), ...patch }, async () => { called = true; return { data: job(), error: null }; }));
    assert.equal(called, false);
  }
});
test("final receipts use the correct inactive pot and reject a swapped race/league balance", () => {
  for (const slot of [4, 5]) {
    const r = receipt(); r.provenance.slot = slot;
    if (slot === 5) r.accountingAtReceiptBlock.budgets = ["0", "10"];
    assert.equal(decodeProgrammeLifecycleReceiptV3(r).provenance.slot, slot);
    r.accountingAtReceiptBlock.budgets.reverse();
    assert.throws(() => decodeProgrammeLifecycleReceiptV3(r));
  }
});
test("V3 worker leases reject wrong owners/tokens and confirmation without receipt", async () => {
  const input = { ...scope(), action: "lease", leaseToken: null };
  assert.equal(await stepProgrammeLifecycleJobV3(identity(), input, ok(null)), null);
  assert.equal((await stepProgrammeLifecycleJobV3(identity(), input, ok(job("leased")))).leaseToken, id(11));
  for (const patch of [{ leaseOwner: id(99) }, { leaseToken: null }, { leaseGeneration: 0 }, { state: "submitted" }])
    await assert.rejects(stepProgrammeLifecycleJobV3(identity(), input, ok({ ...job("leased"), ...patch })));
  await assert.rejects(stepProgrammeLifecycleJobV3(identity(), { ...input, action: "confirm", leaseToken: id(11) }, ok(job("confirmed"))));
  await assert.rejects(stepProgrammeLifecycleJobV3(identity(), { ...input, action: "arm", leaseToken: id(99) }, ok({ ...job("leased"), state: "broadcasting", mayHaveBroadcast: true })));
});
test("V3 job transport sanitizes private provider failures and preserves source/lease holds", async () => {
  await assert.rejects(readProgrammeLifecycleJobV3(identity(), scope(), async () => { throw Error("private RPC credentials"); }), { code: "reward_ledger_unavailable" });
  for (const message of ["reward_allocation_not_ready", "reward_programme_lifecycle_lease_lost", "reward_programme_lifecycle_predecessor_required"])
    await assert.rejects(readProgrammeLifecycleJobV3(identity(), scope(), async () => ({ error: { message }, data: null })), { code: message });
});
