import assert from "node:assert/strict";
import test from "node:test";
import { decodeFunctionData, serializeTransaction } from "viem";
import { rewardCampaignV3Abi } from "../dist/campaign-v3.js";
import { decodeRewardProgrammeUploadV3, normalizeRewardProgrammeLifecycleV3, encodeRewardProgrammeLifecycleV3,
  verifySignedRewardProgrammeLifecycleV3, readRewardProgrammeLifecyclePrestateV3, readVerifiedRewardProgrammeLifecycleV3 } from "../dist/programme-lifecycle-v3.js";
import { lifecyclePlan, lifecycleOperator as operator, lifecycleStranger as stranger, h } from "./programme-lifecycle-fixture-v3.mjs";
const actions = ["complete_funding", "upload_awards", "stage_allocation", "activate"];
const signing = p => ({ ...encodeRewardProgrammeLifecycleV3(p), type: "eip1559", gas: 2000000n,
  maxFeePerGas: 20000000000n, maxPriorityFeePerGas: 100000000n });

test("V3 programme lifecycle derives all six targets, exact public packages and only zero-value actions", () => {
  for (let slot = 0; slot < 6; slot++) for (const action of actions) {
    const input = lifecyclePlan(action, slot), p = normalizeRewardProgrammeLifecycleV3(input), encoded = encodeRewardProgrammeLifecycleV3(input);
    assert.equal(encoded.value, 0n); assert.equal(encoded.to, p.child.context.verifyingContract);
    assert.deepEqual(p.upload, input.upload); assert.notEqual(p.upload.awards[0], input.upload.awards[0]);
    const call = decodeFunctionData({ abi: rewardCampaignV3Abi, data: encoded.data });
    assert.equal(call.functionName, { complete_funding: "completeFunding", upload_awards: "uploadAwards", stage_allocation: "stageAllocation", activate: "activate" }[action]);
    if (action === "complete_funding") assert.deepEqual(call.args, [p.child.budgetWei, p.child.budgetWei]);
    if (action === "stage_allocation") assert.deepEqual(call.args, [p.upload.snapshotDigest, p.upload.uploadDigest, 2n,
      p.publication.reviewStartedAt, p.publication.officialPublishedAt, p.publication.publicationEvidenceHash]);
    if (action === "activate") assert.deepEqual(call.args, [p.commitment.allocationDigest, p.upload.snapshotDigest]);
    const before = structuredClone(p); input.upload.awards[0].amount = "3"; input.programme.context.chainId = 143; input.fees.gasLimit = 1n;
    assert.deepEqual(p, before);
  }
});
test("clockless upload cannot silently stage: exact schema rejects private metadata, fake dates, downgrades and altered recipients", () => {
  const mutations = [p => p.protocolVersion = 2, p => p.upload.protocolVersion = 2, p => p.upload.chainId = 143,
    p => p.programme.context.chainId = 143, p => p.slot = 1, p => p.slot = 5, p => p.slot = 6, p => p.slot = .5,
    p => p.upload.programmeAddress = stranger.address, p => p.upload.campaignAddress = stranger.address,
    p => p.upload.deploymentTransactionHash = h(99), p => p.upload.programmeId = h(99), p => p.upload.campaignId = h(99),
    p => p.upload.programmeManifestHash = h(99), p => p.upload.reviewPeriod = "0", p => p.upload.budgetWei = "1",
    p => p.upload.allocatedWei = "1", p => p.upload.unallocatedWei = "1", p => p.upload.uploadDigest = h(99),
    p => p.upload.entitlementCount = "1", p => p.upload.awards[0].amount = "2", p => p.upload.awards.reverse(),
    p => p.upload.awards[1].beneficiaryId = p.upload.awards[0].beneficiaryId, p => p.upload.awards[0].beneficiaryKind = 2,
    p => p.upload.awards[0].pot = 1, p => p.upload.awards[0].name = "private", p => p.upload.officialPublishedAt = "100",
    p => p.upload.budgetWei = "01", p => p.upload.snapshotDigest = h(0), p => p.upload.awards = new Array(2),
    p => Object.defineProperty(p.upload, "snapshotDigest", { get() { assert.fail("must not invoke getter"); }, enumerable: true }),
    p => p.nonce = 3n, p => p.nonce = BigInt(Number.MAX_SAFE_INTEGER) + 1n,
    p => p.batchStart = -1, p => p.batchStart = .1, p => p.batchSize = 0, p => p.batchSize = 65, p => p.batchStart = 2,
    p => p.publication = {}, p => p.action = "returnSurplus", p => p.fees.gasLimit = 30000001n,
    p => p.fees.maxGasCostWei = 1n, p => p.fees.maxPriorityFeePerGas = p.fees.maxFeePerGas + 1n];
  for (const mutate of mutations) { const p = lifecyclePlan(); mutate(p); assert.throws(() => normalizeRewardProgrammeLifecycleV3(p)); }
  for (const mutate of [p => delete p.publication, p => p.publication.reviewStartedAt = 0n,
    p => p.publication.officialPublishedAt--, p => p.publication.reviewPeriod = 0n,
    p => p.publication.publicationEvidenceHash = h(0), p => p.batchSize = 1]) {
    const p = lifecyclePlan("stage_allocation"); mutate(p); assert.throws(() => normalizeRewardProgrammeLifecycleV3(p));
  }
});
test("empty awards preserve the full reserve and allow closure/staging but not an empty upload; max batch is 64", async () => {
  for (const action of ["complete_funding", "stage_allocation", "activate"]) {
    const p = lifecyclePlan(action, 5, 0); assert.equal(normalizeRewardProgrammeLifecycleV3(p).upload.allocatedWei, "0");
    assert.equal(decodeRewardProgrammeUploadV3(p.programme, 5, p.upload).unallocatedWei, p.upload.budgetWei);
  }
  assert.throws(() => normalizeRewardProgrammeLifecycleV3(lifecyclePlan("upload_awards", 0, 0)));
  const p = lifecyclePlan("upload_awards", 0, 64);
  const v = await verifySignedRewardProgrammeLifecycleV3(p, await operator.signTransaction(signing(p)));
  assert.equal(v.action, "upload_awards");
});
test("all V3 lifecycle signatures capture the fixed plan before recovery", async () => {
  for (const action of actions) {
    const p = lifecyclePlan(action), signed = await operator.signTransaction(signing(p));
    const pending = verifySignedRewardProgrammeLifecycleV3(p, signed);
    p.upload.awards[0].amount = "5"; p.nonce = 99n; p.programme.operatorAddress = stranger.address;
    const v = await pending;
    assert.equal(v.nonce, 4n); assert.equal(v.signedTransaction, signed); assert.equal(v.protocolVersion, 3);
  }
});
test("signed V3 attempts reject wrong signer, target, chain, nonce, calldata, value, access list and fees", async () => {
  const p = lifecyclePlan(), tx = signing(p);
  await assert.rejects(verifySignedRewardProgrammeLifecycleV3(p, await stranger.signTransaction(tx)), { code: "reward_lifecycle_sender_mismatch" });
  for (const patch of [{ to: stranger.address }, { chainId: 143 }, { nonce: 5 }, { value: 1n }, { data: tx.data + "00" },
    { data: encodeRewardProgrammeLifecycleV3(lifecyclePlan("activate")).data }, { accessList: [{ address: stranger.address, storageKeys: [] }] },
    { gas: 0n }, { gas: p.fees.gasLimit + 1n }, { maxFeePerGas: p.fees.maxFeePerGas + 1n },
    { maxPriorityFeePerGas: p.fees.maxPriorityFeePerGas + 1n }])
    await assert.rejects(verifySignedRewardProgrammeLifecycleV3(p, await operator.signTransaction({ ...tx, ...patch })));
  for (const bad of ["0x02aa", "0x02" + "aa".repeat(16385), serializeTransaction(tx), (await operator.signTransaction(tx)) + "00"])
    await assert.rejects(verifySignedRewardProgrammeLifecycleV3(p, bad));
});
test("canonical zero-tip V3 transactions retain an exact zero ceiling on save and reload", async () => {
  for (const action of actions) {
    const p = lifecyclePlan(action); p.fees.maxPriorityFeePerGas = 0n;
    const signed = await operator.signTransaction({ ...signing(p), maxPriorityFeePerGas: 0n });
    const verified = await verifySignedRewardProgrammeLifecycleV3(p, signed);
    assert.equal(verified.maxPriorityFeePerGas, 0n);
    assert.deepEqual(await verifySignedRewardProgrammeLifecycleV3(p, signed), verified);
    await assert.rejects(verifySignedRewardProgrammeLifecycleV3(p,
      await operator.signTransaction({ ...signing(p), maxPriorityFeePerGas: 1n })), { code: "invalid_reward_lifecycle_fees" });
  }
});
test("bad inputs fail before network IO; provider errors do not disclose credential-bearing endpoints", async () => {
  let calls = 0;
  const reader = { getChainId: async () => { calls++; throw new Error("private-provider-secret"); } };
  const p = lifecyclePlan();
  await assert.rejects(readRewardProgrammeLifecyclePrestateV3(reader, { ...p, protocolVersion: 1 }), { code: "wrong_reward_lifecycle_protocol" });
  await assert.rejects(readVerifiedRewardProgrammeLifecycleV3(reader, p, "0x02aa")); assert.equal(calls, 0);
  for (const call of [() => readRewardProgrammeLifecyclePrestateV3(reader, p),
    async () => readVerifiedRewardProgrammeLifecycleV3(reader, p, await operator.signTransaction(signing(p)))]) {
    await assert.rejects(call(), error => !JSON.stringify(error).includes("private-provider-secret") && !error.cause);
  }
  assert.equal(calls, 2);
});
