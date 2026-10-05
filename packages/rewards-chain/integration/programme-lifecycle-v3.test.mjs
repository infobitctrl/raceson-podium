import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { encodeDeployData, getContractAddress, parseEther } from "viem";
import { rewardCampaignV3Abi as abi, rewardAllocationCommitmentV3 } from "../dist/campaign-v3.js";
import { rewardProgrammeChildV3 } from "../dist/programme-v3.js";
import { encodeRewardProgrammeLifecycleV3, verifySignedRewardProgrammeLifecycleV3,
  readRewardProgrammeLifecyclePrestateV3, readVerifiedRewardProgrammeLifecycleV3 } from "../dist/programme-lifecycle-v3.js";
import { publicPackage, lifecycleFees, h } from "../test/programme-lifecycle-fixture-v3.mjs";
import { startOwnedRewardChain, fixtureSigner } from "./owned-chain.mjs";
import { programmePaymentCasesV3 } from "./programme-payment-cases-v3.mjs";

const artifact = JSON.parse(readFileSync(new URL("../../../contracts/out/RacesOnRewardProgrammeV3.sol/RacesOnRewardProgrammeV3.json", import.meta.url)));

test("V3 actual factory execution: 24h/custom/zero review, 64+1 upload, lost response and exact receipt checks", { timeout: 180000 }, async t => {
  const chain = await startOwnedRewardChain({ retainLifecycleHistory: true });
  try {
    const c = chain.publicClient, funder = fixtureSigner(0xCA110), budget = parseEther("100");
    const finalize = () => chain.testClient.mine({ blocks: 96, interval: 1 });
    const receipt = async hash => { const r = await c.waitForTransactionReceipt({ hash: await hash });
      assert.equal(r.status, "success"); await finalize(); return r; };
    const nonce = BigInt(await c.getTransactionCount({ address: chain.operator.address }));
    const programme = { context: { environment: "local-simulation", chainId: 31337,
      verifyingContract: getContractAddress({ from: chain.operator.address, nonce }) }, funderAddress: funder.address,
      operatorAddress: chain.operator.address, programmeId: h(11), programmeManifestHash: h(12), budgetWei: budget,
      campaignIds: Array.from({ length: 6 }, (_, i) => h(20 + i)), reviewPeriods: [86400n, 3600n, 0n, 0n, 0n, 0n], deploymentNonce: nonce };
    const deployment = await receipt(chain.operatorClient.sendTransaction({ data: encodeDeployData({ abi: artifact.abi,
      bytecode: artifact.bytecode.object, args: [funder.address, chain.operator.address, programme.programmeId,
        programme.programmeManifestHash, budget, programme.campaignIds, programme.reviewPeriods] }) }));
    programme.deploymentTransactionHash = deployment.transactionHash;
    assert.equal(deployment.contractAddress.toLowerCase(), programme.context.verifyingContract.toLowerCase());
    await chain.testClient.setBalance({ address: funder.address, value: budget + parseEther("5") });
    await receipt(chain.operatorClient.writeContract({ address: programme.context.verifyingContract, abi: artifact.abi,
      functionName: "deposit", args: [0n], account: funder, value: budget }));
    const attempts = [];
    for (const slot of [0, 1, 5]) await t.test(`slot ${slot}: immutable ${programme.reviewPeriods[slot]}-second policy`, async () => {
      const child = rewardProgrammeChildV3(programme, slot);
      const awards = Array.from({ length: slot === 0 ? 65 : slot === 1 ? 0 : 1 }, (_, i) => ({ entitlementId: h(1000 + i),
        beneficiaryId: h(2000 + i), explanationHash: h(3000 + i), pot: child.enabledPot, amount: 1n, beneficiaryKind: i % 2 }));
      const upload = publicPackage(programme, slot, awards), start = (await c.getBlock({ blockTag: "finalized" })).timestamp;
      // Authenticated source composition is NOT simulated by this fixture. These
      // explicit test clocks only exercise the exact contract/protocol semantics.
      const publication = { reviewPeriod: child.reviewPeriod, reviewStartedAt: start,
        officialPublishedAt: start + child.reviewPeriod, publicationEvidenceHash: h(4000 + slot) };
      const plan = async (action, extra = {}) => ({ protocolVersion: 3, programme, slot, upload, action, ...extra, fees: { ...lifecycleFees },
        nonce: BigInt(await c.getTransactionCount({ address: chain.operator.address })) });
      const run = async (p, lost = false) => {
        const before = await readRewardProgrammeLifecyclePrestateV3(c, p);
        assert.equal(before.campaignAddress, child.context.verifyingContract);
        const serialized = await chain.operator.signTransaction({ ...encodeRewardProgrammeLifecycleV3(p), type: "eip1559",
          gas: lifecycleFees.gasLimit, maxFeePerGas: lifecycleFees.maxFeePerGas, maxPriorityFeePerGas: lifecycleFees.maxPriorityFeePerGas });
        const verified = await verifySignedRewardProgrammeLifecycleV3(p, serialized);
        if (lost) await assert.rejects(async () => {
          await chain.operatorClient.sendRawTransaction({ serializedTransaction: serialized }); throw new Error("synthetic_lost_response");
        }, /synthetic_lost_response/);
        else assert.equal(await chain.operatorClient.sendRawTransaction({ serializedTransaction: serialized }), verified.transactionHash);
        const r = await receipt(Promise.resolve(verified.transactionHash));
        const proof = await readVerifiedRewardProgrammeLifecycleV3(c, p, serialized);
        assert.equal(proof.transactionHash, r.transactionHash); assert.equal(proof.blockTimestamp, (await c.getBlock({ blockNumber: r.blockNumber })).timestamp);
        const operatorNonce = await c.getTransactionCount({ address: chain.operator.address });
        assert.deepEqual(await readVerifiedRewardProgrammeLifecycleV3(c, p, serialized), proof);
        assert.equal(await c.getTransactionCount({ address: chain.operator.address }), operatorNonce);
        assert.equal(proof.accountingAtReceiptBlock.paid[child.enabledPot], 0n);
        attempts.push({ p, serialized, proof }); return proof;
      };
      await assert.rejects(readRewardProgrammeLifecyclePrestateV3(c, await plan("complete_funding")));
      await receipt(chain.operatorClient.writeContract({ address: programme.context.verifyingContract, abi: artifact.abi, functionName: "routePot", args: [slot] }));
      const close = await plan("complete_funding");
      const normal = await readRewardProgrammeLifecyclePrestateV3(c, close), blocks = [];
      const scoped = await readRewardProgrammeLifecyclePrestateV3({ ...c, readContract: args => {
        blocks.push(args.blockNumber); return c.readContract(args);
      }, getBalance: args => { blocks.push(args.blockNumber); return c.getBalance(args); },
      getCode: args => { blocks.push(args.blockNumber); return c.getCode(args); } }, close);
      assert.deepEqual(scoped, normal); assert.ok(blocks.length > 100 && blocks.every(b => b === scoped.finalizedBlock.number));
      await assert.rejects(readRewardProgrammeLifecyclePrestateV3({ ...c, getCode: args => args.address === programme.operatorAddress
        ? Promise.resolve("0xef0100" + "11".repeat(20)) : c.getCode(args) }, close), { code: "reward_lifecycle_eoa_operator_required" });
      const mutable = structuredClone(close); let changed = false;
      assert.deepEqual(await readRewardProgrammeLifecyclePrestateV3({ ...c, getChainId: async () => {
        if (!changed) { changed = true; mutable.programme.context.chainId = 143; mutable.upload.snapshotDigest = h(99); mutable.nonce++; }
        return c.getChainId();
      } }, mutable), normal);
      await run(close, slot === 0);
      for (let batchStart = 0; batchStart < awards.length; batchStart += 64) {
        const p = await plan("upload_awards", { batchStart, batchSize: Math.min(64, awards.length - batchStart) });
        if (batchStart) {
          await assert.rejects(readRewardProgrammeLifecyclePrestateV3(c, { ...p, batchStart: 0 }), { code: "reward_lifecycle_prefix_mismatch" });
          await assert.rejects(readRewardProgrammeLifecyclePrestateV3({ ...c, readContract: async args => {
            const v = await c.readContract(args); return args.address === child.context.verifyingContract && args.functionName === "uploadDigest" ? h(99) : v;
          } }, p), { code: "reward_lifecycle_prefix_mismatch" });
        }
        await run(p);
      }
      let stage = await plan("stage_allocation", { publication });
      if (slot === 5) {
        // A valid baseline is essential: a future publication or wrong action
        // must not make these malformed-state checks pass for another reason.
        await readRewardProgrammeLifecyclePrestateV3(c, stage);
        for (const [field, value] of [["PROTOCOL_VERSION", 2n], ["reviewPeriod", 1n], ["reviewStartedAt", 1n]])
          await assert.rejects(readRewardProgrammeLifecyclePrestateV3({ ...c, readContract: async args => {
            const actual = await c.readContract(args); return args.address === child.context.verifyingContract && args.functionName === field ? value : actual;
          } }, stage), { code: "reward_programme_lifecycle_mismatch" });
      }
      if (child.reviewPeriod) {
        await assert.rejects(readRewardProgrammeLifecyclePrestateV3(c, stage), { code: "reward_lifecycle_publication_in_future" });
        await assert.rejects(c.call({ account: chain.operator.address, to: child.context.verifyingContract, data: encodeRewardProgrammeLifecycleV3(stage).data }));
        await chain.testClient.increaseTime({ seconds: Number(child.reviewPeriod) }); await finalize();
        stage = await plan("stage_allocation", { publication });
      }
      const staged = await run(stage);
      assert.equal(staged.accountingAtReceiptBlock.activationNotBefore, staged.blockTimestamp, "no second on-chain wait");
      const activate = await plan("activate", { publication });
      await assert.rejects(readRewardProgrammeLifecyclePrestateV3(c, { ...activate,
        publication: { ...publication, publicationEvidenceHash: h(99) } }));
      const active = await run(activate);
      assert.equal(active.accountingAtReceiptBlock.claimDeadline, active.blockTimestamp + 31536000n);
      assert.equal(active.accountingAtReceiptBlock.allocated[child.enabledPot], BigInt(awards.length));
      assert.equal(active.accountingAtReceiptBlock.nativeBalance, child.budgetWei);
      const recipient = fixtureSigner(0xA715);
      const payment = awards.length ? await programmePaymentCasesV3({ reader: c, testClient: chain.testClient, operator: chain.operator, recipient,
        expectation: { protocolVersion: 3, programme, slot, entitlementId: awards[0].entitlementId, recipient: recipient.address,
          stageTransactionHash: staged.transactionHash, upload: rewardAllocationCommitmentV3({ ...child, ...publication,
            budget: child.budgetWei, awards, snapshotDigest: upload.snapshotDigest }) } }) : null;
      // Actual pause affects new readiness, never the already-finalized result.
      await receipt(chain.operatorClient.writeContract({ address: child.context.verifyingContract, abi, functionName: "pause" }));
      await assert.rejects(readRewardProgrammeLifecyclePrestateV3(c, activate), { code: "reward_lifecycle_state_mismatch" });
      const last = attempts.at(-1);
      const recovered = await readVerifiedRewardProgrammeLifecycleV3(c, last.p, last.serialized);
      assert.equal(recovered.transactionHash, active.transactionHash); assert.equal(recovered.accountingAtReceiptBlock.paused, false);
      if (payment) {
        assert.equal((await payment.observe()).payment.transactionHash, payment.result.payment.transactionHash);
        if (slot === 5) {
          await chain.testClient.increaseTime({ seconds: 86401 }); await finalize();
          assert.equal((await payment.observe()).payment.transactionHash, payment.result.payment.transactionHash, "later signature expiry cannot erase paid history");
        }
      }
    });
    // Good baseline first: adversarial receipt tests must not pass merely because
    // the provider lacks historical state. Injected faults apply after provenance.
    const attempt = attempts.at(-1), observe = reader => readVerifiedRewardProgrammeLifecycleV3(reader, attempt.p, attempt.serialized);
    await observe(c);
    for (const operation of ["readContract", "getBalance"]) {
      await assert.rejects(observe({ ...c, [operation]: async args => {
        if (args.blockNumber === attempt.proof.blockNumber) throw new Error("private-rpc-credential");
        return c[operation](args);
      } }), error => error.code === "reward_lifecycle_observation_unavailable" && !JSON.stringify(error).includes("private-rpc-credential"));
    }
    assert.equal(attempts.length, 12);
  } finally { await chain.stop(); }
});
