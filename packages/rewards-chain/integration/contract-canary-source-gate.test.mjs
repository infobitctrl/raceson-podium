import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { getContractAddress, keccak256, parseEther, parseTransaction } from "viem";
import { startOwnedRewardChain, fixtureSigner } from "./owned-chain.mjs";
import { executeContractCanary, publicCanaryExecution } from "../../../demo/rewards/scripts/contract-canary-executor.mjs";
import { canarySourcePackageHash, canarySourceVerifier } from "../../../demo/rewards/scripts/contract-canary-source.mjs";
import { main as canaryCommand } from "../../../demo/rewards/scripts/contract-canary.mjs";

// Local protocol/state-machine rehearsal with a mock source observer. The actual
// explorer adapter is separately exercised against an owned 10143 node. Never
// load the Mac Keychain or send to a public RPC from this file.
const artifact = JSON.parse(readFileSync(new URL("../../../contracts/out/RacesOnRewardCampaignV2.sol/RacesOnRewardCampaignV2.json", import.meta.url)));
let chain, execution, parent, directory, client, staged;
let signatures = 0, sends = 0, observations = 0, stopActivation = true;
const funder = fixtureSigner(0x777);
before(async () => {
  chain = await startOwnedRewardChain();
  parent = realpathSync(mkdtempSync(join(tmpdir(), "raceson-canary-source-gate-")));
  directory = join(parent, "execution");
  await chain.testClient.setBalance({ address: funder.address, value: parseEther("1000") });
  await chain.testClient.setNonce({ address: funder.address, nonce: 1 });
  await chain.testClient.setBalance({ address: chain.operator.address, value: 0n });
  await chain.testClient.setBalance({ address: chain.relayer.address, value: parseEther("0.001") });
  await chain.testClient.mine({ blocks: 96, interval: 1 });
  const source = publicCanaryExecution(artifact);
  execution = { ...source, spec: { ...source.spec, operatorAddress: chain.operator.address, treasuryAddress: funder.address,
    context: { environment: "local-simulation", chainId: 31337,
      verifyingContract: getContractAddress({ from: chain.operator.address, nonce: 0n }) } },
    roles: { funder: funder.address, operator: chain.operator.address, relayer: chain.relayer.address } };
  client = { ...chain.publicClient, sendRawTransaction: async args => {
    const tx = parseTransaction(args.serializedTransaction);
    if (tx.from) assert.fail("Serialized transaction has no trusted from field");
    if (tx.nonce === 4 && tx.to?.toLowerCase() === execution.spec.context.verifyingContract.toLowerCase() && stopActivation) {
      stopActivation = false; throw Error("Activation interrupted before broadcast");
    }
    sends++; const hash = await chain.publicClient.sendRawTransaction(args);
    await chain.testClient.mine({ blocks: 96, interval: 1 }); return hash;
  } };
}, { timeout: 20000 });
after(async () => { await chain?.stop(); if (parent) rmSync(parent, { recursive: true, force: true }); });
async function sourceObserver(expected) {
  observations++;
  assert.equal(expected.context.chainId, 31337);
  assert.equal(expected.context.verifyingContract, execution.spec.context.verifyingContract);
  const receipt = await chain.publicClient.getTransactionReceipt({ hash: expected.deploymentTransactionHash });
  return { status: "exact-source-observed", chainId: 31337, address: expected.context.verifyingContract,
    packageHash: canarySourcePackageHash, verifier: canarySourceVerifier,
    deploymentTransactionHash: receipt.transactionHash, deploymentBlockNumber: String(receipt.blockNumber),
    deploymentBlockHash: receipt.blockHash, runtimeCodeHash: keccak256(await chain.publicClient.getCode({ address: receipt.contractAddress })) };
}
const run = (action, overrides = {}) => executeContractCanary({ execution, client, journalDirectory: directory, action,
  approvedManifestHash: execution.spec.programmeManifestHash, verifySource: sourceObserver,
  signerForRole: async role => { signatures++; return role === "funder" ? funder : chain.operator; }, ...overrides });

test("public funded commands need approval, an observer and a completed deployment; never implicitly top up", async () => {
  const e = publicCanaryExecution(artifact), missing = join(parent, "missing");
  let reads = 0, signs = 0, sourceCalls = 0;
  const options = { execution: e, journalDirectory: missing,
    client: { getChainId: async () => { reads++; return 10143; } },
    signerForRole: async () => { signs++; throw Error("Unexpected signer access"); },
    verifySource: async () => { sourceCalls++; return true; } };
  for (const action of ["stage", "activate"]) {
    await assert.rejects(run(action, { ...options, approvedManifestHash: undefined }), /owner-approved/);
    await assert.rejects(run(action, { ...options, verifySource: undefined }), /source-verification gate/);
    await assert.rejects(run(action, options), /completed deployment phase/);
  }
  assert.equal(existsSync(missing), false); assert.equal(reads + signs + sourceCalls, 0);
});

test("deployment stops unfunded; wrong or absent source evidence cannot authorize the prize deposit", async () => {
  const deployed = await run("deploy");
  assert.equal(deployed.fundedMON, "0"); assert.equal(sends, 3); assert.equal(signatures, 3); assert.equal(observations, 0);
  const mutations = [source => false, source => ({ ...source, status: "source-not-verified" }),
    source => ({ ...source, chainId: 143 }), source => ({ ...source, address: funder.address }),
    source => ({ ...source, packageHash: `0x${"1".repeat(64)}` }), source => ({ ...source, verifier: "https://example.invalid/" }),
    source => ({ ...source, deploymentTransactionHash: `0x${"1".repeat(64)}` }),
    source => ({ ...source, deploymentBlockNumber: "999999" }), source => ({ ...source, deploymentBlockHash: `0x${"1".repeat(64)}` }),
    source => ({ ...source, runtimeCodeHash: `0x${"1".repeat(64)}` })];
  for (const mutate of mutations) await assert.rejects(run("stage", { verifySource: async expected => mutate(await sourceObserver(expected)) }));
  await assert.rejects(run("stage", { verifySource: async () => { throw Error("Explorer unavailable"); } }), /unavailable/);
  assert.equal(signatures, 3); assert.equal(sends, 3);
  assert.equal(await chain.publicClient.getBalance({ address: deployed.address }), 0n);
  assert.equal(existsSync(join(directory, "fund-attempt.json")), false);
});

test("nonce and balance changes during source IO stop before signer access", async () => {
  for (const mutate of [
    () => chain.testClient.setNonce({ address: chain.operator.address, nonce: 2 }),
    () => chain.testClient.setBalance({ address: chain.operator.address, value: 0n }),
  ]) {
    const snapshot = await chain.testClient.snapshot();
    try {
      await assert.rejects(run("stage", { verifySource: async expected => {
        const source = await sourceObserver(expected); await mutate(); return source;
      } }));
      assert.equal(signatures, 3); assert.equal(sends, 3);
      assert.equal(existsSync(join(directory, "fund-attempt.json")), false);
    } finally { await chain.testClient.revert({ id: snapshot }); }
  }
});

test("source is rechecked before signing and broadcast; deployment retry cannot send a saved funding attempt", async () => {
  let count = 0;
  await assert.rejects(run("stage", { verifySource: async expected => {
    if (++count === 2) throw Error("Explorer lost after signing"); return sourceObserver(expected);
  } }), /lost after signing/);
  assert.equal(count, 2); assert.equal(signatures, 4); assert.equal(sends, 3);
  const attempt = JSON.parse(readFileSync(join(directory, "fund-attempt.json")));
  const evidence = JSON.parse(readFileSync(join(directory, "fund-source.json")));
  assert.equal(evidence.source.packageHash, canarySourcePackageHash);
  const noSource = { verifySource: async () => { throw Error("Must not call source for historical inspection"); } };
  for (const action of ["inspect", "deploy"]) {
    const pending = await run(action, noSource);
    assert.equal(pending.status, "unconfirmed-attempt"); assert.equal(pending.step, "fund");
    assert.equal(pending.transactionHash, attempt.transactionHash);
  }
  await assert.rejects(run("stage", { verifySource: async () => { throw Error("Still unavailable"); } }), /unavailable/);
  assert.equal(signatures, 4); assert.equal(sends, 3);
  staged = await run("stage");
  assert.equal(staged.status, "staged-review"); assert.equal(staged.fundedMON, "1");
  assert.equal(staged.allocatedMON, "0.5"); assert.equal(staged.walletlessReserveMON, "0.4"); assert.equal(staged.paidMON, "0");
  assert.equal(staged.receipts.find(r => r.id === "fund").transactionHash, attempt.transactionHash);
  assert.equal(signatures, 6); assert.equal(sends, 6);
  const previous = observations;
  assert.deepEqual(await run("stage", noSource), staged); assert.equal(observations, previous);
});

test("staging retry never broadcasts saved activation; 24h and source gate survive activation restart", async () => {
  const early = await run("activate"); assert.equal(early.status, "review-open");
  assert.equal(signatures, 6); assert.equal(sends, 6);
  await chain.testClient.setNextBlockTimestamp({ timestamp: BigInt(staged.reviewDeadline) });
  await chain.testClient.mine({ blocks: 96, interval: 1 });
  await assert.rejects(run("activate"), /interrupted before broadcast/);
  assert.equal(signatures, 7); assert.equal(sends, 6);
  const pending = await run("stage", { verifySource: async () => { throw Error("No source call for read-only later phase"); } });
  assert.equal(pending.step, "activate"); assert.equal(pending.status, "unconfirmed-attempt");
  assert.equal(signatures, 7); assert.equal(sends, 6);
  await assert.rejects(run("activate", { verifySource: async () => { throw Error("Source unavailable"); } }), /unavailable/);
  const active = await run("activate"); assert.equal(active.status, "active-awaiting-recipient-consent");
  assert.equal(active.paidMON, "0"); assert.equal(signatures, 7); assert.equal(sends, 7);
  const previous = observations;
  assert.deepEqual(await run("inspect", { verifySource: async () => { throw Error("History is independent of explorer availability"); } }), active);
  assert.equal(observations, previous);
  assert.equal(await chain.publicClient.getBalance({ address: execution.spec.context.verifyingContract }), parseEther("1"));
});

test("public CLI rejects missing approval, unknown flags and endpoint overrides before execution", async () => {
  for (const args of [["stage"], ["activate"], ["stage", "--approved-manifest", "not-approved"],
    ["activate", "--approved-manifest", `0x${"0".repeat(64)}`],
    ["stage", "--approved-manifest", execution.spec.programmeManifestHash, "--rpc-url", "https://example.invalid"],
    ["inspect-source", "--approve"]]) await assert.rejects(canaryCommand(args));
});
