import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { decodeEventLog, encodeDeployData, encodeFunctionData, getAddress, getContractAddress, hashTypedData, parseEther, toHex } from "viem";
import { startOwnedRewardChain, fixtureSigner } from "./owned-chain.mjs";
import { deployOriginalClubSafeFixture } from "./safe-deployment-fixture.mjs";
import { rewardCampaignV3Abi as childAbi, rewardAllocationCommitmentV3, rewardClaimMessagesV3, encodeRewardClaimV3 } from "../dist/campaign-v3.js";
import { requireRewardBuildArtifactV3, verifyRewardRuntimeV3 } from "../dist/deployment-v3.js";
import { readVerifiedRewardClubSafeDeployment } from "../dist/index.js";
import { rewardProgrammeV3Abi, readVerifiedRewardProgrammeV3, normalizeRewardProgrammeV3 } from "../dist/programme-v3.js";
import { createDefaultRewardProgrammeDraftV2 } from "../../domain/dist/rewards/programme-draft-v2.js";
import { decodeProgrammeFundingV3 } from "../../domain/dist/rewards/programme-funding-v3.js";
import { readProgrammeFundingViewV3, programmeFundingRulesDigestV3 } from "../../../apps/api/dist/features/rewards/programme-funding-v3-service.js";

// Fresh owned loopback Monad-mode Anvil only. Synthetic identities, reviewed-time
// fixtures and minted local balances are not real results, wallets or testnet MON.
const funder = fixtureSigner(0xBEEF44), athlete = fixtureSigner(0xBEEF45);
const h = n => toHex(BigInt(n), { size: 32 });
const budget = parseEther("100000"), cap = slot => slot === 5 ? budget / 2n : budget / 10n;
const artifact = JSON.parse(readFileSync(new URL("../../../contracts/out/RacesOnRewardProgrammeV3.sol/RacesOnRewardProgrammeV3.json", import.meta.url)));
const childArtifact = JSON.parse(readFileSync(new URL("../../../contracts/out/RacesOnRewardCampaignV3.sol/RacesOnRewardCampaignV3.json", import.meta.url)));
const abi = artifact.abi;

test("V3 programme: one deposit address, exact 50/50 split, four-round and finale waves, protected refunds", { timeout: 60000 }, async t => {
  const chain = await startOwnedRewardChain();
  try {
    const c = chain.publicClient;
    const receipt = async pending => {
      const r = await c.waitForTransactionReceipt({ hash: await pending, timeout: 10000 });
      assert.equal(r.status, "success");
      await chain.testClient.mine({ blocks: 96, interval: 1 });
      assert.equal((await c.getBlock({ blockNumber: r.blockNumber })).hash, r.blockHash);
      assert.ok((await c.getBlock({ blockTag: "finalized" })).number >= r.blockNumber);
      return r;
    };
    const read = (address, selectedAbi, functionName, args = []) => c.readContract({ address, abi: selectedAbi, functionName, args });
    const childRead = (f, name, args) => read(f.context.verifyingContract, childAbi, name, args);
    const childWrite = (f, name, args = [], options = {}) => receipt(chain.operatorClient.writeContract({ address: f.context.verifyingContract,
      abi: childAbi, functionName: name, args, ...options }));
    let address, deployment, gasLimit, spec, children = [];
    const id = n => `86000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
    const draft = { draftId: id(1), organizationId: id(2), seasonId: id(3), chainId: 31337, organizationName: "Synthetic programme observer",
      seasonName: "Synthetic league", revision: 1, updatedAt: "2026-09-09T12:00:00Z", rules: createDefaultRewardProgrammeDraftV2() };
    const observe = reader => readVerifiedRewardProgrammeV3(reader ?? c, spec);
    const binding = () => ({ draftId: draft.draftId, rulesRevision: draft.revision, rulesDigest: programmeFundingRulesDigestV3(draft), approvedExpectation: spec, reader: c });
    const view = () => readProgrammeFundingViewV3(draft, async () => binding());
    const parentRead = (name, args) => read(address, abi, name, args);
    const parentWrite = (name, args = [], options = {}) => receipt(chain.operatorClient.writeContract({ address, abi, functionName: name, args, ...options }));
    // Monad charges the submitted gas limit, not execution gas used. Anvil's
    // receipt still reports execution usage; reconcile actual balances correctly.
    const fee = async r => (await c.getTransaction({ hash: r.transactionHash })).gas * r.effectiveGasPrice;
    let depositedFees = 0n, refundFees = 0n;
    const safe = await deployOriginalClubSafeFixture(chain);
    await chain.testClient.mine({ blocks: 96, interval: 1 });
    await readVerifiedRewardClubSafeDeployment(c, safe.provenance);
    await chain.testClient.setBalance({ address: funder.address, value: budget * 2n });

    await t.test("actual factory CREATE fits 30M gas and binds six exact unchanged V3 children", async () => {
      requireRewardBuildArtifactV3(childArtifact);
      const args = [funder.address, chain.operator.address, h(1000), h(1001), budget,
        [0, 1, 2, 3, 4, 5].map(n => h(2000 + n)), [86400n, 86400n, 86400n, 86400n, 86400n, 86400n]];
      const data = encodeDeployData({ abi, bytecode: artifact.bytecode.object, args });
      assert.ok((data.length - 2) / 2 <= 49152); // Also fits Ethereum's stricter initcode ceiling.
      const estimate = await c.estimateGas({ account: chain.operator.address, data });
      gasLimit = (estimate * 120n + 99n) / 100n;
      assert.ok(gasLimit <= 30_000_000n, "Six-child constructor exceeds Monad's documented transaction ceiling");
      const nonce = await c.getTransactionCount({ address: chain.operator.address });
      deployment = await receipt(chain.operatorClient.sendTransaction({ data, gas: gasLimit }));
      address = getAddress(deployment.contractAddress);
      assert.equal(address, getContractAddress({ from: chain.operator.address, nonce: BigInt(nonce) }));
      spec = { context: { environment: "local-simulation", chainId: 31337, verifyingContract: address }, funderAddress: funder.address,
        operatorAddress: chain.operator.address, programmeId: h(1000), programmeManifestHash: h(1001), budgetWei: budget,
        campaignIds: args[5], reviewPeriods: args[6], deploymentTransactionHash: deployment.transactionHash, deploymentNonce: BigInt(nonce) };
      assert.equal((await c.getTransaction({ hash: deployment.transactionHash })).input, data);
      const events = deployment.logs.filter(l => getAddress(l.address) === address).map(l => decodeEventLog({ abi, ...l }));
      assert.equal(events.length, 6);
      for (let slot = 0; slot < 6; slot++) {
        const childAddress = getAddress(await parentRead("campaigns", [BigInt(slot)]));
        assert.equal(childAddress, getContractAddress({ from: address, nonce: BigInt(slot + 1) }));
        assert.equal(events[slot].eventName, "CampaignCreated");
        assert.deepEqual(events[slot].args, { slot, campaign: childAddress, campaignId: h(2000 + slot), cap: cap(slot), review: 86400n });
        const f = { context: { environment: "local-simulation", chainId: 31337, verifyingContract: childAddress },
          operatorAddress: chain.operator.address, treasuryAddress: address, programmeId: h(1000), campaignId: h(2000 + slot),
          programmeManifestHash: h(1001), enabledPot: slot === 5 ? 1 : 0, reviewPeriod: 86400n };
        verifyRewardRuntimeV3(f, await c.getCode({ address: childAddress, blockNumber: deployment.blockNumber }));
        children.push(f);
        assert.equal(await childRead(f, "accountedFunding"), 0n);
      }
      assert.equal(new Set(children.map(f => f.context.verifyingContract)).size, 6);
      t.diagnostic(JSON.stringify({ environment: "owned-local-monad-simulation", creationBytes: (data.length - 2) / 2,
        runtimeBytes: (artifact.deployedBytecode.object.length - 2) / 2, gasEstimate: String(estimate),
        gasLimit: String(gasLimit), receiptGasUsed: String(deployment.gasUsed), transactionCeiling: "30000000" }));
    });

    await t.test("shared programme verifier and minimal UI projection bind factory provenance, every child and one finalized block", async () => {
      for (const item of rewardProgrammeV3Abi) {
        const compiled = abi.find(v => v.type === item.type && v.name === item.name);
        assert.ok(compiled);
        const shape = p => ({ type: p.type, indexed: p.indexed ?? false });
        assert.deepEqual(item.inputs?.map(shape), compiled.inputs?.map(shape));
        assert.deepEqual(item.outputs?.map(shape), compiled.outputs?.map(shape));
      }
      const blocks = [];
      const found = await observe({ ...c, readContract: async a => { blocks.push(a.blockNumber); return c.readContract(a); },
        getBalance: async a => { blocks.push(a.blockNumber); return c.getBalance(a); }, getCode: async a => { blocks.push(a.blockNumber); return c.getCode(a); } });
      assert.equal(found.depositedWei, 0n); assert.equal(found.pots.length, 6);
      assert.ok(blocks.length > 80 && blocks.every(n => n === found.finalizedBlock.number));
      const ui = await view();
      assert.deepEqual(decodeProgrammeFundingV3(ui, draft), ui);
      assert.equal(ui.status, "verified"); assert.equal(ui.operationsEnabled, false);
      assert.equal(ui.observation.depositedWei, "0");
      assert.equal(ui.observation.address, address);
      assert.equal((await readProgrammeFundingViewV3(draft)).observation, null);
      assert.equal((await readProgrammeFundingViewV3(draft)).status, "awaiting_deployment");
    });

    await t.test("programme inspection rejects changed constructor, receipt, runtime, child, conservation, finality and registry scope", async () => {
      for (const patch of [{ context: { ...spec.context, chainId: 143 } }, { campaignIds: spec.campaignIds.slice(1) },
        { reviewPeriods: [2592001n, ...spec.reviewPeriods.slice(1)] }, { budgetWei: budget + 1n }]) assert.throws(() => normalizeRewardProgrammeV3({ ...spec, ...patch }));
      for (const patch of [{ funderAddress: athlete.address }, { programmeManifestHash: h(99) }, { budgetWei: budget * 2n }])
        await assert.rejects(readVerifiedRewardProgrammeV3(c, { ...spec, ...patch }));
      for (const alter of [r => { r.status = "reverted"; }, r => { r.logs.reverse(); }, r => { r.logs[0].removed = true; },
        r => { r.logs[1].address = athlete.address; }, r => { r.blockHash = h(98); }]) {
        await assert.rejects(observe({ ...c, getTransactionReceipt: async a => { const r = structuredClone(await c.getTransactionReceipt(a)); alter(r); return r; } }));
      }
      await assert.rejects(observe({ ...c, getCode: async a => a.address === address ? "0x00" : c.getCode(a) }));
      await assert.rejects(observe({ ...c, readContract: async a => a.functionName === "totalRouted" ? 1n : c.readContract(a) }));
      await assert.rejects(observe({ ...c, readContract: async a => a.functionName === "campaigns" ? athlete.address : c.readContract(a) }));
      let calls = 0;
      await assert.rejects(observe({ ...c, getChainId: async () => ++calls === 1 ? 31337 : 10143 }));
      await assert.rejects(observe({ ...c, getBlock: async a => { const b = await c.getBlock(a); return a.blockTag === "finalized" ? { ...b, number: deployment.blockNumber - 1n } : b; } }));
      await assert.rejects(observe({ ...c, getBalance: async () => { throw new Error("synthetic private provider details"); } }),
        e => e.message === "reward_programme_observation_unavailable" && !e.cause);
      await assert.rejects(readProgrammeFundingViewV3(draft, async () => ({ ...binding(), rulesRevision: 99 })));
      const mutable = structuredClone(spec), original = structuredClone(spec);
      const checked = await readVerifiedRewardProgrammeV3({ ...c, getChainId: async () => { mutable.funderAddress = athlete.address; mutable.campaignIds[0] = h(999); return c.getChainId(); } }, mutable);
      assert.equal(checked.funderAddress, original.funderAddress);
      for (const change of [v => { v.secret = "not allowed"; }, v => { v.rulesRevision++; }, v => { v.chainId = 10143; },
        v => { v.observation.depositedWei = "1"; }, v => { v.observation.pots[0].paidWei = "1"; }, v => { v.observation.pots.reverse(); }]) {
        const dto = await view(); change(dto); assert.throws(() => decodeProgrammeFundingV3(dto, draft));
      }
    });

    await t.test("partial deposit funds only four selected historical pots; duplicate and excess intents fail", async () => {
      const r = await parentWrite("deposit", [0n], { account: funder, value: budget / 2n });
      depositedFees += await fee(r);
      await assert.rejects(c.call({ account: funder.address, to: address, value: budget / 2n,
        data: encodeFunctionData({ abi, functionName: "deposit", args: [0n] }) }));
      await assert.rejects(c.call({ account: funder.address, to: address, value: 1n, data: "0x" }));
      for (let slot = 0; slot < 4; slot++) await parentWrite("routePot", [slot]);
      assert.equal(await parentRead("pendingFunding"), cap(0));
      assert.equal(await childRead(children[4], "accountedFunding"), 0n);
      assert.equal(await childRead(children[5], "accountedFunding"), 0n);
      const checkpoint = await view();
      assert.equal(checkpoint.observation.depositedWei, (budget / 2n).toString());
      assert.deepEqual(checkpoint.observation.pots.map(p => p.routed), [true, true, true, true, false, false]);
      await assert.rejects(c.call({ account: chain.operator.address, to: address,
        data: encodeFunctionData({ abi, functionName: "routePot", args: [0] }) }));
      await assert.rejects(c.call({ account: chain.operator.address, to: address,
        data: encodeFunctionData({ abi, functionName: "routePot", args: [5] }) }));
    });

    async function approveAndActivate(slot) {
      const f = children[slot];
      await childWrite(f, "completeFunding", [cap(slot), cap(slot)]);
      const now = (await c.getBlock()).timestamp;
      f.upload = rewardAllocationCommitmentV3({ ...f, budget: cap(slot), snapshotDigest: h(3000 + slot),
        reviewStartedAt: now - 86400n, officialPublishedAt: now, publicationEvidenceHash: h(4000 + slot), awards: [
          { entitlementId: h(1), beneficiaryId: h(11), pot: f.enabledPot, amount: cap(slot) / 100n, explanationHash: h(21), beneficiaryKind: 0 },
          { entitlementId: h(2), beneficiaryId: h(12), pot: f.enabledPot, amount: cap(slot) * 79n / 100n, explanationHash: h(22), beneficiaryKind: 0 },
          { entitlementId: h(3), beneficiaryId: h(13), pot: f.enabledPot, amount: cap(slot) / 10n, explanationHash: h(23), beneficiaryKind: 1 },
        ] });
      await childWrite(f, "uploadAwards", [f.upload.awards]);
      const u = f.upload;
      await childWrite(f, "stageAllocation", [u.snapshotDigest, u.uploadDigest, u.entitlementCount, u.reviewStartedAt, u.officialPublishedAt, u.publicationEvidenceHash]);
      assert.equal(await childRead(f, "allocationDigest"), u.allocationDigest);
      await childWrite(f, "activate", [u.allocationDigest, u.snapshotDigest]);
      assert.equal(await childRead(f, "state"), 3);
    }
    const claimFor = async (slot, id, recipient) => {
      const f = children[slot], award = f.upload.awards[id - 1], now = (await c.getBlock()).timestamp;
      return { entitlementId: award.entitlementId, recipient, amount: award.amount, pot: slot === 5 ? "league" : "race",
        nonce: 0n, issuedAt: now, expiresAt: now + 3600n, allocationDigest: f.upload.allocationDigest };
    };
    let previousData;
    async function payAthlete(slot) {
      const f = children[slot], claim = await claimFor(slot, 1, athlete.address);
      const messages = rewardClaimMessagesV3(f.context, claim);
      const data = encodeRewardClaimV3(f.context, claim, { operator: await chain.operator.signTypedData(messages.authorization),
        recipient: await athlete.signTypedData(messages.consent) });
      await receipt(chain.relayerClient.sendTransaction({ to: f.context.verifyingContract, data }));
      await assert.rejects(c.call({ account: chain.relayer.address, to: f.context.verifyingContract, data }));
      previousData = data;
    }
    async function payClub(slot) {
      const f = children[slot], claim = await claimFor(slot, 3, safe.expected.context.verifyingContract);
      const messages = rewardClaimMessagesV3(f.context, claim);
      // Safe EIP-1271 wraps the exact V3 recipient digest in its own SafeMessage.
      const message = { domain: { chainId: 31337, verifyingContract: claim.recipient }, primaryType: "SafeMessage",
        types: { SafeMessage: [{ name: "message", type: "bytes" }] }, message: { message: hashTypedData(messages.consent) } };
      const owners = chain.clubOwners.slice(0, 2).sort((a, b) => a.address.toLowerCase().localeCompare(b.address.toLowerCase()));
      const proofs = await Promise.all(owners.map(o => o.signTypedData(message)));
      const operatorProof = await chain.operator.signTypedData(messages.authorization);
      const bad = encodeRewardClaimV3(f.context, claim, { operator: operatorProof, recipient: proofs[0] });
      await assert.rejects(c.call({ account: chain.relayer.address, to: f.context.verifyingContract, data: bad }));
      const data = encodeRewardClaimV3(f.context, claim, { operator: operatorProof, recipient: `0x${proofs.map(p => p.slice(2)).join("")}` });
      await receipt(chain.relayerClient.sendTransaction({ to: f.context.verifyingContract, data }));
      await assert.rejects(c.call({ account: chain.relayer.address, to: f.context.verifyingContract, data }));
    }

    await t.test("four historical child allocations pay the same consenting synthetic adult once each", async () => {
      for (let slot = 0; slot < 4; slot++) { await approveAndActivate(slot); await payAthlete(slot); }
      assert.equal(await c.getBalance({ address: athlete.address }), parseEther("400"));
      for (const f of children.slice(4)) assert.equal(await childRead(f, "state"), 0);
      await payClub(0);
    });

    await t.test("remaining funding goes to round five and league; historical proofs cannot replay", async () => {
      const r = await parentWrite("deposit", [budget / 2n], { account: funder, value: budget / 2n });
      depositedFees += await fee(r);
      for (const slot of [4, 5]) await parentWrite("routePot", [slot]);
      assert.equal(await parentRead("totalRouted"), budget);
      assert.equal(await parentRead("pendingFunding"), 0n);
      assert.equal(await c.getBalance({ address }), 0n);
      await assert.rejects(c.call({ account: funder.address, to: address, value: 1n,
        data: encodeFunctionData({ abi, functionName: "deposit", args: [budget] }) }));
      for (const slot of [4, 5]) {
        await approveAndActivate(slot);
        await assert.rejects(c.call({ account: chain.relayer.address, to: children[slot].context.verifyingContract, data: previousData }));
        await payAthlete(slot);
      }
      await payClub(5);
      assert.equal((await observe()).pots.reduce((sum, p) => sum + p.paidWei, 0n), parseEther("7000"));
      assert.equal(await c.getBalance({ address: athlete.address }), parseEther("1000"));
      assert.equal(await c.getBalance({ address: safe.expected.context.verifyingContract }), parseEther("6000"));
    });

    await t.test("funding abort cannot touch active awards, walletless shares or club reserves", async () => {
      const r = await parentWrite("abortFunding", [], { account: funder });
      refundFees += await fee(r);
      await assert.rejects(c.call({ account: funder.address, to: address, data: encodeFunctionData({ abi, functionName: "withdrawSurplus" }) }));
      for (const f of children) {
        const held = await childRead(f, "entitlements", [h(2)]);
        assert.equal(held[6], false);
        assert.equal(held[4], "0x0000000000000000000000000000000000000000");
        assert.equal(await childRead(f, "state"), 3);
        await assert.rejects(c.call({ account: chain.operator.address, to: f.context.verifyingContract,
          data: encodeFunctionData({ abi: childAbi, functionName: "returnToTreasury" }) }));
      }
      assert.equal(await parentRead("returned"), 0n);
    });

    await t.test("expiry returns only the 93000 unpaid MON to fixed funder, without reopening pots", async () => {
      const deadlines = await Promise.all(children.map(f => childRead(f, "claimDeadline")));
      const deadline = deadlines.reduce((a, b) => a > b ? a : b);
      await chain.testClient.setNextBlockTimestamp({ timestamp: deadline });
      await chain.testClient.mine({ blocks: 1 });
      for (const f of children) { await childWrite(f, "close"); await childWrite(f, "returnToTreasury"); }
      const unpaid = parseEther("93000");
      assert.equal(await parentRead("pendingReturns"), unpaid);
      assert.equal(await parentRead("pendingFunding"), 0n);
      assert.equal(await parentRead("totalRouted"), budget);
      const r = await parentWrite("withdrawReturns", [unpaid], { account: funder });
      refundFees += await fee(r);
      assert.equal(await c.getBalance({ address: funder.address }), budget * 2n - parseEther("7000") - depositedFees - refundFees);
      assert.equal(await c.getBalance({ address }), 0n);
      assert.equal((await view()).observation.pendingReturnsWei, "0");
      await assert.rejects(c.call({ account: funder.address, to: address, data: encodeFunctionData({ abi, functionName: "withdrawReturns", args: [unpaid] }) }));
      for (let slot = 0; slot < 6; slot++) assert.equal(await parentRead("routed", [BigInt(slot)]), true);
    });
  } finally { await chain.stop(); }
});
