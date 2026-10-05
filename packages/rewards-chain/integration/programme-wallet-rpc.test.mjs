import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, readdirSync, lstatSync, rmSync } from "node:fs";
import { join } from "node:path";
import { request as nativeRequest } from "node:http";
import { encodeFunctionData, keccak256 } from "viem";
import { startOwnedRewardChain, fixtureSigner } from "./owned-chain.mjs";
import { programmeDeploymentFixtureV3, programmeTestId as id } from "../../../apps/api/test/fixtures/programme-deployment-v3.mjs";
import { decodeProgrammeDeploymentV3 } from "../../db/dist/rewards/index.js";
import { programmeDeploymentPlanV3 } from "../../../apps/api/dist/features/rewards/programme-deployment-v3-service.js";
import { prepareProgrammeDepositQuoteV3, inspectProgrammeDepositV3 } from "../../../apps/api/dist/features/rewards/programme-deposit-v3-service.js";
import { encodeRewardProgrammeDeploymentV3, readVerifiedRewardProgrammeV3, rewardProgrammeV3Abi } from "../dist/programme-v3.js";
import { walletRpcBinding, validateWalletRpcRequest, verifyLocalWalletDeposit, startProgrammeWalletRpc } from "../../../demo/rewards/scripts/programme-wallet-rpc.mjs";

const mon = 10n ** 18n, funder = fixtureSigner(0x777);
const binding = { chainId: 31337, draftId: id(1), address: fixtureSigner(0x888).address.toLowerCase(), funderAddress: funder.address.toLowerCase(), budgetWei: (100000n * mon).toString() };
const data = expected => encodeFunctionData({ abi: rewardProgrammeV3Abi, functionName: "deposit", args: [expected] });
const request = (method, params = []) => ({ jsonrpc: "2.0", id: 1, method, params });
const call = (b = binding, expected = 0n) => ({ from: b.funderAddress, to: b.address, data: data(expected), value: "0xde0b6b3a7640000" });
const transaction = (b = binding, patch = {}) => ({ type: "eip1559", chainId: 31337, nonce: 0, to: b.address, value: mon,
  data: data(0n), gas: 300000n, maxFeePerGas: 100000000000n, maxPriorityFeePerGas: 0n, ...patch });

test("wallet RPC schema is exact, bounded, local-only and never grants node/signing control", async () => {
  assert.deepEqual(walletRpcBinding(binding), binding);
  for (const patch of [{ chainId: 143 }, { chainId: 10143 }, { budgetWei: "0" }, { budgetWei: (1n << 256n).toString() }, { rpc: "https://example.com" }])
    assert.throws(() => walletRpcBinding({ ...binding, ...patch }));
  for (const method of ["eth_sign", "eth_signTypedData_v4", "eth_sendTransaction", "personal_sign", "eth_call", "eth_getLogs", "anvil_setBalance", "evm_mine", "debug_traceTransaction", "anvil_reset"])
    assert.throws(() => validateWalletRpcRequest(request(method), binding));
  for (const r of [[request("eth_chainId")], { ...request("eth_chainId"), id: null }, { ...request("eth_chainId"), extra: true },
    request("eth_getBalance", [fixtureSigner(0x999).address, "latest"]), request("eth_getBlockByNumber", ["latest", true]),
    request("eth_feeHistory", ["0x15", "latest", []]), request("eth_feeHistory", ["0x1", "latest", [90, 10]]),
    request("eth_estimateGas", [call(), "latest", {}]), request("eth_estimateGas", [{ ...call(), to: binding.funderAddress }]),
    request("eth_estimateGas", [{ ...call(), data: "0x" }]), request("eth_estimateGas", [{ ...call(), chainId: "0x8f" }]),
    request("eth_estimateGas", [{ ...call(), gas: "0x7a121" }]), request("eth_estimateGas", [{ ...call(), accessList: [{}] }]),
    request("eth_sendRawTransaction", ["0x02" + "ff".repeat(1024)])]) assert.throws(() => validateWalletRpcRequest(r, binding));
  for (const r of [request("eth_chainId"), request("eth_getBalance", [binding.funderAddress, "pending"]), request("eth_estimateGas", [call()]),
    request("eth_feeHistory", ["0x4", "latest", [10, 50, 90]])]) assert.deepEqual(validateWalletRpcRequest(r, binding), r);
  const valid = await funder.signTransaction(transaction());
  assert.equal((await verifyLocalWalletDeposit(valid, binding)).transactionHash, keccak256(valid));
  for (const patch of [{ chainId: 143 }, { chainId: 10143 }, { to: binding.funderAddress }, { value: 0n }, { value: 100001n * mon },
    { gas: 500001n }, { maxFeePerGas: 100000000001n }, { data: "0x" }, { data: data(100000n * mon) },
    { accessList: [{ address: binding.address, storageKeys: [] }] }]) {
    const signed = await funder.signTransaction(transaction(binding, patch));
    await assert.rejects(verifyLocalWalletDeposit(signed, binding));
  }
  await assert.rejects(verifyLocalWalletDeposit(await fixtureSigner(0x999).signTransaction(transaction()), binding));
});

test("owned wallet RPC -> signed deposit -> exact finalized receipt and durable uncertain-send recovery", { timeout: 120000 }, async t => {
  const chain = await startOwnedRewardChain(), directory = mkdtempSync("/private/tmp/raceson-wallet-rpc-");
  let gateway;
  try {
    const c = chain.publicClient, context = programmeDeploymentFixtureV3(chain.operator.address, funder.address);
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
    let revoked = false, held = false, alive = true, phase = "normal", sends = 0, afterReview;
    const actor = { userId: id(4), sessionId: id(5) }, scope = { chainId: 31337, draftId: id(1) };
    const bound = { ...binding, address: plan.context.verifyingContract.toLowerCase() };
    const rpc = async (name, args) => {
      assert.equal(args.p_actor_user_id, actor.userId); assert.equal(args.p_actor_session_id, actor.sessionId);
      if (revoked) return { data: null, error: { message: "reward_account_session_required" } };
      if (name === "service_read_reward_programme_registry_v3") return { data: structuredClone(raw), error: null };
      assert.equal(name, "service_read_reward_result_review_v3"); return { data: { ...policy(args.p_category_id), held }, error: null };
    };
    const reader = { ...c, sendRawTransaction: async input => {
      sends++;
      if (phase === "before-send") throw Error("synthetic failure; do not expose provider diagnostics");
      const hash = await c.sendRawTransaction(input);
      if (phase === "after-send") throw Error("synthetic lost response");
      return hash;
    } };
    const access = async () => { assert.equal(revoked, false); return bound; };
    const review = async amountMon => {
      const r = await prepareProgrammeDepositQuoteV3(actor, scope, amountMon, { reader: c, rpc });
      await afterReview?.(); return r;
    };
    const start = () => startProgrammeWalletRpc({ client: reader, binding: bound, access, review, journalDirectory: directory, port: 0, alive: () => alive });
    gateway = await start();
    let counter = 0;
    const http = async (method, params = [], headers = {}, options = {}) => {
      const response = await fetch(gateway.url, { method: "POST", headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ ...request(method, params), id: ++counter }), signal: AbortSignal.timeout(15000), ...options });
      assert.equal(response.headers.get("cache-control"), "no-store"); return response;
    };
    const send = async signed => (await http("eth_sendRawTransaction", [signed])).json();
    const refused = body => { assert.equal(body.error?.code, -32000); assert.equal(body.result, undefined); assert.doesNotMatch(JSON.stringify(body), /provider diagnostics|reward_account_session_required/); };
    await chain.testClient.setBalance({ address: funder.address, value: 10n * mon });
    let signed, quote;
    await t.test("wallet metadata, fees and exact deposit gas work; origin, credentials and node controls fail closed", async () => {
      assert.equal((await (await http("eth_chainId")).json()).result, "0x7a69");
      assert.deepEqual((await (await http("eth_accounts")).json()).result, []);
      assert.ok(BigInt((await (await http("eth_estimateGas", [call(bound)])).json()).result) > 0n);
      assert.equal((await (await http("eth_getTransactionCount", [bound.funderAddress, "pending"])).json()).result, "0x0");
      const extension = "chrome-extension://" + "a".repeat(32);
      assert.equal((await http("eth_chainId", [], { Origin: extension })).headers.get("access-control-allow-origin"), extension);
      assert.equal((await http("eth_chainId", [], { Origin: "http://127.0.0.1:3101" })).headers.get("access-control-allow-origin"), "http://127.0.0.1:3101");
      for (const headers of [{ Origin: "https://www.raceson.com" }, { Origin: "https://attacker.invalid" }, { Cookie: "synthetic=value" }, { Authorization: "synthetic" }])
        refused(await (await http("eth_chainId", [], headers)).json());
      // Fetch normalizes Host to its URL; use actual HTTP headers for this test.
      const wrongHost = await new Promise((resolve, reject) => {
        const req = nativeRequest(gateway.url, { method: "POST", headers: { Host: "attacker.invalid", "Content-Type": "application/json" } }, res => {
          let body = ""; res.on("data", chunk => { body += chunk; }); res.on("end", () => resolve(JSON.parse(body)));
        });
        req.on("error", reject); req.setTimeout(3000, () => req.destroy(Error("owned HTTP timeout"))); req.end(JSON.stringify(request("eth_chainId")));
      });
      refused(wrongHost);
      for (const method of ["eth_sendTransaction", "anvil_setBalance", "evm_mine", "personal_sign"])
        refused(await (await http(method)).json());
      const cors = await fetch(gateway.url, { method: "OPTIONS", headers: { Origin: extension, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type" } });
      assert.equal(cors.status, 204); assert.equal(cors.headers.get("access-control-allow-private-network"), "true");
      quote = (await review("1")).quote; signed = await funder.signTransaction(transaction(bound));
    });
    await t.test("wrong signatures, revoked session, held source and elapsed session cannot release signed bytes", async () => {
      refused(await send(await fixtureSigner(0x999).signTransaction(transaction(bound))));
      revoked = true; refused(await send(signed)); revoked = false;
      held = true; refused(await send(signed)); held = false;
      afterReview = () => { alive = false; }; refused(await send(signed)); afterReview = undefined; alive = true;
      assert.equal(sends, 0); assert.deepEqual(readdirSync(directory), []);
    });
    await t.test("one actual wallet-signed deposit is finality-verified by the shared receipt service", async () => {
      const result = await send(signed); assert.equal(result.result, keccak256(signed)); assert.equal(sends, 1);
      await c.waitForTransactionReceipt({ hash: result.result });
      assert.equal((await inspectProgrammeDepositV3(actor, quote, result.result, { reader: c, rpc })).status, "pending");
      await chain.testClient.mine({ blocks: 96, interval: 1 });
      assert.equal((await inspectProgrammeDepositV3(actor, quote, result.result, { reader: c, rpc })).status, "confirmed");
      const filename = join(directory, readdirSync(directory)[0]), record = JSON.parse(readFileSync(filename));
      assert.equal(record.transactionHash, result.result); assert.equal(lstatSync(filename).mode & 0o077, 0);
      assert.deepEqual(Object.keys(record).sort(), ["chainId", "draftId", "expectedDepositedWei", "from", "nonce", "to", "transactionHash", "valueWei", "version"]);
    });
    await t.test("known hash recovery ignores a later policy hold but never re-broadcasts; stale deposits fail", async () => {
      held = true; assert.equal((await send(signed)).result, keccak256(signed)); assert.equal(sends, 1);
      revoked = true; refused(await send(signed)); revoked = false; held = false;
      refused(await send(await funder.signTransaction(transaction(bound, { nonce: 1 })))); assert.equal(sends, 1);
    });
    let uncertain;
    await t.test("uncertain pre-send response preserves hash/nonce across gateway restart and forbids fee replacement", async () => {
      uncertain = await funder.signTransaction(transaction(bound, { nonce: 1, data: data(mon) }));
      phase = "before-send"; refused(await send(uncertain)); assert.equal(sends, 2); assert.equal(readdirSync(directory).length, 2);
      gateway.stop(); gateway = await start(); phase = "normal";
      const replacement = await funder.signTransaction(transaction(bound, { nonce: 1, data: data(mon), maxFeePerGas: 90000000000n }));
      refused(await send(replacement)); assert.equal(sends, 2);
      assert.equal((await send(uncertain)).result, keccak256(uncertain)); assert.equal(sends, 3);
      await c.waitForTransactionReceipt({ hash: keccak256(uncertain) }); await chain.testClient.mine({ blocks: 96, interval: 1 });
    });
    await t.test("lost post-send response reconciles exact known hash with no duplicate and preserves total accounting", async () => {
      const third = await funder.signTransaction(transaction(bound, { nonce: 2, data: data(2n * mon) }));
      phase = "after-send"; refused(await send(third)); assert.equal(sends, 4);
      phase = "normal"; assert.equal((await send(third)).result, keccak256(third)); assert.equal(sends, 4);
      await c.waitForTransactionReceipt({ hash: keccak256(third) }); await chain.testClient.mine({ blocks: 96, interval: 1 });
      const now = await readVerifiedRewardProgrammeV3(c, { ...plan, deploymentTransactionHash: deployment });
      assert.equal(now.depositedWei, 3n * mon); assert.equal(now.totalRoutedWei, 0n); assert.ok(now.pots.every(p => p.paidWei === 0n));
    });
    await t.test("only one concurrent signed release is admitted and timeout/close invalidates a pending review", async () => {
      let entered, release;
      const inReview = new Promise(resolve => { entered = resolve; });
      afterReview = () => new Promise(resolve => { release = resolve; entered(); });
      const fourth = await funder.signTransaction(transaction(bound, { nonce: 3, data: data(3n * mon) }));
      const pending = send(fourth); let timeout;
      try { await Promise.race([inReview, new Promise((_, reject) => { timeout = setTimeout(() => reject(Error("review not reached")), 5000); })]); }
      finally { clearTimeout(timeout); }
      refused(await send(fourth)); alive = false; release(); refused(await pending);
      assert.equal(sends, 4); assert.equal(readdirSync(directory).length, 3);
    });
  } finally { gateway?.stop(); await chain.stop(); rmSync(directory, { recursive: true }); }
});
