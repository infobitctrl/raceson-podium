import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, after, test } from "node:test";
import { decodeEventLog, encodeFunctionData, getAddress, getContractAddress, keccak256, parseEther, toHex, zeroAddress } from "viem";
import { rewardCampaignV3Abi as abi, rewardAllocationCommitmentV3, rewardClaimMessagesV3, encodeRewardClaimV3,
  requireRewardReviewClockV3, verifyRewardClaimEoaProofV3 } from "../dist/campaign-v3.js";
import { rewardClaimMessagesV2 } from "../dist/campaign-v2.js";
import { requireRewardBuildArtifactV3, encodeRewardDeploymentV3, verifyRewardRuntimeV3,
  verifyRewardDeploymentV3, rewardCreationCodeFromTransactionV3 } from "../dist/deployment-v3.js";
import { readVerifiedRewardDeploymentV3 } from "../dist/deployment-reader-v3.js";
import { readVerifiedRewardAthleteClaimV3 } from "../dist/claim-reader-v3.js";
import { requireRewardCreationBytecodeV2 } from "../dist/deployment-v2.js";
import { startOwnedRewardChain, fixtureSigner } from "./owned-chain.mjs";

// Synthetic recipients and results on a fresh owned loopback chain only.
let chain, artifact, main, stage, claimCheckpoint;
const recipient = fixtureSigner(0xBA11), hash = n => toHex(BigInt(n), { size: 32 });
const budget = parseEther("0.1"), one = parseEther("0.01"), held = parseEther("0.04");
const read = (f, functionName, args = []) => chain.publicClient.readContract({ address: f.context.verifyingContract, abi, functionName, args });
async function receipt(pending, expected = "success") {
  const result = await chain.publicClient.waitForTransactionReceipt({ hash: await pending, timeout: 10000 });
  assert.equal(result.status, expected); return result;
}
const write = (f, functionName, args = [], options = {}) => receipt(chain.operatorClient.writeContract({
  address: f.context.verifyingContract, abi, functionName, args, ...options,
}));
const finalize = () => chain.testClient.mine({ blocks: 96, interval: 1 });
const claimExpectation = (f = main, staged = stage, entitlementId = hash(1)) => ({ protocolVersion: 3,
  deployment: f, upload: f.upload, stageTransactionHash: staged.transactionHash, entitlementId, recipient: recipient.address });
const observeClaim = (reader = chain.publicClient, input = claimExpectation()) =>
  readVerifiedRewardAthleteClaimV3(reader, input, artifact.bytecode.object);
async function deploy(period = 0n, enabledPot = 0) {
  const nonce = BigInt(await chain.publicClient.getTransactionCount({ address: chain.operator.address }));
  const spec = { context: { environment: "local-simulation", chainId: 31337,
    verifyingContract: getContractAddress({ from: chain.operator.address, nonce }) }, operatorAddress: chain.operator.address,
    treasuryAddress: chain.treasury, programmeId: hash(1000), campaignId: hash(1001), programmeManifestHash: hash(1002),
    enabledPot, reviewPeriod: period };
  const r = await receipt(chain.operatorClient.sendTransaction({ data: encodeRewardDeploymentV3(spec, artifact.bytecode.object) }));
  assert.equal(getAddress(r.contractAddress), spec.context.verifyingContract);
  const block = await chain.publicClient.getBlock({ blockTag: "latest" });
  const upload = rewardAllocationCommitmentV3({ ...spec, snapshotDigest: hash(1100), budget,
    reviewStartedAt: block.timestamp - period, officialPublishedAt: block.timestamp, publicationEvidenceHash: hash(1101), awards: [
      { entitlementId: hash(1), beneficiaryId: hash(11), pot: enabledPot, amount: one, explanationHash: hash(21), beneficiaryKind: 0 },
      { entitlementId: hash(2), beneficiaryId: hash(12), pot: enabledPot, amount: held, explanationHash: hash(22), beneficiaryKind: 0 },
    ] });
  return { ...spec, deploymentTransactionHash: r.transactionHash, deploymentNonce: nonce, receipt: r, upload };
}
const stageArgs = u => [u.snapshotDigest, u.uploadDigest, u.entitlementCount, u.reviewStartedAt, u.officialPublishedAt, u.publicationEvidenceHash];
before(async () => {
  chain = await startOwnedRewardChain();
  artifact = JSON.parse(readFileSync(new URL("../../../contracts/out/RacesOnRewardCampaignV3.sol/RacesOnRewardCampaignV3.json", import.meta.url)));
  requireRewardBuildArtifactV3(artifact);
  main = await deploy(); await finalize();
}, { timeout: 20000 });
after(async () => { await chain?.stop(); });

test("V3 direct deployment pins review policy, new domain and every immutable; legacy/mainnet/tampering fail", async () => {
  const c = chain.publicClient, f = await c.getBlock({ blockTag: "finalized" });
  const code = await c.getCode({ address: main.context.verifyingContract, blockNumber: f.number });
  const tx = await c.getTransaction({ hash: main.deploymentTransactionHash });
  const verified = await readVerifiedRewardDeploymentV3(c, main, artifact.bytecode.object);
  assert.equal(verified.runtimeCodeHash, keccak256(code));
  assert.equal(rewardCreationCodeFromTransactionV3(main, tx), artifact.bytecode.object);
  assert.equal(await read(main, "PROTOCOL_VERSION"), 3n); assert.equal(await read(main, "reviewPeriod"), 0n);
  assert.throws(() => requireRewardCreationBytecodeV2(artifact.bytecode.object));
  for (const change of [{ reviewPeriod: 86400n }, { treasuryAddress: recipient.address }, { operatorAddress: recipient.address },
    { campaignId: hash(999) }, { programmeManifestHash: hash(999) }, { enabledPot: 1 }]) {
    assert.throws(() => verifyRewardRuntimeV3({ ...main, ...change }, code));
  }
  assert.throws(() => encodeRewardDeploymentV3({ ...main, context: { ...main.context, chainId: 143 } }, artifact.bytecode.object));
  assert.throws(() => encodeRewardDeploymentV3({ ...main, reviewPeriod: 1n << 64n }, artifact.bytecode.object));
  for (const { start } of Object.values(artifact.deployedBytecode.immutableReferences).flat()) {
    const at = 2 + start * 2, byte = code.slice(at, at + 2) === "ff" ? "00" : "ff";
    assert.throws(() => verifyRewardRuntimeV3(main, code.slice(0, at) + byte + code.slice(at + 2)));
  }
  const o = { observedChainId: 31337, transaction: tx, receipt: main.receipt,
    canonicalDeploymentBlockHash: main.receipt.blockHash, finalizedBlock: f, runtimeCode: code };
  for (const mutate of [x => { x.receipt.status = "reverted"; }, x => { x.observedChainId = 143; },
    x => { x.transaction.input += "00"; }, x => { x.transaction.value = 1n; }, x => { x.transaction.nonce++; },
    x => { x.finalizedBlock.number = x.receipt.blockNumber - 1n; }, x => { x.canonicalDeploymentBlockHash = hash(999); }]) {
    const changed = structuredClone(o); mutate(changed);
    assert.throws(() => verifyRewardDeploymentV3(main, artifact.bytecode.object, changed));
  }
});

test("V3 funding/upload/staging matches TS and includes completed platform review evidence", async () => {
  await write(main, "completeFunding", [0n, budget], { value: budget });
  await write(main, "uploadAwards", [main.upload.awards]);
  stage = await write(main, "stageAllocation", stageArgs(main.upload));
  const block = await chain.publicClient.getBlock({ blockNumber: stage.blockNumber });
  assert.equal(await read(main, "allocationDigest"), main.upload.allocationDigest);
  assert.equal(await read(main, "uploadDigest"), main.upload.uploadDigest);
  assert.equal(await read(main, "publicationEvidenceHash"), main.upload.publicationEvidenceHash);
  const events = stage.logs.map(log => decodeEventLog({ abi, ...log }));
  assert.deepEqual(events.map(e => e.eventName), ["AllocationStaged", "FinalResultsApproved"]);
  assert.equal(events[1].args.officialPublishedAt, main.upload.officialPublishedAt);
  assert.equal(events[1].args.approvedAt, block.timestamp);
  requireRewardReviewClockV3({ ...main.upload, protocolVersion: 3n, stageBlockTimestamp: block.timestamp,
    activationNotBefore: await read(main, "activationNotBefore") });
  assert.equal(await read(main, "paid", [0n]), 0n);
  await finalize();
  await assert.rejects(observeClaim(), e => e.code === "reward_claim_campaign_unavailable");
});

test("official result approval permits activation immediately without a second 24-hour timer", async () => {
  // Only the short finalized-observation gap above, never a second review day.
  const r = await write(main, "activate", [main.upload.allocationDigest, main.upload.snapshotDigest]);
  const b = await chain.publicClient.getBlock({ blockNumber: r.blockNumber });
  assert.equal(await read(main, "claimDeadline"), b.timestamp + 31536000n);
  assert.equal(await read(main, "state"), 3);
  assert.equal(await read(main, "paid", [0n]), 0n);
  assert.ok(b.timestamp < main.upload.officialPublishedAt + 86400n);
});

test("V3 claim reader binds both approval events and all getters to one finalized checkpoint", async () => {
  await finalize();
  const reads = [], c = chain.publicClient;
  claimCheckpoint = await observeClaim({ ...c,
    readContract: async args => { reads.push(args.blockNumber); return c.readContract(args); },
    getBalance: async args => { reads.push(args.blockNumber); return c.getBalance(args); },
    getCode: async args => { reads.push(args.blockNumber); return c.getCode(args); },
  });
  assert.equal(claimCheckpoint.protocolVersion, 3); assert.equal(claimCheckpoint.deployment.protocolVersion, 3);
  assert.equal(claimCheckpoint.observation.protocolVersion, 3);
  const { review, finalizedBlock: f, accounting } = claimCheckpoint.observation;
  const stageBlock = await c.getBlock({ blockNumber: stage.blockNumber });
  assert.deepEqual(review, { reviewPeriod: 0n, reviewStartedAt: main.upload.reviewStartedAt,
    officialPublishedAt: main.upload.officialPublishedAt, publicationEvidenceHash: main.upload.publicationEvidenceHash,
    activationNotBefore: stageBlock.timestamp, stageTransactionHash: stage.transactionHash,
    stageBlockNumber: stage.blockNumber, stageBlockHash: stage.blockHash });
  assert.ok(f.timestamp >= stageBlock.timestamp && f.timestamp < main.upload.officialPublishedAt + 86400n);
  assert.ok(reads.length > 20 && reads.every(n => n === f.number));
  assert.equal(claimCheckpoint.award.amount, one); assert.equal(claimCheckpoint.award.nonce, 0n);
  assert.equal(claimCheckpoint.award.paid, false); assert.equal(accounting.accountedFunding, budget);
  assert.equal(accounting.allocated[0], one + held); assert.equal(accounting.paid[0], 0n);
  const reserved = await observeClaim(c, claimExpectation(main, stage, hash(2)));
  assert.equal(reserved.award.amount, held); assert.equal(reserved.award.paid, false);
  const input = structuredClone(claimExpectation()); let changed = false;
  const captured = await observeClaim({ ...c, getChainId: async () => {
    if (!changed) { changed = true; input.protocolVersion = 2; input.upload.awards[0].amount++;
      input.upload.officialPublishedAt++; input.upload.publicationEvidenceHash = hash(999);
      input.deployment.reviewPeriod++; input.recipient = chain.treasury; input.stageTransactionHash = hash(999); }
    return c.getChainId();
  } }, input);
  assert.equal(captured.award.amount, one); assert.equal(captured.recipient, recipient.address.toLowerCase());
  assert.deepEqual(captured.observation.review, review);
});

test("V3 claim reader rejects altered publication/package, award state and EOA delegation", async () => {
  const c = chain.publicClient;
  const changedRead = (name, value) => ({ ...c, readContract: async args => {
    const original = await c.readContract(args);
    return args.functionName === name ? (typeof value === "function" ? value(original, args) : value) : original;
  } });
  for (const [name, value, code] of [
    ["claimDeadline", claimCheckpoint.observation.finalizedBlock.timestamp, "reward_claim_campaign_unavailable"],
    ["snapshotDigest", hash(999), "reward_claim_package_mismatch"],
    ["allocationDigest", hash(999), "reward_claim_package_mismatch"],
    ["uploadDigest", hash(999), "reward_claim_package_mismatch"],
    ["entitlementCount", 3n, "reward_claim_package_mismatch"],
    ["PROTOCOL_VERSION", 2n, "wrong_reward_review_protocol"],
    ["reviewPeriod", 86400n, "reward_review_not_completed"],
    ["reviewStartedAt", main.upload.reviewStartedAt - 1n, "reward_claim_publication_mismatch"],
    ["officialPublishedAt", main.upload.officialPublishedAt - 1n, "reward_review_not_completed"],
    ["publicationEvidenceHash", hash(999), "reward_claim_publication_mismatch"],
    ["activationNotBefore", claimCheckpoint.observation.review.activationNotBefore + 1n, "invalid_reward_v3_review_anchor"],
    ["entitlements", [], "reward_claim_award_mismatch"],
  ]) await assert.rejects(observeClaim(changedRead(name, value)), e => e.code === code);
  for (const [index, value, code] of [[0, hash(999), "reward_claim_award_mismatch"], [1, one + 1n, "reward_claim_award_mismatch"],
    [2, hash(999), "reward_claim_award_mismatch"], [3, (1n << 256n) - 1n, "reward_claim_nonce_exhausted"],
    [3, -1n, "invalid_reward_uint"], [4, recipient.address, "reward_claim_already_paid"], [5, 1, "reward_claim_award_mismatch"],
    [6, true, "reward_claim_already_paid"], [7, 1, "reward_claim_award_mismatch"]]) {
    await assert.rejects(observeClaim(changedRead("entitlements", row => row.map((v, i) => i === index ? value : v))), e => e.code === code);
  }
  for (const [address, code] of [[main.operatorAddress, "reward_claim_eoa_operator_required"], [recipient.address, "reward_claim_eoa_recipient_required"]]) {
    await assert.rejects(observeClaim({ ...c, getCode: args => args.address === address
      ? Promise.resolve("0xef0100" + "11".repeat(20)) : c.getCode(args) }), e => e.code === code);
  }
});

test("V3 claim reader refuses missing/reordered/tampered approval logs and staging calldata", async () => {
  const c = chain.publicClient;
  const mutations = [r => { r.status = "reverted"; }, r => { r.transactionHash = hash(999); }, r => { r.transactionIndex++; },
    r => { r.logs.pop(); }, r => { r.logs.shift(); }, r => { r.logs.reverse(); }, r => { r.logs.push(r.logs[0]); }];
  for (const i of [0, 1]) for (const mutate of [l => { l.removed = true; }, l => { l.logIndex = null; },
    l => { l.logIndex++; }, l => { l.data = "0x"; }, l => { l.topics[1] = hash(999); },
    l => { l.address = chain.treasury; }, l => { l.blockHash = hash(999); }, l => { l.transactionHash = hash(999); },
    l => { l.transactionIndex++; }, l => { l.blockNumber++; }]) mutations.push(r => mutate(r.logs[i]));
  for (const mutate of mutations) await assert.rejects(observeClaim({ ...c, getTransactionReceipt: async args => {
    const r = structuredClone(await c.getTransactionReceipt(args)); if (args.hash === stage.transactionHash) mutate(r); return r;
  } }));
  for (const mutate of [tx => { tx.input += "00"; }, tx => { tx.value = 1n; }, tx => { tx.chainId = 143; },
    tx => { tx.to = chain.treasury; }, tx => { tx.from = chain.treasury; }, tx => { tx.nonce = Number(main.deploymentNonce); },
    tx => { const args = stageArgs(main.upload); args[3]--; tx.input = encodeFunctionData({ abi, functionName: "stageAllocation", args }); },
    tx => { const args = stageArgs(main.upload); args[5] = hash(999); tx.input = encodeFunctionData({ abi, functionName: "stageAllocation", args }); },
  ]) await assert.rejects(observeClaim({ ...c, getTransaction: async args => {
    const tx = { ...await c.getTransaction(args) }; if (args.hash === stage.transactionHash) mutate(tx); return tx;
  } }));
});

test("V3 claim reader rejects chain/finality drift, sanitizes provider errors and observes actual pauses", async () => {
  const c = chain.publicClient;
  let stateRead = false;
  await assert.rejects(observeClaim({ ...c, readContract: async args => { stateRead = true; return c.readContract(args); },
    getChainId: () => stateRead ? Promise.resolve(143) : c.getChainId() }), e => e.code === "reward_observed_chain_mismatch");
  for (const checkpoint of ["finality", "time", "finalized", "stage", "deployment"]) {
    let lastChecks = false;
    await assert.rejects(observeClaim({ ...c, getBlock: async args => {
      const b = await c.getBlock(args);
      if (args.blockNumber === stage.blockNumber && !lastChecks) { lastChecks = true; return b; }
      if (!lastChecks) return b;
      if (checkpoint === "finality" && args.blockTag === "finalized") return { ...b, number: 0n };
      if (checkpoint === "time" && args.blockTag === "finalized") return { ...b, timestamp: 0n };
      const target = checkpoint === "stage" ? stage.blockNumber : checkpoint === "deployment" ? main.receipt.blockNumber
        : claimCheckpoint.observation.finalizedBlock.number;
      return args.blockNumber === target ? { ...b, hash: hash(999) } : b;
    } }), e => e.code === (["finality", "time"].includes(checkpoint) ? "reward_finality_regressed" : "reward_chain_changed_during_observation"));
  }
  await assert.rejects(observeClaim({ ...c, readContract: async () => { throw Error("private RPC URL and credential"); } }),
    e => e.code === "reward_claim_observation_unavailable" && !e.cause && !String(e).includes("private"));
  await write(main, "pause"); await finalize();
  await assert.rejects(observeClaim(), e => e.code === "reward_claim_campaign_unavailable");
  await write(main, "resume"); await finalize();
  claimCheckpoint = await observeClaim();
});

test("V3 real local relayer pays an EOA once, rejects old domain, retains the walletless share", async () => {
  claimCheckpoint = await observeClaim();
  const now = claimCheckpoint.observation.finalizedBlock.timestamp, beforeBalance = await chain.publicClient.getBalance({ address: recipient.address });
  const claim = { entitlementId: claimCheckpoint.award.entitlementId, recipient: claimCheckpoint.recipient,
    amount: claimCheckpoint.award.amount, pot: claimCheckpoint.award.pot === 0 ? "race" : "league", nonce: claimCheckpoint.award.nonce,
    issuedAt: now, expiresAt: now + 3600n, allocationDigest: claimCheckpoint.observation.accounting.allocationDigest };
  const messages = rewardClaimMessagesV3(main.context, claim);
  assert.equal(messages.authorization.domain.version, "4");
  const operator = await chain.operator.signTypedData(messages.authorization), consent = await recipient.signTypedData(messages.consent);
  const proof = await verifyRewardClaimEoaProofV3(main.context, claim, "recipient", chain.operator.address, consent);
  assert.equal(proof.protocolVersion, 3);
  const approval = await verifyRewardClaimEoaProofV3(main.context, claim, "operator", chain.operator.address, operator);
  assert.equal(approval.protocolVersion, 3);
  const old = await chain.operator.signTypedData(rewardClaimMessagesV2(main.context, claim).authorization);
  await assert.rejects(verifyRewardClaimEoaProofV3(main.context, claim, "operator", chain.operator.address, old));
  const data = encodeRewardClaimV3(main.context, claim, { operator: approval.signature, recipient: proof.signature });
  const paidReceipt = await receipt(chain.relayerClient.sendTransaction({ to: main.context.verifyingContract, data }));
  await finalize();
  assert.ok((await chain.publicClient.getBlock({ blockTag: "finalized" })).number >= paidReceipt.blockNumber);
  assert.equal((await chain.publicClient.getBlock({ blockNumber: paidReceipt.blockNumber })).hash, paidReceipt.blockHash);
  assert.equal(await chain.publicClient.getBalance({ address: recipient.address }), beforeBalance + one);
  assert.equal(await read(main, "paid", [0n]), one);
  assert.equal(await chain.publicClient.getBalance({ address: main.context.verifyingContract }), budget - one);
  const reserved = await read(main, "entitlements", [hash(2)]);
  assert.equal(reserved[1], held); assert.equal(reserved[4], zeroAddress); assert.equal(reserved[6], false);
  await assert.rejects(observeClaim(), e => e.code === "reward_claim_already_paid");
  const reserve = await observeClaim(chain.publicClient, claimExpectation(main, stage, hash(2)));
  assert.equal(reserve.award.amount, held); assert.equal(reserve.award.paid, false);
  await write(main, "revokeAuthorization", [hash(2)]); await finalize();
  const revoked = await observeClaim(chain.publicClient, claimExpectation(main, stage, hash(2)));
  assert.equal(revoked.award.nonce, 1n); assert.equal(revoked.award.amount, held);
  await assert.rejects(chain.publicClient.estimateGas({ account: chain.relayer.address, to: main.context.verifyingContract, data }));
});

test("nonzero configurable policy rejects early final publication and accepts completed historical review without new wait", async () => {
  for (const period of [3600n, 86400n, 172800n]) {
    const other = await deploy(period, 1);
    await write(other, "completeFunding", [0n, budget], { value: budget });
    await write(other, "uploadAwards", [other.upload.awards]);
    const early = stageArgs(other.upload); early[3] += 1n;
    await assert.rejects(chain.publicClient.estimateGas({ account: chain.operator.address, to: other.context.verifyingContract,
      data: encodeFunctionData({ abi, functionName: "stageAllocation", args: early }) }));
    const staged = await write(other, "stageAllocation", stageArgs(other.upload));
    await write(other, "activate", [other.upload.allocationDigest, other.upload.snapshotDigest]);
    assert.equal(await read(other, "state"), 3);
    assert.equal(await read(other, "paid", [1n]), 0n);
    await finalize();
    const observed = await observeClaim(chain.publicClient, claimExpectation(other, staged));
    assert.equal(observed.observation.review.reviewPeriod, period);
    assert.equal(observed.award.pot, 1); assert.equal(observed.observation.accounting.budgets[1], budget);
    assert.ok(observed.observation.finalizedBlock.timestamp < other.upload.officialPublishedAt + 86400n);
    // A still-completed but DIFFERENT policy/publication must not be accepted.
    for (const [name, value] of [["reviewPeriod", period - 1n], ["officialPublishedAt", other.upload.officialPublishedAt - 1n]]) {
      const reader = { ...chain.publicClient, readContract: async args => {
        const original = await chain.publicClient.readContract(args);
        return args.functionName === name ? value : original;
      } };
      await assert.rejects(observeClaim(reader, claimExpectation(other, staged)), e =>
        e.code === (name === "reviewPeriod" ? "reward_claim_publication_mismatch" : "reward_review_not_completed"));
    }
  }
});

test("publication policy/evidence corrections change commitments and invalid timestamps cannot encode", () => {
  const input = { ...main.upload, budget };
  for (const change of [{ reviewStartedAt: input.reviewStartedAt - 1n },
    { officialPublishedAt: input.officialPublishedAt + 1n }, { publicationEvidenceHash: hash(1111) },
    { snapshotDigest: hash(1111) }, { reviewPeriod: 1n, reviewStartedAt: input.reviewStartedAt - 1n }]) {
    assert.notEqual(rewardAllocationCommitmentV3({ ...input, ...change }).allocationDigest, input.allocationDigest);
  }
  for (const change of [{ reviewPeriod: -1n }, { reviewPeriod: 1n << 64n }, { reviewStartedAt: 0n },
    { reviewStartedAt: input.officialPublishedAt + 1n }, { publicationEvidenceHash: hash(0) }]) {
    assert.throws(() => rewardAllocationCommitmentV3({ ...input, ...change }));
  }
});
