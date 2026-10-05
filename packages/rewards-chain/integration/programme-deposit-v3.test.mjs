import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { encodeFunctionData, createWalletClient, custom, TransactionNotFoundError } from "viem";
import { startOwnedRewardChain, fixtureSigner } from "./owned-chain.mjs";
import { programmeDeploymentFixtureV3, programmeTestId as id } from "../../../apps/api/test/fixtures/programme-deployment-v3.mjs";
import { decodeProgrammeDeploymentV3 } from "../../db/dist/rewards/index.js";
import { programmeDeploymentPlanV3 } from "../../../apps/api/dist/features/rewards/programme-deployment-v3-service.js";
import { prepareProgrammeDepositQuoteV3, inspectProgrammeDepositV3 } from "../../../apps/api/dist/features/rewards/programme-deposit-v3-service.js";
import { dispatchRewardPlanningRoutes } from "../../../apps/api/dist/routes/rewards/planning.js";
import { encodeRewardProgrammeDeploymentV3, readVerifiedRewardProgrammeV3, rewardProgrammeV3Abi } from "../dist/programme-v3.js";

test("deposit review -> actual owned-chain funding -> finalized exact receipt, with private registry/policy transport fixtures", { timeout: 120000 }, async t => {
  const chain = await startOwnedRewardChain();
  try {
    const c = chain.publicClient, funder = fixtureSigner(0x777), context = programmeDeploymentFixtureV3(chain.operator.address, funder.address);
    context.intent.nonce = "0";
    const plan = programmeDeploymentPlanV3(decodeProgrammeDeploymentV3(context));
    const artifact = JSON.parse(readFileSync(new URL("../../../contracts/out/RacesOnRewardProgrammeV3.sol/RacesOnRewardProgrammeV3.json", import.meta.url)));
    const deployment = await chain.operatorClient.sendTransaction({ data: encodeRewardProgrammeDeploymentV3(plan, artifact.bytecode.object), gas: 30000000n });
    await c.waitForTransactionReceipt({ hash: deployment }); await chain.testClient.mine({ blocks: 96, interval: 1 });
    const observed = await readVerifiedRewardProgrammeV3(c, { ...plan, deploymentTransactionHash: deployment });
    const raw = { schema: "raceson-programme-registry-v3", context, registry: { jobId: id(90), intentId: id(81), attemptId: id(91), recordedAt: "2026-09-10T00:03:00Z",
      provenance: { schemaVersion: 3, chainId: 31337, contractAddress: plan.context.verifyingContract.toLowerCase(), transactionHash: deployment,
        deploymentBlockNumber: String(observed.deploymentBlockNumber), deploymentBlockHash: observed.deploymentBlockHash,
        finalizedBlockNumber: String(observed.finalizedBlock.number), finalizedBlockHash: observed.finalizedBlock.hash, finalizedBlockTimestamp: String(observed.finalizedBlock.timestamp),
        runtimeCodeHash: observed.runtimeCodeHash, programmeId: plan.programmeId, programmeManifestHash: plan.programmeManifestHash } } };
    const policy = categoryId => ({ schema: "raceson-result-review-v3", categoryId, organizationId: id(2), observedAt: "2026-09-10T00:03:00Z", state: "awaiting_provisional",
      revision: 1, reviewSeconds: 86400, policyId: id(95), configuredAt: "2026-09-10T00:00:00Z", locked: false, held: false,
      startedAt: null, startedByPublicationId: null, endsAt: null, latestPublicationId: null, finalPublicationId: null, officialPublishedAt: null, allocationApproved: false });
    let revoked = false, mutatePolicy = v => v;
    const calls = [], actor = { userId: id(4), sessionId: id(5) }, scope = { chainId: 31337, draftId: id(1) };
    const rpc = async (name, args) => {
      calls.push(name); assert.equal(args.p_actor_user_id, actor.userId); assert.equal(args.p_actor_session_id, actor.sessionId);
      if (revoked) return { data: null, error: { message: "reward_account_session_required" } };
      if (name === "service_read_reward_programme_registry_v3") return { data: structuredClone(raw), error: null };
      assert.equal(name, "service_read_reward_result_review_v3"); return { data: mutatePolicy(policy(args.p_category_id)), error: null };
    };
    let quote;
    await t.test("review binds nominated funder, pinned contract, cap, revision, current policies and exact amount", async () => {
      const r = await prepareProgrammeDepositQuoteV3(actor, scope, "1", { reader: c, rpc }); assert.equal(r.status, "ready"); quote = r.quote;
      assert.equal(quote.address, plan.context.verifyingContract.toLowerCase()); assert.equal(quote.funderAddress, funder.address.toLowerCase());
      assert.equal(quote.amountWei, "1000000000000000000"); assert.equal(quote.expectedDepositedWei, "0");
      assert.equal(calls.filter(n => n === "service_read_reward_result_review_v3").length, 10);
      assert.ok(Date.parse(quote.expiresAt) > Date.now());
    });
    await t.test("missing/held or changed announced policy and revoked access block a fresh deposit review", async () => {
      mutatePolicy = p => ({ ...p, reviewSeconds: 0 });
      assert.deepEqual(await prepareProgrammeDepositQuoteV3(actor, scope, "1", { reader: c, rpc }), { status: "blocked", reason: "policy_required" });
      let n = 0; mutatePolicy = p => ({ ...p, revision: ++n > 5 ? 2 : 1 });
      await assert.rejects(prepareProgrammeDepositQuoteV3(actor, scope, "1", { reader: c, rpc }));
      mutatePolicy = p => { if (p.categoryId === id(34)) revoked = true; return p; };
      await assert.rejects(prepareProgrammeDepositQuoteV3(actor, scope, "1", { reader: c, rpc }), { code: "reward_account_session_required" });
      revoked = false; mutatePolicy = p => p;
      await assert.rejects(prepareProgrammeDepositQuoteV3(actor, scope, "100001", { reader: c, rpc }));
    });
    // Reuse the owned client's request, never an external endpoint or key source.
    const wallet = createWalletClient({ account: funder, chain: c.chain, transport: custom({ request: c.request }, { retryCount: 0 }) });
    await chain.testClient.setBalance({ address: funder.address, value: 100002n * 10n ** 18n });
    let deposit;
    await t.test("one real deposit remains pending until finality then confirms exact accounting with zero payouts", async () => {
      deposit = await wallet.sendTransaction({ to: plan.context.verifyingContract, value: BigInt(quote.amountWei), gas: 300000n,
        data: encodeFunctionData({ abi: rewardProgrammeV3Abi, functionName: "deposit", args: [0n] }) });
      await c.waitForTransactionReceipt({ hash: deposit });
      assert.equal((await inspectProgrammeDepositV3(actor, quote, deposit, { reader: c, rpc })).status, "pending");
      await chain.testClient.mine({ blocks: 96, interval: 1 });
      assert.deepEqual(await inspectProgrammeDepositV3(actor, quote, deposit, { reader: c, rpc }), { status: "confirmed", transactionHash: deposit });
      const now = await readVerifiedRewardProgrammeV3(c, { ...plan, deploymentTransactionHash: deployment });
      assert.equal(now.depositedWei, 10n ** 18n); assert.ok(now.pots.every(p => p.paidWei === 0n));
    });
    await t.test("hash alone, forged fields/events, RPC failure and revoked access do not confirm a deposit", async () => {
      for (const patch of [{ amountWei: "2" }, { expectedDepositedWei: "1" }, { funderAddress: chain.operator.address.toLowerCase() }, { address: funder.address.toLowerCase() }])
        await assert.rejects(inspectProgrammeDepositV3(actor, { ...quote, ...patch }, deposit, { reader: c, rpc }));
      await assert.rejects(inspectProgrammeDepositV3(actor, quote, deployment, { reader: c, rpc }));
      const originalAnchor = raw.registry.provenance.finalizedBlockHash;
      raw.registry.provenance.finalizedBlockHash = `0x${"f".repeat(64)}`;
      try { await assert.rejects(inspectProgrammeDepositV3(actor, quote, deposit, { reader: c, rpc })); }
      finally { raw.registry.provenance.finalizedBlockHash = originalAnchor; }
      const fake = { ...c, getTransactionReceipt: async input => {
        const receipt = await c.getTransactionReceipt(input); if (input.hash !== deposit) return receipt;
        return { ...receipt, logs: receipt.logs.map(l => ({ ...l, removed: true })) };
      } };
      await assert.rejects(inspectProgrammeDepositV3(actor, quote, deposit, { reader: fake, rpc }));
      const pending = { ...c, getTransaction: async input => { if (input.hash === deposit) throw new TransactionNotFoundError({ hash: deposit }); return c.getTransaction(input); } };
      assert.equal((await inspectProgrammeDepositV3(actor, quote, deposit, { reader: pending, rpc })).status, "pending");
      const unavailable = { ...c, getTransaction: async input => { if (input.hash === deposit) throw Error("provider unavailable"); return c.getTransaction(input); } };
      await assert.rejects(inspectProgrammeDepositV3(actor, quote, deposit, { reader: unavailable, rpc }));
      const original = c.getTransaction; const revokedReader = { ...c, getTransaction: async input => { const result = await original(input); if (input.hash === deposit) revoked = true; return result; } };
      await assert.rejects(inspectProgrammeDepositV3(actor, quote, deposit, { reader: revokedReader, rpc }), { code: "reward_account_session_required" }); revoked = false;
    });
    await t.test("source holds do not erase a historical deposit; a stale duplicate really reverts", async () => {
      const originalHash = context.approvalView.contextHash;
      context.approvalView.contextHash = "d".repeat(64); context.intent.current = false; context.approvalView.approval.current = false;
      try {
        assert.equal((await inspectProgrammeDepositV3(actor, { ...quote, expiresAt: "2020-01-01T00:00:00Z" }, deposit, { reader: c, rpc })).status, "confirmed");
      } finally { context.approvalView.contextHash = originalHash; context.intent.current = true; context.approvalView.approval.current = true; }
      const duplicate = await wallet.sendTransaction({ to: plan.context.verifyingContract, value: BigInt(quote.amountWei), gas: 300000n,
        data: encodeFunctionData({ abi: rewardProgrammeV3Abi, functionName: "deposit", args: [0n] }) });
      const receipt = await c.waitForTransactionReceipt({ hash: duplicate }); assert.equal(receipt.status, "reverted");
      await chain.testClient.mine({ blocks: 96, interval: 1 });
      assert.equal((await inspectProgrammeDepositV3(actor, quote, duplicate, { reader: c, rpc })).status, "reverted");
    });
    await t.test("demo POST route enforces auth/private headers/strict scope and never accepts arbitrary destinations", async () => {
      for (const mode of ["valid", "query", "extra", "unauthorized"]) {
        const response = {}; const result = await dispatchRewardPlanningRoutes({ method: "POST" }, response,
          new URL(`http://127.0.0.1:3101/api/v1/organizer/rewards/drafts/${scope.draftId}/deposit-status${mode === "query" ? "?chain=143" : ""}`), {
            config: () => ({ chainId: 31337, origin: "http://127.0.0.1:3101" }), requireIdentity: async () => { if (mode === "unauthorized") throw Error("Unauthorized"); return actor; },
            readJsonBody: async () => ({ quote, transactionHash: deposit, ...(mode === "extra" ? { to: funder.address } : {}) }),
            applyPrivateSessionHeaders: () => { response.private = true; }, sendSuccess: (_, data) => Object.assign(response, { status: 200, data }),
            sendError: (_, status, code) => Object.assign(response, { status, code }), rpc, programmeFundingReader: c,
          });
        assert.equal(result, true); assert.equal(response.private, true); assert.equal(response.status, mode === "valid" ? 200 : mode === "unauthorized" ? 401 : 400);
        if (mode === "valid") assert.equal(response.data.status, "confirmed");
      }
    });
  } finally { await chain.stop(); }
});
