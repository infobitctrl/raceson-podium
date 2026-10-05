import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { createPublicClient, http } from "viem";
import { startProgrammeLocalChain, validateLocalProgrammeRead } from "../../../demo/rewards/scripts/programme-local-chain.mjs";

test("local programme gateway rejects mutations, batches, foreign hosts and browser origins", () => {
  const request = { jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] };
  validateLocalProgrammeRead(request, undefined, "127.0.0.1:18546");
  validateLocalProgrammeRead({ ...request, params: undefined }, undefined, "127.0.0.1:18546");
  for (const method of ["eth_sendRawTransaction", "eth_sendTransaction", "anvil_setBalance", "anvil_reset", "eth_sign", "wallet_sendCalls"])
    assert.throws(() => validateLocalProgrammeRead({ ...request, method }, undefined, "127.0.0.1:18546"));
  assert.throws(() => validateLocalProgrammeRead(request, "http://127.0.0.1:3101", "127.0.0.1:18546"));
  assert.throws(() => validateLocalProgrammeRead(request, undefined, "attacker.invalid:18546"));
  assert.throws(() => validateLocalProgrammeRead([request], undefined, "127.0.0.1:18546"));
});

test("owned persistent local chain preserves exact historical receipts after restart and exposes reads only", async () => {
  const directory = mkdtempSync("/private/tmp/raceson-programme-chain-");
  let runtime;
  try {
    runtime = await startProgrammeLocalChain({ directory, readPort: 0 });
    await assert.rejects(startProgrammeLocalChain({ directory, readPort: 0 }), /EEXIST/);
    await runtime.test.setBalance({ address: runtime.operator.address, value: 10n ** 19n });
    const hash = await runtime.operatorWallet.sendTransaction({ to: runtime.funder.address, value: 1n });
    const receipt = await runtime.reader.waitForTransactionReceipt({ hash });
    await runtime.test.mine({ blocks: 96, interval: 1 });
    const block = await runtime.reader.getBlock({ blockNumber: receipt.blockNumber });
    const proxy = createPublicClient({ transport: http(runtime.readUrl, { retryCount: 0 }) });
    assert.equal(await proxy.getChainId(), 31337);
    assert.equal((await proxy.getTransactionReceipt({ hash })).blockHash, block.hash);
    const refused = await fetch(runtime.readUrl, { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "anvil_setBalance", params: [runtime.funder.address, "0x999"] }) });
    assert.equal(refused.status, 503); assert.equal(await runtime.reader.getBalance({ address: runtime.funder.address }), 1n);
    const binding = { chainId: 31337, draftId: "88000000-0000-4000-8000-000000000005", address: runtime.operator.address.toLowerCase(),
      funderAddress: runtime.funder.address.toLowerCase(), budgetWei: "1" };
    let release;
    const heldAccess = new Promise(resolve => { release = resolve; });
    const config = { binding, access: async () => { await heldAccess; return binding; }, review: async () => ({ status: "blocked", reason: "deployment_required" }), alive: () => true };
    const opening = runtime.openWalletRpc(config);
    await assert.rejects(runtime.openWalletRpc(config), /already_open/); release();
    const wallet = await opening;
    const accounts = await fetch(wallet.url, { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1:3101" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_accounts", params: [] }) });
    assert.deepEqual((await accounts.json()).result, []);
    // A delayed tick must retain its exclusion until that same request ends.
    let allowBlock, blockDone, miningCalls = 0;
    const delayedBlock = new Promise(resolve => { allowBlock = resolve; });
    const completedBlock = new Promise(resolve => { blockDone = resolve; });
    const mine = runtime.test.mine;
    runtime.test.mine = async input => { miningCalls++; await delayedBlock; try { return await mine(input); } finally { blockDone(); } };
    await delay(3100); assert.equal(miningCalls, 1);
    wallet.stop(); allowBlock(); await completedBlock;
    const closedAt = await runtime.reader.getBlockNumber({ cacheTime: 0 }); await delay(1100);
    assert.equal(await runtime.reader.getBlockNumber({ cacheTime: 0 }), closedAt);
    await runtime.stop(); runtime = undefined;
    await assert.rejects(fetch(wallet.url, { signal: AbortSignal.timeout(1000) }));
    runtime = await startProgrammeLocalChain({ directory, readPort: 0 });
    assert.equal((await runtime.reader.getTransactionReceipt({ hash })).blockHash, receipt.blockHash);
    assert.equal((await runtime.reader.getBlock({ blockNumber: receipt.blockNumber })).hash, block.hash);
    assert.equal(await runtime.reader.getBalance({ address: runtime.funder.address, blockNumber: receipt.blockNumber }), 1n);
    assert.equal(await runtime.reader.getBalance({ address: runtime.funder.address, blockNumber: receipt.blockNumber - 1n }), 0n);
  } finally { await runtime?.stop(); rmSync(directory, { recursive: true }); }
});

test("local block failure closes only the wallet endpoint, retains the read runtime and does not retry mining", async () => {
  const directory = mkdtempSync("/private/tmp/raceson-programme-chain-");
  let runtime;
  try {
    runtime = await startProgrammeLocalChain({ directory, readPort: 0 });
    const binding = { chainId: 31337, draftId: "88000000-0000-4000-8000-000000000005", address: runtime.operator.address.toLowerCase(),
      funderAddress: runtime.funder.address.toLowerCase(), budgetWei: "1" };
    let calls = 0;
    runtime.test.mine = async () => { calls++; throw Error("synthetic provider diagnostic must not be logged"); };
    const wallet = await runtime.openWalletRpc({ binding, access: async () => binding,
      review: async () => ({ status: "blocked", reason: "deployment_required" }), alive: () => true });
    await delay(2200); assert.equal(calls, 1);
    await assert.rejects(fetch(wallet.url, { signal: AbortSignal.timeout(1000) }));
    const response = await fetch(runtime.readUrl, { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }) });
    assert.equal((await response.json()).result, "0x7a69");
  } finally { await runtime?.stop(); rmSync(directory, { recursive: true }); }
});
