import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, after, test } from "node:test";
import { decodeEventLog, getAddress, getContractAddress, keccak256, parseEther, toHex, zeroAddress } from "viem";
import { rewardAllocationCommitment } from "../dist/allocation.js";
import { rewardClaimMessages } from "../dist/claims.js";
import { rewardCampaignV2Abi as abi, rewardClaimMessagesV2, rewardClaimDigestsV2, encodeRewardClaimV2,
  requireRewardReviewClockV2, safeRewardConsentMessageV2, verifyRewardClaimEoaProofV2 } from "../dist/campaign-v2.js";
import { requireRewardBuildArtifactV2, encodeRewardDeploymentV2, verifyRewardRuntimeV2,
  verifyRewardDeploymentV2, rewardCreationCodeFromTransactionV2 } from "../dist/deployment-v2.js";
import { readVerifiedRewardDeploymentV2 } from "../dist/deployment-reader-v2.js";
import { readVerifiedRewardAthleteClaimV2 } from "../dist/claim-reader-v2.js";
import { requireRewardCreationBytecode, verifyRewardRuntime } from "../dist/deployment.js";
import { startOwnedRewardChain, fixtureSigner } from "./owned-chain.mjs";
import { deployOriginalClubSafeFixture } from "./safe-deployment-fixture.mjs";

// All identities/data below are synthetic, exclusively on an owned non-forked
// loopback chain. No wallet loader, network setting or public-chain key is used.
let chain, artifact, main, staged, claim, proof, safe, claimCheckpoint;
const recipient = fixtureSigner(0xBA11), hash = n => toHex(BigInt(n), { size: 32 });
const budget = parseEther("1"), one = parseEther("0.1"), held = parseEther("0.4");
const read = (f, functionName, args = [], blockNumber) => chain.publicClient.readContract({ address: f.context.verifyingContract, abi, functionName, args, ...(blockNumber === undefined ? {} : { blockNumber }) });
async function receipt(tx, expected = "success") {
  const r = await chain.publicClient.waitForTransactionReceipt({ hash: await tx, timeout: 10_000 });
  assert.equal(r.status, expected); return r;
}
async function write(f, name, args = [], options = {}) {
  return receipt(chain.operatorClient.writeContract({ address: f.context.verifyingContract, abi, functionName: name, args, ...options }));
}
const finalize = () => chain.testClient.mine({ blocks: 96, interval: 1 });
const claimExpectation = () => ({ protocolVersion: 2, deployment: main, upload: main.upload,
  stageTransactionHash: staged.receipt.transactionHash, entitlementId: hash(1), recipient: recipient.address });
const observeClaim = (reader = chain.publicClient, input = claimExpectation()) =>
  readVerifiedRewardAthleteClaimV2(reader, input, artifact.bytecode.object);
async function deploy(label, enabledPot = 0, awards = null) {
  const nonce = BigInt(await chain.publicClient.getTransactionCount({ address: chain.operator.address }));
  const spec = { context: { environment: "local-simulation", chainId: 31337,
    verifyingContract: getContractAddress({ from: chain.operator.address, nonce }) }, operatorAddress: chain.operator.address,
    treasuryAddress: chain.treasury, programmeId: hash(1000), campaignId: hash(label), programmeManifestHash: hash(1002), enabledPot };
  const data = encodeRewardDeploymentV2(spec, artifact.bytecode.object);
  const r = await receipt(chain.operatorClient.sendTransaction({ data }));
  const f = { ...spec, deploymentTransactionHash: r.transactionHash, deploymentNonce: nonce };
  assert.equal(getAddress(r.contractAddress), f.context.verifyingContract);
  const block = await chain.publicClient.getBlock({ blockTag: "latest" });
  const rows = awards ?? [
    { entitlementId: hash(1), beneficiaryId: hash(11), pot: enabledPot, amount: one, explanationHash: hash(21), beneficiaryKind: 0 },
    { entitlementId: hash(2), beneficiaryId: hash(12), pot: enabledPot, amount: held, explanationHash: hash(22), beneficiaryKind: 0 },
  ];
  const upload = rewardAllocationCommitment({ ...spec, snapshotDigest: hash(label + 100), budget,
    latestPublicationAt: block.timestamp - 1n, awards: rows });
  return { ...f, upload, receipt: r };
}
async function observation(f) {
  const c = chain.publicClient, r = await c.getTransactionReceipt({ hash: f.deploymentTransactionHash });
  const b = await c.getBlock({ blockNumber: r.blockNumber }), final = await c.getBlock({ blockTag: "finalized" });
  return { observedChainId: 31337, transaction: await c.getTransaction({ hash: r.transactionHash }), receipt: r,
    canonicalDeploymentBlockHash: b.hash, finalizedBlock: { number: final.number, hash: final.hash, timestamp: final.timestamp },
    runtimeCode: await c.getCode({ address: f.context.verifyingContract, blockNumber: final.number }) };
}
before(async () => {
  chain = await startOwnedRewardChain();
  artifact = JSON.parse(readFileSync(new URL("../../../contracts/out/RacesOnRewardCampaignV2.sol/RacesOnRewardCampaignV2.json", import.meta.url), "utf8"));
  requireRewardBuildArtifactV2(artifact);
  main = await deploy(1001); await finalize();
}, { timeout: 20_000 });
after(async () => { await chain?.stop(); });

test("V2 direct deployment pins every runtime byte/immutable and refuses V1, mainnet and forged receipts", async () => {
  const o = await observation(main);
  const verified = await readVerifiedRewardDeploymentV2(chain.publicClient, main, artifact.bytecode.object);
  assert.equal(verified.runtimeCodeHash, keccak256(o.runtimeCode));
  assert.equal(rewardCreationCodeFromTransactionV2(main, o.transaction), artifact.bytecode.object);
  assert.equal(await read(main, "PROTOCOL_VERSION"), 2n); assert.equal(await read(main, "REVIEW_PERIOD"), 86400n);
  assert.throws(() => requireRewardCreationBytecode(artifact.bytecode.object));
  assert.throws(() => verifyRewardRuntime(main, o.runtimeCode));
  assert.throws(() => encodeRewardDeploymentV2({ ...main, context: { ...main.context, chainId: 143 } }, artifact.bytecode.object));
  for (const change of [{ treasuryAddress: recipient.address }, { operatorAddress: recipient.address }, { campaignId: hash(999) },
    { programmeManifestHash: hash(999) }, { enabledPot: 1 }]) assert.throws(() => verifyRewardRuntimeV2({ ...main, ...change }, o.runtimeCode));
  const refs = Object.values(artifact.deployedBytecode.immutableReferences).flat();
  for (const { start } of refs) {
    const at = 2 + start * 2, byte = o.runtimeCode.slice(at, at + 2) === "ff" ? "00" : "ff";
    assert.throws(() => verifyRewardRuntimeV2(main, o.runtimeCode.slice(0, at) + byte + o.runtimeCode.slice(at + 2)));
  }
  for (const mutate of [x => { x.runtimeCode = "0x00"; }, x => { x.observedChainId = 143; },
    x => { x.receipt.status = "reverted"; }, x => { x.receipt.contractAddress = recipient.address; },
    x => { x.transaction.input += "00"; }, x => { x.transaction.value = 1n; }, x => { x.transaction.nonce++; },
    x => { x.finalizedBlock.number = x.receipt.blockNumber - 1n; }, x => { x.canonicalDeploymentBlockHash = hash(888); }]) {
    const changed = structuredClone(o); mutate(changed); assert.throws(() => verifyRewardDeploymentV2(main, artifact.bytecode.object, changed));
  }
  let reads = 0;
  await assert.rejects(readVerifiedRewardDeploymentV2({ ...chain.publicClient, getBlock: async args => {
    const b = await chain.publicClient.getBlock(args);
    return args.blockNumber === main.receipt.blockNumber && ++reads === 2 ? { ...b, hash: hash(666) } : b;
  } }, main, artifact.bytecode.object), e => e.code === "reward_chain_changed_during_observation");
  await assert.rejects(readVerifiedRewardDeploymentV2({ ...chain.publicClient, getCode: async () => { throw Error("private RPC detail"); } }, main,
    artifact.bytecode.object), e => e.code === "reward_deployment_observation_unavailable" && !e.cause && !String(e).includes("private"));
});

test("exact funded budget and upload match TypeScript, with no wallet needed for the retained award", async () => {
  await write(main, "completeFunding", [0n, budget], { value: budget });
  await write(main, "uploadAwards", [main.upload.awards]);
  assert.equal(await read(main, "budgets", [0n]), budget); assert.equal(await read(main, "allocated", [0n]), one + held);
  assert.equal(await read(main, "uploadDigest"), main.upload.uploadDigest);
  const reserved = await read(main, "entitlements", [hash(2)]);
  assert.equal(reserved[1], held); assert.equal(reserved[4], zeroAddress); assert.equal(reserved[6], false);
  const r = await write(main, "stageAllocation", [main.upload.snapshotDigest, main.upload.uploadDigest,
    main.upload.entitlementCount, main.upload.latestPublicationAt]);
  const block = await chain.publicClient.getBlock({ blockNumber: r.blockNumber });
  staged = { receipt: r, start: block.timestamp, deadline: block.timestamp + 86400n };
  assert.equal(await read(main, "allocationDigest"), main.upload.allocationDigest);
  requireRewardReviewClockV2({ protocolVersion: await read(main, "PROTOCOL_VERSION"), period: await read(main, "REVIEW_PERIOD"),
    reviewStartedAt: await read(main, "reviewStartedAt"), stageBlockTimestamp: block.timestamp,
    activationNotBefore: await read(main, "activationNotBefore"), latestPublicationAt: main.upload.latestPublicationAt });
  const event = decodeEventLog({ abi, ...r.logs[0] });
  assert.equal(event.eventName, "AllocationStaged"); assert.equal(event.args.activationNotBefore, staged.deadline);
  await finalize();
  await assert.rejects(observeClaim(), e => e.code === "reward_claim_campaign_unavailable");
});

test("recent source does not add 72h: activation fails one second early and succeeds exactly at 24h", async () => {
  // Advancing time is ONLY available on this owned local simulator, never testnet.
  await chain.testClient.setNextBlockTimestamp({ timestamp: staged.deadline - 1n });
  await receipt(chain.operatorClient.writeContract({ address: main.context.verifyingContract, abi, functionName: "activate",
    args: [main.upload.allocationDigest, main.upload.snapshotDigest], gas: 1_000_000n }), "reverted");
  assert.equal(await read(main, "state"), 2);
  await chain.testClient.setNextBlockTimestamp({ timestamp: staged.deadline });
  const r = await write(main, "activate", [main.upload.allocationDigest, main.upload.snapshotDigest], { gas: 1_000_000n });
  assert.equal((await chain.publicClient.getBlock({ blockNumber: r.blockNumber })).timestamp, staged.deadline);
  assert.equal(await read(main, "claimDeadline"), staged.deadline + 31536000n);
  assert.equal(await read(main, "state"), 3);
});

test("V2 claim reader binds actual deployment, staging receipt, one 24h review and full unpaid package at one finalized block", async () => {
  await finalize();
  const reads = [];
  const reader = { ...chain.publicClient,
    readContract: async args => { reads.push(args.blockNumber); return chain.publicClient.readContract(args); },
    getBalance: async args => { reads.push(args.blockNumber); return chain.publicClient.getBalance(args); },
    getCode: async args => { reads.push(args.blockNumber); return chain.publicClient.getCode(args); },
  };
  claimCheckpoint = await observeClaim(reader);
  assert.equal(claimCheckpoint.protocolVersion, 2); assert.equal(claimCheckpoint.deployment.protocolVersion, 2);
  assert.equal(claimCheckpoint.observation.protocolVersion, 2);
  const { review, finalizedBlock: f, accounting } = claimCheckpoint.observation;
  assert.deepEqual(review, { reviewStartedAt: staged.start, activationNotBefore: staged.deadline,
    stageTransactionHash: staged.receipt.transactionHash, stageBlockNumber: staged.receipt.blockNumber, stageBlockHash: staged.receipt.blockHash });
  assert.ok(f.timestamp >= staged.deadline && f.timestamp < main.upload.latestPublicationAt + 259200n);
  assert.ok(reads.length > 20 && reads.every(n => n === f.number));
  assert.equal(claimCheckpoint.recipient, recipient.address.toLowerCase());
  assert.equal(claimCheckpoint.award.nonce, 0n); assert.equal(claimCheckpoint.award.amount, one);
  assert.equal(claimCheckpoint.award.paid, false); assert.equal(accounting.accountedFunding, budget);
  assert.equal(accounting.allocated[0], one + held); assert.equal(accounting.paid[0], 0n);
  // One independently held award is still inspectable without having any key or
  // wallet assigned to its beneficiary; this supplied address is not persisted.
  const reserve = await observeClaim(chain.publicClient, { ...claimExpectation(), entitlementId: hash(2) });
  assert.equal(reserve.award.amount, held); assert.equal(reserve.award.paid, false);
  const input = claimExpectation(); input.deployment = structuredClone(main); input.upload = structuredClone(main.upload);
  let changed = false;
  const captured = await observeClaim({ ...chain.publicClient, getChainId: async () => {
    if (!changed) { changed = true; input.protocolVersion = 1; input.upload.awards[0].amount++; input.recipient = chain.treasury;
      input.stageTransactionHash = hash(999); input.deployment.context.chainId = 143; }
    return chain.publicClient.getChainId();
  } }, input);
  assert.equal(captured.award.amount, one); assert.equal(captured.recipient, recipient.address.toLowerCase());
});

test("V2 claim reader rejects altered state, award, stage evidence, code, finality and provider errors", async () => {
  const c = chain.publicClient;
  const failing = async (reader, code) => assert.rejects(observeClaim(reader), e => e.code === code);
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
    ["REVIEW_PERIOD", 259200n, "wrong_reward_review_protocol"],
    ["PROTOCOL_VERSION", 1n, "wrong_reward_review_protocol"],
    ["reviewStartedAt", staged.start - 1n, "invalid_reward_v2_review_anchor"],
    ["activationNotBefore", staged.deadline + 1n, "invalid_reward_v2_review_anchor"],
    ["entitlements", [], "reward_claim_award_mismatch"],
  ]) await failing(changedRead(name, value), code);
  for (const [index, value, code] of [[0, hash(999), "reward_claim_award_mismatch"], [1, one + 1n, "reward_claim_award_mismatch"],
    [2, hash(999), "reward_claim_award_mismatch"], [3, (1n << 256n) - 1n, "reward_claim_nonce_exhausted"],
    [3, -1n, "invalid_reward_uint"], [4, recipient.address, "reward_claim_already_paid"], [5, 1, "reward_claim_award_mismatch"],
    [6, true, "reward_claim_already_paid"], [7, 1, "reward_claim_award_mismatch"]]) {
    await failing(changedRead("entitlements", row => row.map((v, i) => i === index ? value : v)), code);
  }
  for (const [address, code] of [[main.operatorAddress, "reward_claim_eoa_operator_required"], [recipient.address, "reward_claim_eoa_recipient_required"]]) {
    await failing({ ...c, getCode: args => args.address === address ? Promise.resolve("0xef0100" + "11".repeat(20)) : c.getCode(args) }, code);
  }
  for (const mutate of [r => { r.status = "reverted"; }, r => { r.transactionHash = hash(999); }, r => { r.transactionIndex++; },
    r => { r.logs = []; }, r => { r.logs.push(r.logs[0]); }, r => { r.logs[0].removed = true; },
    r => { r.logs[0].data = "0x"; }, r => { r.logs[0].topics[1] = hash(999); }, r => { r.logs[0].address = chain.treasury; },
    r => { r.logs[0].blockHash = hash(999); }, r => { r.logs[0].transactionHash = hash(999); }]) {
    await assert.rejects(observeClaim({ ...c, getTransactionReceipt: async args => {
      const r = structuredClone(await c.getTransactionReceipt(args)); if (args.hash === staged.receipt.transactionHash) mutate(r); return r;
    } }));
  }
  for (const mutate of [tx => { tx.input += "00"; }, tx => { tx.value = 1n; }, tx => { tx.chainId = 143; },
    tx => { tx.to = chain.treasury; }, tx => { tx.from = chain.treasury; }, tx => { tx.nonce = Number(main.deploymentNonce); }]) {
    await assert.rejects(observeClaim({ ...c, getTransaction: async args => {
      const tx = { ...await c.getTransaction(args) }; if (args.hash === staged.receipt.transactionHash) mutate(tx); return tx;
    } }));
  }
  // Change the chain AFTER deployment verification, during the award reads.
  let stateRead = false;
  await failing({ ...c, readContract: async args => { stateRead = true; return c.readContract(args); },
    getChainId: () => stateRead ? Promise.resolve(143) : c.getChainId() }, "reward_observed_chain_mismatch");
  for (const checkpoint of ["finality", "finalized", "stage", "deployment"]) {
    let lastChecks = false;
    await failing({ ...c, getCode: async args => c.getCode(args), getBlock: async args => {
      const b = await c.getBlock(args);
      // The first historical staging read precedes the final five rechecks.
      if (args.blockNumber === staged.receipt.blockNumber && !lastChecks) { lastChecks = true; return b; }
      if (!lastChecks) return b;
      if (checkpoint === "finality" && args.blockTag === "finalized") return { ...b, number: 0n };
      const target = checkpoint === "stage" ? staged.receipt.blockNumber : checkpoint === "deployment" ? main.receipt.blockNumber
        : claimCheckpoint.observation.finalizedBlock.number;
      return args.blockNumber === target ? { ...b, hash: hash(999) } : b;
    } }, checkpoint === "finality" ? "reward_finality_regressed" : "reward_chain_changed_during_observation");
  }
  await assert.rejects(observeClaim({ ...c, readContract: async () => { throw Error("private RPC URL and credential"); } }),
    e => e.code === "reward_claim_observation_unavailable" && !e.cause && !String(e).includes("private"));
  // Actual pause/unpause, not only a mock getter. Local chain exclusively.
  await write(main, "pause"); await finalize();
  await assert.rejects(observeClaim(), e => e.code === "reward_claim_campaign_unavailable");
  await write(main, "resume"); await finalize();
  claimCheckpoint = await observeClaim();
});

test("V2 EIP-712 digests match Solidity; old-domain and changed-recipient proofs cannot pay", async () => {
  const now = (await chain.publicClient.getBlock({ blockTag: "latest" })).timestamp;
  claimCheckpoint = await observeClaim();
  claim = { entitlementId: claimCheckpoint.award.entitlementId, recipient: claimCheckpoint.recipient, amount: claimCheckpoint.award.amount,
    pot: claimCheckpoint.award.pot === 0 ? "race" : "league", nonce: claimCheckpoint.award.nonce,
    issuedAt: now, expiresAt: now + 3600n, allocationDigest: claimCheckpoint.observation.accounting.allocationDigest };
  const digests = rewardClaimDigestsV2(main.context, claim), messages = rewardClaimMessagesV2(main.context, claim);
  assert.deepEqual(await read(main, "claimDigests", [claim.entitlementId, claim.recipient, 0n, now, claim.expiresAt]),
    [digests.authorization, digests.consent]);
  const old = rewardClaimMessages(main.context, claim);
  proof = { operator: await chain.operator.signTypedData(messages.authorization), recipient: await recipient.signTypedData(messages.consent) };
  const bad = { operator: await chain.operator.signTypedData(old.authorization), recipient: await recipient.signTypedData(old.consent) };
  for (const [role, digest] of [["operator", digests.authorization], ["recipient", digests.consent]]) {
    const verified = await verifyRewardClaimEoaProofV2(main.context, claim, role, chain.operator.address, proof[role]);
    assert.equal(verified.protocolVersion, 2); assert.equal(verified.digest, digest);
    proof[role] = verified.signature; // The subsequent real local payout uses these exact verified bytes.
    await assert.rejects(verifyRewardClaimEoaProofV2(main.context, claim, role, chain.operator.address, bad[role]));
  }
  await receipt(chain.relayerClient.sendTransaction({ to: main.context.verifyingContract, gas: 1_000_000n,
    data: encodeRewardClaimV2(main.context, claim, bad) }), "reverted");
  await receipt(chain.relayerClient.sendTransaction({ to: main.context.verifyingContract, gas: 1_000_000n,
    data: encodeRewardClaimV2(main.context, { ...claim, recipient: chain.treasury }, proof) }), "reverted");
  assert.equal(await read(main, "paid", [0n]), 0n);
});

test("gas-sponsored exact payout has a real receipt; replay cannot pay twice or consume the walletless reserve", async () => {
  const balance = await chain.publicClient.getBalance({ address: recipient.address });
  const data = encodeRewardClaimV2(main.context, claim, proof);
  const r = await receipt(chain.relayerClient.sendTransaction({ to: main.context.verifyingContract, data }));
  await finalize();
  const final = await chain.publicClient.getBlock({ blockTag: "finalized" }); assert.ok(final.number >= r.blockNumber);
  assert.equal((await chain.publicClient.getBlock({ blockNumber: r.blockNumber })).hash, r.blockHash);
  assert.equal(await chain.publicClient.getBalance({ address: recipient.address }), balance + one);
  assert.equal(await read(main, "paid", [0n]), one);
  assert.equal(await chain.publicClient.getBalance({ address: main.context.verifyingContract }), budget - one);
  const event = decodeEventLog({ abi, ...r.logs[0] });
  assert.equal(event.eventName, "RewardPaid"); assert.equal(event.args.recipient, recipient.address); assert.equal(event.args.amount, one);
  assert.equal((await read(main, "entitlements", [hash(1)]))[6], true);
  assert.equal((await read(main, "entitlements", [hash(2)]))[6], false);
  assert.equal(budget - one, held + main.upload.unallocated);
  await assert.rejects(observeClaim(), e => e.code === "reward_claim_already_paid");
  const remaining = await observeClaim(chain.publicClient, { ...claimExpectation(), entitlementId: hash(2) });
  assert.equal(remaining.award.amount, held); assert.equal(remaining.award.paid, false);
  await write(main, "revokeAuthorization", [hash(2)]); await finalize();
  const revoked = await observeClaim(chain.publicClient, { ...claimExpectation(), entitlementId: hash(2) });
  assert.equal(revoked.award.nonce, 1n); assert.equal(revoked.award.amount, held); assert.equal(revoked.award.paid, false);
  await receipt(chain.relayerClient.sendTransaction({ to: main.context.verifyingContract, data, gas: 1_000_000n }), "reverted");
  assert.equal(await chain.publicClient.getBalance({ address: recipient.address }), balance + one);
  assert.equal(await read(main, "paid", [0n]), one);
});

test("original 2-of-3 Safe receives V2 league payout with wrapped consent; one owner fails", async () => {
  safe = await deployOriginalClubSafeFixture(chain);
  const f = await deploy(2001, 1, [{ entitlementId: hash(1), beneficiaryId: hash(31), pot: 1,
    amount: one, explanationHash: hash(41), beneficiaryKind: 1 }]);
  await write(f, "completeFunding", [0n, budget], { value: budget }); await write(f, "uploadAwards", [f.upload.awards]);
  await write(f, "stageAllocation", [f.upload.snapshotDigest, f.upload.uploadDigest, 1n, f.upload.latestPublicationAt]);
  await chain.testClient.setNextBlockTimestamp({ timestamp: await read(f, "activationNotBefore") });
  await write(f, "activate", [f.upload.allocationDigest, f.upload.snapshotDigest], { gas: 1_000_000n });
  const now = (await chain.publicClient.getBlock({ blockTag: "latest" })).timestamp;
  const claim = { entitlementId: hash(1), recipient: safe.expected.context.verifyingContract, amount: one, pot: "league",
    nonce: 0n, issuedAt: now, expiresAt: now + 3600n, allocationDigest: f.upload.allocationDigest };
  const messages = rewardClaimMessagesV2(f.context, claim), wrapped = safeRewardConsentMessageV2(f.context, claim);
  const operator = await chain.operator.signTypedData(messages.authorization);
  const owners = chain.clubOwners.slice(0, 2).sort((a, b) => a.address.toLowerCase().localeCompare(b.address.toLowerCase()));
  const signatures = await Promise.all(owners.map(owner => owner.signTypedData(wrapped)));
  await receipt(chain.relayerClient.sendTransaction({ to: f.context.verifyingContract, gas: 1_000_000n,
    data: encodeRewardClaimV2(f.context, claim, { operator, recipient: signatures[0] }) }), "reverted");
  const recipient = `0x${signatures.map(s => s.slice(2)).join("")}`;
  await receipt(chain.relayerClient.sendTransaction({ to: f.context.verifyingContract,
    data: encodeRewardClaimV2(f.context, claim, { operator, recipient }) }));
  assert.equal(await chain.publicClient.getBalance({ address: claim.recipient }), one);
  assert.equal(await read(f, "paid", [1n]), one); assert.equal(await read(f, "paid", [0n]), 0n);
});
