import assert from "node:assert/strict";
import test from "node:test";
import { keccak256, padHex, toHex } from "viem";
import { readVerifiedRewardClubSafeDeployment, rewardClubSafeDeploymentBuild as pins } from "../dist/index.js";
import { originalSafeArtifacts, originalSafeFactoryArtifact } from "./safe-artifacts.mjs";
import { clubSafeDeploymentFixture as fixture } from "./club-safe-deployment-fixture.mjs";
const a = n => toHex(BigInt(n), { size: 20 }), hash = n => toHex(BigInt(n), { size: 32 });
const artifacts = originalSafeArtifacts(), factory = originalSafeFactoryArtifact();
test("Safe deployment pins match SHA-verified original factory and proxy creation artifacts", () => {
  for (const [key, code] of [["factory", factory.deployedBytecode], ["proxyCreation", artifacts.proxy.bytecode]]) {
    assert.equal(keccak256(code), pins[key].hash); assert.equal((code.length - 2) / 2, pins[key].bytes); assert.ok(Object.isFrozen(pins[key]));
  }
});
test("exact atomic initialization preserves original owner order, arbitrary salt and both allowed chains", async () => {
  for (const [chainId, saltNonce] of [[31337, 0n], [10143, (1n << 256n) - 1n]]) {
    const h = fixture({ chainId, saltNonce }), result = await readVerifiedRewardClubSafeDeployment(h.reader, h.input);
    assert.equal(result.scope, "initialization_only"); assert.equal(result.executionHistoryReviewRequired, true);
    assert.equal(result.saltNonce, saltNonce); assert.equal(result.initializerHash, keccak256(h.initializer)); assert.deepEqual(result.setupOwners, h.owners);
    assert.equal(result.safe.finalizedBlock.number, 100n); assert.equal(result.deploymentBlock.hash, h.deployment.hash);
    assert.equal(result.parentBlock.number, 49n); assert.equal(result.safe.threshold, 2);
    for (const blockNumber of [49n, 50n]) for (const address of [a(11), a(12), a(13)]) assert.ok(h.calls.some(p => p.blockNumber === blockNumber && p.address?.toLowerCase() === address && !p.functionName));
    assert.ok(h.calls.filter(p => p.functionName === "proxyCreationCode").every(p => p.blockNumber === 50n));
  }
});
test("caller-owned nested expectations and checkpoint are copied before the first await", async () => {
  const h = fixture(), original = structuredClone(h.input), at = { ...h.at };
  h.reader.getChainId = async () => { h.input.safe.owners[0] = a(99); h.input.safe.context.verifyingContract = a(99); h.input.factoryAddress = a(99); at.number = 999n; return 31337; };
  const result = await readVerifiedRewardClubSafeDeployment(h.reader, h.input, at);
  assert.equal(result.factoryAddress, original.factoryAddress); assert.deepEqual(result.setupOwners, h.owners); assert.equal(result.safe.finalizedBlock.number, 100n);
});
test("network and conflated factory expectations fail before any provider read", async () => {
  for (const patch of [{ factoryAddress: a(11) }, { safe: { ...fixture().input.safe, context: { environment: "monad-mainnet", chainId: 143, verifyingContract: a(99) } } }]) {
    const h = fixture(); let calls = 0; h.reader.getChainId = async () => { calls++; return 31337; };
    await assert.rejects(readVerifiedRewardClubSafeDeployment(h.reader, { ...h.input, ...patch })); assert.equal(calls, 0);
  }
});
test("different sender/target/network/hash/value or pending/reverted receipt cannot supply deployment provenance", async () => {
  for (const [part, patch] of [
    ["tx", { to: a(99) }], ["tx", { to: null }], ["tx", { from: a(99) }], ["tx", { chainId: 143 }], ["tx", { hash: hash(501) }], ["tx", { value: 1n }],
    ["tx", { blockHash: null }], ["tx", { blockNumber: null }], ["tx", { transactionIndex: 4 }], ["tx", { transactionIndex: -1 }],
    ["receipt", { to: null }], ["receipt", { status: "reverted" }], ["receipt", { transactionHash: hash(501) }], ["receipt", { blockHash: hash(51) }],
    ["receipt", { contractAddress: a(99) }],
  ]) { const h = fixture(); Object.assign(h[part], patch); await assert.rejects(readVerifiedRewardClubSafeDeployment(h.reader, h.input)); }
});
test("setup cannot delegate, pay, change the handler/owner set/threshold or use trailing/unsupported calldata", async () => {
  for (const setupPatch of [{ threshold: 1n }, { owners: [a(20), a(21), a(23)] }, { owners: [a(20), a(20), a(21)] },
    { owners: [a(20), a(21)] }, { to: a(99) }, { data: "0x1234" }, { handler: a(99) }, { paymentToken: a(99) }, { payment: 1n }, { paymentReceiver: a(99) }]) {
    const h = fixture({ setupPatch }); await assert.rejects(readVerifiedRewardClubSafeDeployment(h.reader, h.input));
    assert.equal(h.calls.filter(p => p.functionName).length, 0);
  }
  for (const mutate of [s => `${s}00`, () => "0x", s => `0x00000000${s.slice(10)}`, s => `0x${"ff".repeat(580)}`]) {
    const h = fixture(); h.tx.input = mutate(h.tx.input); await assert.rejects(readVerifiedRewardClubSafeDeployment(h.reader, h.input));
  }
});
test("all three prerequisite runtime pins must exist in parent and deployment state before any contract method call", async () => {
  for (const blockNumber of [49n, 50n]) for (const address of [a(11), a(12), a(13)]) {
    const h = fixture(), read = h.reader.getCode; h.reader.getCode = p => p.blockNumber === blockNumber && p.address.toLowerCase() === address ? "0x" : read(p);
    await assert.rejects(readVerifiedRewardClubSafeDeployment(h.reader, h.input)); assert.equal(h.calls.filter(p => p.functionName).length, 0);
  }
});
test("factory creation bytecode and deterministic destination are independently bound", async () => {
  const h = fixture(), read = h.reader.readContract; h.reader.readContract = p => p.functionName === "proxyCreationCode" ? "0x6000" : read(p);
  await assert.rejects(readVerifiedRewardClubSafeDeployment(h.reader, h.input), { code: "reward_club_proxy_creation_code_mismatch" });
  const f = fixture(); f.input.safe.context.verifyingContract = a(99);
  await assert.rejects(readVerifiedRewardClubSafeDeployment(f.reader, f.input), { code: "reward_club_create2_address_mismatch" });
});
test("exact ordered setup/creation logs bind factory, proxy, owners and all mined receipt metadata", async () => {
  const changes = [r => r.logs.pop(), r => r.logs.push(r.logs[1]), r => r.logs.reverse(),
    ...[{ address: a(99) }, { data: "0x" }, { topics: [hash(1)] }, { removed: true }, { blockHash: hash(51) }, { transactionHash: hash(501) },
      { transactionIndex: 4 }, { blockNumber: 51n }, { logIndex: null }, { logIndex: -1 }].map(patch => r => Object.assign(r.logs[0], patch)),
    r => { r.logs[1].logIndex = 99; }, r => { r.logs[1].topics[1] = padHex(a(99), { size: 32 }); },
  ];
  for (const change of changes) { const h = fixture(); change(h.receipt); await assert.rejects(readVerifiedRewardClubSafeDeployment(h.reader, h.input), { code: "reward_club_deployment_events_mismatch" }); }
});
test("initialization cannot substitute for the current Safe configuration check", async () => {
  const h = fixture(), read = h.reader.readContract; h.reader.readContract = p => p.functionName === "getThreshold" ? 1n : read(p);
  await assert.rejects(readVerifiedRewardClubSafeDeployment(h.reader, h.input), { code: "reward_club_two_signatures_required" });
});
test("deployment must precede a canonical finalized checkpoint with matching canonical parent", async () => {
  const h = fixture();
  await assert.rejects(readVerifiedRewardClubSafeDeployment(h.reader, h.input, h.block(49n)), { code: "reward_club_deployment_not_finalized" });
  await assert.rejects(readVerifiedRewardClubSafeDeployment(h.reader, h.input, h.block(101n)), { code: "reward_club_checkpoint_not_finalized" });
  for (const patch of [{ hash: hash(51) }, { parentHash: hash(48) }, { timestamp: 1200n }, { number: 51n }]) {
    const f = fixture(), read = f.reader.getBlock; f.reader.getBlock = async p => ({ ...await read(p), ...(p.blockNumber === 50n ? patch : {}) });
    await assert.rejects(readVerifiedRewardClubSafeDeployment(f.reader, f.input), { code: "reward_club_deployment_not_canonical" });
  }
  const result = await readVerifiedRewardClubSafeDeployment(h.reader, h.input, h.block(80n));
  assert.equal(result.safe.finalizedBlock.number, 80n); assert.equal(result.observedFinalizedHead.number, 100n);
});
test("reorgs of either historical boundary and chain/finality changes after configuration fail closed", async () => {
  for (const mutation of ["chain", "finality", "parent", "deployment", "checkpoint"]) {
    const h = fixture(), read = h.reader.getBlock; let chains = 0;
    h.reader.getChainId = async () => ++chains === 4 && mutation === "chain" ? 10143 : 31337;
    h.reader.getBlock = async p => ({ ...await read(p), ...(chains >= 4 && ((mutation === "parent" && p.blockNumber === 49n)
      || (mutation === "deployment" && p.blockNumber === 50n) || (mutation === "checkpoint" && p.blockNumber === 100n)) ? { hash: hash(999) } : {}),
      ...(chains >= 4 && mutation === "finality" && p.blockTag === "finalized" ? { number: 99n } : {}) });
    await assert.rejects(readVerifiedRewardClubSafeDeployment(h.reader, h.input),
      { code: mutation === "chain" ? "reward_observed_chain_mismatch" : mutation === "finality" ? "reward_finality_regressed" : "reward_chain_changed_during_observation" });
  }
  const h = fixture(), read = h.reader.getBlock; let heads = 0;
  h.reader.getBlock = async p => p.blockTag === "finalized" && ++heads > 1 ? h.block(90n) : read(p);
  await assert.rejects(readVerifiedRewardClubSafeDeployment(h.reader, h.input, h.block(80n)), { code: "reward_finality_regressed" });
});
test("raw unavailable/pruned-history and malformed ABI errors cannot leak provider secrets or imply approval", async () => {
  for (const method of ["getTransaction", "getTransactionReceipt", "getCode", "getBlock"]) {
    const h = fixture(); h.reader[method] = async () => { throw Error("https://private:key@rpc.example/secret"); };
    await assert.rejects(readVerifiedRewardClubSafeDeployment(h.reader, h.input), e => e.code === "reward_club_deployment_observation_unavailable" && !e.cause && !JSON.stringify(e).includes("secret"));
  }
});
