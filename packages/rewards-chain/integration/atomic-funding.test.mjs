import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { keccak256 } from "viem";
import { encodeRewardFunding, readVerifiedRewardFunding, rewardCampaignAbi, rewardFundingFromObservation, verifySignedRewardFunding } from "../dist/index.js";
import { h } from "../test/fixtures.mjs";
import { startOwnedRewardChain } from "./owned-chain.mjs";
import { fundingWorkerFixture } from "./funding-worker-cases.mjs";

let chain, main;
const code = (expected) => (error) => error.code === expected;
const finalized = () => chain.testClient.mine({ blocks: 96, interval: 1 });
async function receipt(hash, status = "success") {
  const result = await chain.publicClient.waitForTransactionReceipt({ hash, timeout: 10000 });
  assert.equal(result.status, status); return result;
}
async function deploy(label, pot = 0) {
  const { operatorClient, operator, treasury, artifact, publicClient } = chain;
  const hashes = [h("funding programme"), h(label), h("funding manifest")];
  const tx = await receipt(await operatorClient.deployContract({ abi: rewardCampaignAbi, bytecode: artifact.bytecode.object,
    args: [operator.address, treasury, ...hashes, pot] }));
  const transaction = await publicClient.getTransaction({ hash: tx.transactionHash });
  return { context: { environment: "local-simulation", chainId: 31337, verifyingContract: tx.contractAddress },
    operatorAddress: operator.address, treasuryAddress: treasury, programmeId: hashes[0], campaignId: hashes[1], programmeManifestHash: hashes[2],
    enabledPot: pot, deploymentNonce: BigInt(transaction.nonce), deploymentTransactionHash: tx.transactionHash };
}
async function sign(deployment, prior, budget) {
  const nonce = BigInt(await chain.publicClient.getTransactionCount({ address: chain.operator.address, blockTag: "pending" }));
  const plan = { deployment, nonce, expectedAccountedFunding: prior, expectedBudget: budget };
  const signed = await chain.operator.signTransaction({ ...encodeRewardFunding(plan), type: "eip1559", gas: 300000n,
    maxFeePerGas: 20000000000n, maxPriorityFeePerGas: 100000000n });
  return { plan, signed, hash: keccak256(signed) };
}
const read = (entry, reader = chain.publicClient) => readVerifiedRewardFunding(reader, entry.plan, entry.signed, chain.artifact.bytecode.object);
async function fund(deployment, value) {
  return receipt(await chain.operatorClient.writeContract({ address: deployment.context.verifyingContract, abi: rewardCampaignAbi, functionName: "fund", value }));
}

before(async () => {
  chain = await startOwnedRewardChain();
  const deployment = await deploy("partial plus forced");
  await fund(deployment, 3n * 10n ** 18n);
  // Synthetic Anvil-only forced balance, not an explicit prize deposit.
  await chain.testClient.setBalance({ address: deployment.context.verifyingContract, value: 8n * 10n ** 18n });
  main = await sign(deployment, 3n * 10n ** 18n, 12n * 10n ** 18n);
  main.receipt = await receipt(await chain.operatorClient.sendRawTransaction({ serializedTransaction: main.signed }));
  await finalized();
}, { timeout: 20000 });
after(async () => { await chain?.stop(); });

test("real signed atomic funding proves the exact remainder, frozen pot and forced surplus", async () => {
  const result = await read(main);
  assert.equal(result.funding.transactionHash, main.hash); assert.equal(result.funding.depositedValue, 9n * 10n ** 18n);
  assert.equal(result.funding.budget, 12n * 10n ** 18n); assert.equal(result.funding.expectedAccountedFunding, 3n * 10n ** 18n);
  assert.equal(result.funding.fundingClosedLogIndex, main.receipt.logs[1].logIndex);
  assert.equal(result.checkpoint.observation.accounting.state, 1);
  assert.equal(result.checkpoint.observation.accounting.accountedFunding, 12n * 10n ** 18n);
  assert.equal(result.checkpoint.observation.accounting.nativeBalance, 17n * 10n ** 18n);
  assert.deepEqual(result.checkpoint.observation.accounting.paid, [0n, 0n]);
  assert.deepEqual(result.funding.finalizedBlock, result.checkpoint.observation.finalizedBlock);
  // Re-observing the same historical attempt sends no transaction or second value.
  const nonce = await chain.publicClient.getTransactionCount({ address: chain.operator.address });
  assert.deepEqual(await read(main), result);
  assert.equal(await chain.publicClient.getTransactionCount({ address: chain.operator.address }), nonce);
});

test("funding receipt verifier rejects altered provenance, amounts, complete logs and finality", async () => {
  const { publicClient } = chain;
  const block = await publicClient.getBlock({ blockTag: "finalized" });
  const observation = { observedChainId: 31337, transaction: await publicClient.getTransaction({ hash: main.hash }), receipt: main.receipt,
    canonicalFundingBlockHash: main.receipt.blockHash, finalizedBlock: { number: block.number, hash: block.hash, timestamp: block.timestamp },
    runtimeCode: await publicClient.getCode({ address: main.plan.deployment.context.verifyingContract, blockNumber: block.number }) };
  const verify = (observed = observation) => rewardFundingFromObservation(main.plan, main.hash, observed);
  assert.equal(verify().transactionHash, main.hash);
  for (const [mutate, expected] of [
    [o => { o.observedChainId = 143; }, "reward_funding_transaction_chain_mismatch"],
    [o => { o.transaction.chainId = 10143; }, "reward_funding_transaction_chain_mismatch"],
    [o => { o.receipt.status = "reverted"; }, "reward_funding_reverted"],
    [o => { o.receipt.transactionHash = h("other"); }, "reward_funding_transaction_mismatch"],
    [o => { o.transaction.hash = h("other"); }, "reward_funding_transaction_mismatch"],
    [o => { o.transaction.from = chain.treasury; }, "reward_funding_sender_mismatch"],
    [o => { o.receipt.from = chain.treasury; }, "reward_funding_sender_mismatch"],
    [o => { o.receipt.to = chain.treasury; }, "reward_funding_destination_mismatch"],
    [o => { o.transaction.to = null; }, "reward_funding_destination_mismatch"],
    [o => { o.receipt.contractAddress = chain.treasury; }, "reward_funding_destination_mismatch"],
    [o => { o.transaction.nonce++; }, "reward_funding_nonce_mismatch"],
    [o => { o.transaction.value++; }, "reward_funding_input_mismatch"],
    [o => { o.transaction.input += "00"; }, "reward_funding_input_mismatch"],
    [o => { o.transaction.blockHash = h("other"); }, "reward_funding_receipt_mismatch"],
    [o => { o.transaction.transactionIndex++; }, "reward_funding_receipt_mismatch"],
    [o => { o.finalizedBlock.number = o.receipt.blockNumber - 1n; }, "reward_funding_not_finalized"],
    [o => { o.canonicalFundingBlockHash = h("other"); }, "reward_funding_not_canonical"],
    [o => { o.finalizedBlock.number = o.receipt.blockNumber; o.finalizedBlock.hash = h("other"); }, "reward_funding_not_canonical"],
    [o => { o.runtimeCode = `${o.runtimeCode.slice(0,-2)}00`; }, "reward_runtime_code_mismatch"],
    [o => { o.receipt.logs.pop(); }, "reward_funding_event_count_mismatch"],
    [o => { o.receipt.logs.push(o.receipt.logs[0]); }, "reward_funding_event_count_mismatch"],
    [o => { o.receipt.logs[0].removed = true; }, "invalid_reward_funding_log"],
    [o => { o.receipt.logs[1].logIndex = o.receipt.logs[0].logIndex; }, "invalid_reward_funding_log"],
    [o => { o.receipt.logs[0].transactionIndex++; }, "reward_funding_log_receipt_mismatch"],
    [o => { o.receipt.logs[0].blockHash = h("other"); }, "reward_funding_log_receipt_mismatch"],
    [o => { o.receipt.logs[0].transactionHash = h("other"); }, "reward_funding_log_receipt_mismatch"],
    [o => { o.receipt.logs[0].address = chain.treasury; }, "reward_funding_event_mismatch"],
    [o => { o.receipt.logs[1].data += "00"; }, "reward_funding_event_mismatch"],
    [o => { o.receipt.logs[1].topics.push(h("extra")); }, "reward_funding_event_mismatch"],
    [o => { o.receipt.logs[1].topics[1] = h("other pot"); }, "reward_funding_event_mismatch"],
  ]) { const copy = structuredClone(observation); mutate(copy); assert.throws(() => verify(copy), code(expected), expected); }
});

test("read-only funding observation rejects RPC drift and redacts provider failure details", async () => {
  let networkReads = 0;
  await assert.rejects(read(main, { ...chain.publicClient, getChainId: async () => ++networkReads === 4 ? 143 : 31337 }), code("reward_observed_chain_mismatch"));
  assert.equal(networkReads, 4);
  let fundingReads = 0;
  await assert.rejects(read(main, { ...chain.publicClient, getBlock: async args => {
    const block = await chain.publicClient.getBlock(args);
    if (args.blockNumber === main.receipt.blockNumber && ++fundingReads === 2) return { ...block, hash: h("drift") };
    return block;
  } }), code("reward_chain_changed_during_observation"));
  let finalityReads = 0;
  await assert.rejects(read(main, { ...chain.publicClient, getBlock: async args => {
    const block = await chain.publicClient.getBlock(args);
    if (args.blockTag === "finalized" && ++finalityReads === 4) return { ...block, number: 0n };
    return block;
  } }), code("reward_finality_regressed"));
  await assert.rejects(read(main, { ...chain.publicClient, getTransactionReceipt: async args => {
    if (args.hash === main.hash) throw new Error("https://provider.example/synthetic-sensitive-token");
    return chain.publicClient.getTransactionReceipt(args);
  } }), error => {
    assert.equal(error.code, "reward_funding_observation_unavailable"); assert.equal(error.cause, undefined);
    assert.doesNotMatch(String(error), /provider|sensitive/); return true;
  });
});

test("an already explicitly funded league campaign closes with zero value and one exact event", async () => {
  const deployment = await deploy("already full", 1); await fund(deployment, 2n * 10n ** 18n);
  const entry = await sign(deployment, 2n * 10n ** 18n, 2n * 10n ** 18n);
  const tx = await receipt(await chain.operatorClient.sendRawTransaction({ serializedTransaction: entry.signed }));
  assert.equal(tx.logs.length, 1); await finalized();
  const result = await read(entry); assert.equal(result.funding.depositedValue, 0n);
  assert.equal(result.funding.enabledPot, 1); assert.deepEqual(result.checkpoint.observation.accounting.budgets, [0n, 2n * 10n ** 18n]);
});

test("a competing deposit makes stale funding revert without transferring its signed remainder", async () => {
  const deployment = await deploy("competing deposit"); await fund(deployment, 3n * 10n ** 18n);
  await fund(deployment, 1n * 10n ** 18n);
  const stale = await sign(deployment, 3n * 10n ** 18n, 12n * 10n ** 18n);
  assert.equal((await verifySignedRewardFunding(stale.plan, stale.signed)).value, 9n * 10n ** 18n, "Signature correctness is not current-state authority");
  await receipt(await chain.operatorClient.sendRawTransaction({ serializedTransaction: stale.signed }), "reverted");
  await finalized();
  await assert.rejects(read(stale), code("reward_funding_reverted"));
  assert.equal(await chain.publicClient.getBalance({ address: deployment.context.verifyingContract }), 4n * 10n ** 18n);
  const fresh = await sign(deployment, 4n * 10n ** 18n, 12n * 10n ** 18n);
  // Explicit test-only reconciliation/new nonce; no runtime automatic replacement.
  await receipt(await chain.operatorClient.sendRawTransaction({ serializedTransaction: fresh.signed })); await finalized();
  assert.equal((await read(fresh)).funding.depositedValue, 8n * 10n ** 18n);
});

test("a valid but absent signed transaction is not considered funded", async () => {
  const deployment = await deploy("absent transaction"); const absent = await sign(deployment, 0n, 1n * 10n ** 18n);
  await finalized(); await assert.rejects(read(absent), code("reward_funding_observation_unavailable"));
  assert.equal(await chain.publicClient.getBalance({ address: deployment.context.verifyingContract }), 0n);
});

test("cancellation does not erase historical funding and does not imply available prizes", async () => {
  await receipt(await chain.operatorClient.writeContract({ address: main.plan.deployment.context.verifyingContract,
    abi: rewardCampaignAbi, functionName: "cancel" }));
  await finalized(); const cancelled = await read(main);
  assert.equal(cancelled.checkpoint.observation.accounting.state, 5);
  assert.equal(cancelled.checkpoint.observation.accounting.treasuryReturned, 0n);
  await receipt(await chain.operatorClient.writeContract({ address: main.plan.deployment.context.verifyingContract,
    abi: rewardCampaignAbi, functionName: "returnToTreasury" }));
  await finalized(); const result = await read(main);
  assert.equal(result.funding.budget, 12n * 10n ** 18n); assert.equal(result.checkpoint.observation.accounting.state, 5);
  assert.equal(result.checkpoint.observation.accounting.treasuryReturned, 12n * 10n ** 18n);
  assert.deepEqual(result.checkpoint.observation.accounting.paid, [0n, 0n]);
});

test("funding worker rejects unavailable/malformed RPC, nonce conflicts, wrong code and lost authority before sending",async()=>{
  const deployment=await deploy("worker-negative");await finalized();const worker=await fundingWorkerFixture(chain,deployment);
  const client=chain.publicClient;
  assert.equal((await worker.run({...client,getChainId:async()=>143})).outcome,"unavailable");
  assert.equal((await worker.run({...client,getTransaction:async()=>{throw new Error("synthetic sensitive RPC detail");}})).outcome,"unavailable");
  for(const tx of [undefined,null,{}, {hash:worker.hash,from:null}])assert.equal((await worker.run({...client,getTransaction:async()=>tx})).outcome,"requires_attention");
  assert.equal((await worker.run({...client,getTransactionCount:async()=>Number(worker.plan.nonce)-1})).outcome,"awaiting_nonce");
  assert.equal((await worker.run({...client,getTransactionCount:async()=>Number(worker.plan.nonce)+1})).outcome,"nonce_conflict");
  assert.equal((await worker.run({...client,getTransactionCount:async()=>0.5})).outcome,"unavailable");
  assert.equal((await worker.run({...client,getCode:async()=>"0x00"})).outcome,"unavailable");
  worker.loseLease(true);await assert.rejects(worker.run(),{code:"reward_funding_job_lease_lost"});worker.loseLease(false);
  assert.deepEqual(worker.stats(),{sent:0,armed:0,confirmations:0});
});

test("funding worker cannot start a send after its returned lease deadline",async()=>{
  const deployment=await deploy("worker-expired-arm");await finalized();const worker=await fundingWorkerFixture(chain,deployment);
  worker.expireArm(true);assert.equal((await worker.run()).outcome,"busy");assert.deepEqual(worker.stats(),{sent:0,armed:1,confirmations:0});
});

test("a changed explicit deposit leaves a prepared funding job unsent and unconfirmed",async()=>{
  const deployment=await deploy("worker-changed-deposit");await finalized();const worker=await fundingWorkerFixture(chain,deployment);
  await fund(deployment,1n);await finalized();
  assert.equal((await worker.run()).outcome,"prestate_changed");assert.deepEqual(worker.stats(),{sent:0,armed:0,confirmations:0});
  assert.equal(await chain.publicClient.getBalance({address:deployment.context.verifyingContract}),1n);
});

test("a mined reverted funding attempt requires attention and cannot produce a confirmation",async()=>{
  const deployment=await deploy("worker-reverted");await finalized();const worker=await fundingWorkerFixture(chain,deployment,{nonceOffset:1n});
  // Explicit synthetic external sends bypass the worker to reproduce an already
  // mined stale attempt. The worker itself refuses this changed pre-state.
  await fund(deployment,1n);await receipt(await chain.operatorClient.sendRawTransaction({serializedTransaction:worker.signed}),"reverted");await finalized();
  assert.equal((await worker.run()).outcome,"requires_attention");assert.deepEqual(worker.stats(),{sent:0,armed:0,confirmations:0});
});
