import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { encodeFunctionData, keccak256 } from "viem";
import { programmeDeploymentFixtureV3, programmeTestId as id } from "../../../apps/api/test/fixtures/programme-deployment-v3.mjs";
import { decodeProgrammeDeploymentV3 } from "../../db/dist/rewards/index.js";
import { programmeDeploymentPlanV3 } from "../../../apps/api/dist/features/rewards/programme-deployment-v3-service.js";
import { encodeRewardProgrammeDeploymentV3, readVerifiedRewardProgrammeV3, rewardProgrammeV3Abi } from "../dist/programme-v3.js";
import { startProgrammeLocalChain } from "../../../demo/rewards/scripts/programme-local-chain.mjs";

// Actual owned runtime + exact contract + signed deposit. The private review
// callback is a synthetic fixture; real Auth/SQL acceptance is a separate check.
test("wallet-session clock finalizes a real local deposit without manual mining and stops on close", { timeout: 130000 }, async () => {
  const directory = mkdtempSync("/private/tmp/raceson-programme-chain-");
  let runtime, connection;
  try {
    runtime = await startProgrammeLocalChain({ directory, readPort: 0 });
    const c = runtime.reader, mon = 10n ** 18n;
    const context = programmeDeploymentFixtureV3(runtime.operator.address, runtime.funder.address);
    context.intent.nonce = "0";
    const plan = programmeDeploymentPlanV3(decodeProgrammeDeploymentV3(context));
    const artifact = JSON.parse(readFileSync(new URL("../../../contracts/out/RacesOnRewardProgrammeV3.sol/RacesOnRewardProgrammeV3.json", import.meta.url)));
    await runtime.test.setBalance({ address: runtime.operator.address, value: 500n * mon });
    await runtime.test.setBalance({ address: runtime.funder.address, value: 2n * mon });
    const deployment = await runtime.operatorWallet.sendTransaction({ data: encodeRewardProgrammeDeploymentV3(plan, artifact.bytecode.object), gas: 30000000n });
    await c.waitForTransactionReceipt({ hash: deployment });
    // Only pre-wallet fixture setup mines a batch. No explicit mine after send.
    await runtime.test.mine({ blocks: 96, interval: 1 });
    const expected = { ...plan, deploymentTransactionHash: deployment };
    assert.equal((await readVerifiedRewardProgrammeV3(c, expected)).depositedWei, 0n);
    const binding = { chainId: 31337, draftId: id(1), address: plan.context.verifyingContract.toLowerCase(),
      funderAddress: runtime.funder.address.toLowerCase(), budgetWei: plan.budgetWei.toString() };
    let alive = true;
    connection = await runtime.openWalletRpc({ binding, alive: () => alive, access: async () => binding, review: async amount => {
      assert.equal(amount, "1");
      return { status: "ready", quote: { schema: "raceson-programme-deposit-v3", ...binding, rulesRevision: 1, approvalId: id(20),
        contextHash: "a".repeat(64), policyHash: `0x${"b".repeat(64)}`, expectedDepositedWei: "0", amountWei: mon.toString(), expiresAt: new Date(Date.now() + 120000).toISOString() } };
    } });
    assert.equal(connection.blockIntervalSeconds, 1);
    const signed = await runtime.funder.signTransaction({ type: "eip1559", chainId: 31337, nonce: 0, to: binding.address, value: mon,
      gas: 300000n, maxFeePerGas: 100000000000n, maxPriorityFeePerGas: 0n,
      data: encodeFunctionData({ abi: rewardProgrammeV3Abi, functionName: "deposit", args: [0n] }) });
    const response = await fetch(connection.url, { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1:3101" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_sendRawTransaction", params: [signed] }), signal: AbortSignal.timeout(15000) });
    const hash = (await response.json()).result; assert.equal(hash, keccak256(signed));
    const receipt = await c.waitForTransactionReceipt({ hash }); assert.equal(receipt.status, "success");
    assert.ok((await c.getBlock({ blockTag: "finalized" })).number < receipt.blockNumber);
    const started = Date.now(); let finalized;
    do {
      assert.ok(Date.now() - started < 105000, "owned wallet clock did not reach finality");
      await delay(1000); finalized = await c.getBlock({ blockTag: "finalized" });
    } while (finalized.number < receipt.blockNumber);
    const funded = await readVerifiedRewardProgrammeV3(c, expected);
    assert.equal(funded.depositedWei, mon); assert.equal(funded.totalRoutedWei, 0n); assert.ok(funded.pots.every(p => p.paidWei === 0n));
    console.log(JSON.stringify({ kind: "owned-local-wallet-finality", depositedMon: "1", paidMon: "0", elapsedSeconds: Math.round((Date.now() - started) / 1000), manualPostDepositMining: false }));
    // Closing permits at most an already-released block request to finish.
    alive = false;
    await delay(1500);
    await assert.rejects(fetch(connection.url, { signal: AbortSignal.timeout(1000) }));
    const last = await c.getBlockNumber({ cacheTime: 0 }); await delay(1500);
    assert.equal(await c.getBlockNumber({ cacheTime: 0 }), last);
    const proxy = await fetch(runtime.readUrl, { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "eth_chainId", params: [] }) });
    assert.equal((await proxy.json()).result, "0x7a69");
  } finally { connection?.stop(); await runtime?.stop(); rmSync(directory, { recursive: true }); }
});
