import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { encodeFunctionData, parseTransaction, serializeTransaction, toHex, zeroAddress } from "viem";
import { startOwnedRewardChain } from "./owned-chain.mjs";
import { deployOriginalClubSafeFixture } from "./safe-deployment-fixture.mjs";
import { proposalFor, leagueResult, h } from "../test/fixtures.mjs";
import { encodeRewardClubPayment, verifySignedRewardClubPayment, readVerifiedRewardClubPayment, rewardClubPaymentFromObservation,
  rewardClaimMessages, safeRewardConsentMessage, rewardCampaignAbi, readVerifiedRewardCampaign, encodeRewardLifecycle,
  readVerifiedRewardClubSafe, readVerifiedRewardClubSafeDeployment } from "../dist/index.js";

// Actual pinned campaign + original Safe on an owned loopback Monad simulator.
// All identities, programme data and signing accounts are synthetic.
let chain, created, main, initialSafeTransactionCount; const entries = [];
const fees = { type: "eip1559", gas: 1000000n, maxFeePerGas: 20000000000n, maxPriorityFeePerGas: 100000000n };
const finalize = () => chain.testClient.mine({ blocks: 96, interval: 1 });
async function receipt(hash, status = "success") { const r = await chain.publicClient.waitForTransactionReceipt({ hash, timeout: 10000 }); assert.equal(r.status, status); return r; }
const read = (entry = main, reader = chain.publicClient) => readVerifiedRewardClubPayment(reader, entry.plan, entry.signed, chain.artifact.bytecode.object);
async function invoke(entry, functionName, args = [], value = 0n) {
  return receipt(await chain.operatorClient.writeContract({ address: entry.plan.expected.deployment.context.verifyingContract, abi: rewardCampaignAbi, functionName, args, value }));
}
async function lifecycle(entry, action) {
  const nonce = BigInt(await chain.publicClient.getTransactionCount({ address: chain.operator.address, blockTag: "pending" }));
  const plan = { deployment: entry.plan.expected.deployment, upload: entry.plan.expected.upload, nonce, action,
    ...(action === "upload_awards" ? { batchStart: 0, batchSize: entry.plan.expected.upload.awards.length } : {}) };
  return receipt(await chain.operatorClient.sendTransaction({ ...encodeRewardLifecycle(plan), gas: 5000000n }));
}
before(async () => {
  chain = await startOwnedRewardChain(); created = await deployOriginalClubSafeFixture(chain); await finalize();
  const original = await readVerifiedRewardClubSafeDeployment(chain.publicClient, created.provenance);
  // Contract-account transaction counts start at creation, independently of the
  // Safe's nonce() execution counter. Receipt of rewards changes neither.
  initialSafeTransactionCount = await chain.publicClient.getTransactionCount({ address: original.safe.context.verifyingContract });
  const owners = [...chain.clubOwners].sort((a, b) => a.address.toLowerCase().localeCompare(b.address.toLowerCase())).slice(0, 2);
  for (const league of [false, true]) {
    const upload = proposalFor(league ? leagueResult() : undefined), { operator, operatorClient, treasury, artifact, publicClient, relayer } = chain;
    const deployed = await receipt(await operatorClient.deployContract({ abi: rewardCampaignAbi, bytecode: artifact.bytecode.object,
      args: [operator.address, treasury, upload.programmeId, upload.campaignId, upload.programmeManifestHash, upload.enabledPot] }));
    const tx = await publicClient.getTransaction({ hash: deployed.transactionHash });
    const deployment = { context: { environment: "local-simulation", chainId: 31337, verifyingContract: deployed.contractAddress },
      operatorAddress: operator.address, treasuryAddress: treasury, programmeId: upload.programmeId, campaignId: upload.campaignId,
      programmeManifestHash: upload.programmeManifestHash, enabledPot: upload.enabledPot, deploymentNonce: BigInt(tx.nonce), deploymentTransactionHash: tx.hash };
    const expected = { deployment, upload, treasury: created.provenance,
      review: { reviewedBlock: original.safe.finalizedBlock, deploymentBlock: original.deploymentBlock, initializerHash: original.initializerHash } };
    const entry = { plan: { expected } };
    await invoke(entry, "completeFunding", [0n, upload.budgets[upload.enabledPot]], upload.budgets[upload.enabledPot]);
    await lifecycle(entry, "upload_awards"); await lifecycle(entry, "stage_allocation");
    const activation = await publicClient.readContract({ address: deployed.contractAddress, abi: rewardCampaignAbi, functionName: "activationNotBefore" });
    await chain.testClient.setNextBlockTimestamp({ timestamp: activation }); await finalize(); await lifecycle(entry, "activate"); await finalize();
    const b = await publicClient.getBlock({ blockTag: "finalized" }), award = upload.awards.find(a => a.beneficiaryKind === 1);
    const claim = { entitlementId: award.entitlementId, recipient: original.safe.context.verifyingContract, amount: award.amount,
      pot: league ? "league" : "race", nonce: 0n, issuedAt: b.timestamp, expiresAt: b.timestamp + 86400n, allocationDigest: upload.allocationDigest };
    const messages = rewardClaimMessages(deployment.context, claim), safeMessage = safeRewardConsentMessage(deployment.context, claim);
    const proofs = { operator: await operator.signTypedData(messages.authorization),
      recipient: `0x${(await Promise.all(owners.map(o => o.signTypedData(safeMessage)))).map(s => s.slice(2)).join("")}` };
    entry.plan = { expected: { ...expected, entitlementId: claim.entitlementId, recipient: claim.recipient }, claim, proofs,
      relayerAddress: relayer.address, nonce: BigInt(await publicClient.getTransactionCount({ address: relayer.address, blockTag: "pending" })),
      consentCheckpoint: { number: b.number, hash: b.hash, timestamp: b.timestamp } };
    entry.signed = await relayer.signTransaction({ ...encodeRewardClubPayment(entry.plan), ...fees });
    entry.attempt = await verifySignedRewardClubPayment(publicClient, entry.plan, entry.signed);
    entry.receipt = await receipt(await chain.relayerClient.sendRawTransaction({ serializedTransaction: entry.signed })); await finalize();
    entries.push(entry);
  }
  main = entries[1];
}, { timeout: 90000 });
after(async () => { await chain?.stop(); });

test("real signed race and league club payments reconcile both receipt events and retain every other reserve", async () => {
  for (const entry of entries) {
    const result = await read(entry), p = result.payment, { upload } = entry.plan.expected;
    assert.equal(p.action, "pay_club"); assert.equal(p.transactionHash, entry.attempt.transactionHash);
    assert.equal(p.amount, entry.plan.claim.amount); assert.equal(p.nonce, entry.plan.nonce); assert.equal(p.authorizationNonce, 0n);
    assert.equal(p.logIndex + 1, p.safeReceivedLogIndex); assert.equal(p.monadGasLimitFee, p.gasLimit * p.effectiveGasPrice);
    assert.equal(result.checkpoint.observation.accounting.nativeBalance + p.amount, upload.budgets[upload.enabledPot]);
    assert.equal(result.checkpoint.observation.accounting.paid[upload.enabledPot], p.amount);
    assert.equal(entry.attempt.safeExecutionNonce, 0n); assert.notEqual(entry.attempt.wrappedRecipientDigest, entry.attempt.recipientDigest);
    assert.deepEqual(await read(entry), result);
  }
  assert.equal(await chain.publicClient.getBalance({ address: main.plan.claim.recipient }), entries.reduce((sum, e) => sum + e.plan.claim.amount, 0n));
  assert.equal(await chain.publicClient.getTransactionCount({ address: main.plan.claim.recipient }), initialSafeTransactionCount);
});

test("club signed attempts reject changed call, nonce, sender, chain, fee, access-list and noncanonical signatures", async () => {
  const tx = { ...encodeRewardClubPayment(main.plan), ...fees };
  await assert.rejects(verifySignedRewardClubPayment(chain.publicClient, main.plan, await chain.operator.signTransaction(tx)), { code: "reward_payment_sender_mismatch" });
  for (const [patch, code] of [[{ chainId: 143 }, "reward_payment_transaction_chain_mismatch"], [{ to: chain.treasury }, "reward_payment_destination_mismatch"],
    [{ nonce: tx.nonce + 1 }, "reward_payment_nonce_mismatch"], [{ value: 1n }, "reward_payment_input_mismatch"],
    [{ data: `${tx.data}00` }, "reward_payment_input_mismatch"], [{ accessList: [{ address: chain.treasury, storageKeys: [] }] }, "reward_payment_destination_mismatch"],
    [{ gas: 0n }, "invalid_reward_payment_fees"], [{ maxFeePerGas: 0n, maxPriorityFeePerGas: 0n }, "invalid_reward_payment_fees"]]) {
    const signed = await chain.relayer.signTransaction({ ...tx, ...patch });
    await assert.rejects(verifySignedRewardClubPayment(chain.publicClient, main.plan, signed), { code });
  }
  const parsed = parseTransaction(main.signed), order = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
  const high = serializeTransaction({ ...parsed, s: toHex(order - BigInt(parsed.s), { size: 32 }), yParity: 1 - parsed.yParity });
  for (const signed of [serializeTransaction(tx), high, `${main.signed}00`]) await assert.rejects(verifySignedRewardClubPayment(chain.publicClient, main.plan, signed));
  const variant = await verifySignedRewardClubPayment(chain.publicClient, main.plan, await chain.relayer.signTransaction({ ...tx, maxFeePerGas: 30000000000n }));
  assert.notEqual(variant.transactionHash, main.attempt.transactionHash); assert.equal(variant.calldataHash, main.attempt.calldataHash);
  assert.equal(variant.nonce, main.attempt.nonce); assert.deepEqual(variant.consentCheckpoint, main.attempt.consentCheckpoint);
});

test("club verification rejects one-owner/unwrapped consent and changed review provenance; inputs freeze before asynchronous reads", async () => {
  for (const mutate of [p => { p.proofs.recipient = p.proofs.recipient.slice(0, 132); }, p => { p.proofs.operator = p.proofs.recipient.slice(0, 132); },
    p => { p.expected.review.initializerHash = h("not reviewed setup"); }, p => { p.expected.review.reviewedBlock.hash = h("other fork"); }]) {
    const p = structuredClone(main.plan); mutate(p); await assert.rejects(verifySignedRewardClubPayment(chain.publicClient, p, main.signed));
  }
  const owners = [...chain.clubOwners].sort((a, b) => a.address.toLowerCase().localeCompare(b.address.toLowerCase())).slice(0, 2);
  const raw = rewardClaimMessages(main.plan.expected.deployment.context, main.plan.claim).consent;
  const unwrapped = `0x${(await Promise.all(owners.map(o => o.signTypedData(raw)))).map(s => s.slice(2)).join("")}`;
  await assert.rejects(verifySignedRewardClubPayment(chain.publicClient, { ...main.plan, proofs: { ...main.plan.proofs, recipient: unwrapped } }, main.signed));
  const mutable = structuredClone(main.plan), pending = verifySignedRewardClubPayment(chain.publicClient, mutable, main.signed);
  mutable.claim.amount++; mutable.expected.treasury.safe.owners.reverse(); mutable.consentCheckpoint.hash = h("caller edit"); mutable.nonce++;
  assert.deepEqual(await pending, main.attempt);
});

test("club receipt validation requires the complete ordered Safe and campaign events with exact provenance and economics", async () => {
  const { publicClient } = chain, hash = main.attempt.transactionHash, f = await publicClient.getBlock({ blockTag: "finalized" });
  const b = await publicClient.getBlock({ blockNumber: main.receipt.blockNumber });
  const observed = { observedChainId: 31337, transaction: await publicClient.getTransaction({ hash }), receipt: main.receipt,
    canonicalPaymentBlock: { number: b.number, hash: b.hash, timestamp: b.timestamp }, finalizedBlock: { number: f.number, hash: f.hash, timestamp: f.timestamp },
    runtimeCode: await publicClient.getCode({ address: main.plan.expected.deployment.context.verifyingContract, blockNumber: f.number }) };
  assert.equal(rewardClubPaymentFromObservation(main.plan, hash, observed).transactionHash, hash);
  for (const mutate of [o => { o.receipt.status = "reverted"; }, o => { o.transaction.hash = h("wrong"); }, o => { o.receipt.transactionHash = h("wrong"); },
    o => { o.transaction.from = chain.operator.address; }, o => { o.receipt.from = chain.operator.address; }, o => { o.receipt.to = main.plan.claim.recipient; },
    o => { o.transaction.nonce++; }, o => { o.transaction.value = 1n; }, o => { o.transaction.input += "00"; }, o => { o.receipt.contractAddress = chain.treasury; },
    o => { o.receipt.transactionIndex++; }, o => { o.transaction.chainId = 143; }, o => { o.observedChainId = 143; },
    o => { o.canonicalPaymentBlock.hash = h("wrong"); }, o => { o.canonicalPaymentBlock.timestamp = main.plan.claim.expiresAt; },
    o => { o.finalizedBlock.number = o.receipt.blockNumber - 1n; }, o => { o.runtimeCode = `${o.runtimeCode.slice(0, -2)}00`; },
    o => { o.receipt.logs.shift(); }, o => { o.receipt.logs.pop(); }, o => { o.receipt.logs.reverse(); }, o => { o.receipt.logs.push(o.receipt.logs[0]); },
    o => { o.receipt.logs[1].logIndex = o.receipt.logs[0].logIndex; }, o => { o.receipt.gasUsed = o.transaction.gas + 1n; },
    o => { o.receipt.effectiveGasPrice = o.transaction.maxFeePerGas + 1n; }]) {
    const copy = structuredClone(observed); mutate(copy); assert.throws(() => rewardClubPaymentFromObservation(main.plan, hash, copy));
  }
  for (const index of [0, 1]) for (const mutate of [l => { l.removed = true; }, l => { l.logIndex = null; }, l => { l.transactionIndex++; },
    l => { l.blockHash = h("wrong"); }, l => { l.transactionHash = h("wrong"); }, l => { l.address = chain.treasury; },
    l => { l.data += "00"; }, l => { l.topics[1] = h("wrong indexed value"); }, l => { l.topics.push(h("extra")); }]) {
    const copy = structuredClone(observed); mutate(copy.receipt.logs[index]); assert.throws(() => rewardClubPaymentFromObservation(main.plan, hash, copy));
  }
});

test("club payment readback rejects changed signed fields, wrong paid kind/nonce, missing archive and final chain drift", async () => {
  for (const mutate of [t => { t.gas++; }, t => { t.maxFeePerGas++; }, t => { t.r = h("wrong signature"); }, t => { t.s = `0x${"f".repeat(65)}`; }, t => { t.yParity = 1 - t.yParity; }]) {
    const reader = { ...chain.publicClient, getTransaction: async args => { const tx = await chain.publicClient.getTransaction(args); if (args.hash === main.attempt.transactionHash) mutate(tx); return tx; } };
    await assert.rejects(read(main, reader), { code: "reward_payment_signed_transaction_mismatch" });
  }
  for (const [index, value] of [[7, 0], [6, false], [3, 0n], [1, 1n]]) {
    const reader = { ...chain.publicClient, readContract: async args => { const row = await chain.publicClient.readContract(args);
      if (args.functionName === "entitlements") { const changed = [...row]; changed[index] = value; return changed; } return row; } };
    await assert.rejects(read(main, reader), { code: "reward_payment_award_mismatch" });
  }
  const unavailable = { ...chain.publicClient, getBlock: args => {
    if (args.blockNumber === main.plan.consentCheckpoint.number) throw Error("Synthetic private archive diagnostic"); return chain.publicClient.getBlock(args);
  } };
  await assert.rejects(read(main, unavailable), error => /unavailable$/.test(error.code) && !String(error).includes("diagnostic"));
  let paymentBlocks = 0;
  const drift = { ...chain.publicClient, getBlock: async args => { const b = await chain.publicClient.getBlock(args);
    return args.blockNumber === main.receipt.blockNumber && ++paymentBlocks === 2 ? { ...b, hash: h("late fork") } : b; } };
  await assert.rejects(read(main, drift), { code: "reward_chain_changed_during_observation" });
  assert.equal(paymentBlocks, 2);
});

test("absent or reverted club attempts cannot borrow a previous successful receipt", async () => {
  const plan = { ...main.plan, nonce: BigInt(await chain.publicClient.getTransactionCount({ address: chain.relayer.address, blockTag: "pending" })) };
  const signed = await chain.relayer.signTransaction({ ...encodeRewardClubPayment(plan), ...fees });
  await assert.rejects(read({ plan, signed }), { code: "reward_club_payment_observation_unavailable" });
  await receipt(await chain.relayerClient.sendRawTransaction({ serializedTransaction: signed }), "reverted"); await finalize();
  await assert.rejects(read({ plan, signed }), { code: "reward_payment_reverted" });
  assert.equal((await read()).payment.amount, main.plan.claim.amount);
});

test("a later actual Safe threshold change does not erase the historical signed payout", async () => {
  const snapshot = await chain.testClient.snapshot();
  try {
    const address = main.plan.claim.recipient, abi = created.artifacts.singleton.abi;
    const data = encodeFunctionData({ abi, functionName: "changeThreshold", args: [1n] });
    const message = { to: address, value: 0n, data, operation: 0, safeTxGas: 0n, baseGas: 0n, gasPrice: 0n, gasToken: zeroAddress, refundReceiver: zeroAddress, nonce: 0n };
    const typed = { domain: { chainId: 31337, verifyingContract: address }, primaryType: "SafeTx", message, types: { SafeTx: [
      { name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "data", type: "bytes" }, { name: "operation", type: "uint8" },
      { name: "safeTxGas", type: "uint256" }, { name: "baseGas", type: "uint256" }, { name: "gasPrice", type: "uint256" },
      { name: "gasToken", type: "address" }, { name: "refundReceiver", type: "address" }, { name: "nonce", type: "uint256" },
    ] } };
    const owners = [...chain.clubOwners].sort((a, b) => a.address.toLowerCase().localeCompare(b.address.toLowerCase())).slice(0, 2);
    const signatures = `0x${(await Promise.all(owners.map(o => o.signTypedData(typed)))).map(s => s.slice(2)).join("")}`;
    await receipt(await chain.operatorClient.writeContract({ address, abi, functionName: "execTransaction",
      args: [address, 0n, data, 0, 0n, 0n, 0n, zeroAddress, zeroAddress, signatures] })); await finalize();
    await assert.rejects(readVerifiedRewardClubSafe(chain.publicClient, main.plan.expected.treasury.safe), { code: "reward_club_two_signatures_required" });
    for (const entry of entries) assert.equal((await read(entry)).payment.amount, entry.plan.claim.amount);
  } finally { await chain.testClient.revert({ id: snapshot }); }
});

test("later paused, expired and treasury-returned campaigns preserve both historical club payments", async () => {
  await invoke(main, "pause"); await finalize(); assert.equal((await read()).checkpoint.observation.accounting.paused, true);
  await invoke(main, "resume"); await finalize();
  await chain.testClient.setNextBlockTimestamp({ timestamp: main.plan.claim.expiresAt + 1n }); await finalize();
  for (const entry of entries) assert.equal((await read(entry)).payment.amount, entry.plan.claim.amount);
  const cp = await readVerifiedRewardCampaign(chain.publicClient, main.plan.expected.deployment, chain.artifact.bytecode.object);
  await chain.testClient.setNextBlockTimestamp({ timestamp: cp.observation.accounting.claimDeadline }); await finalize();
  for (const entry of entries) {
    await invoke(entry, "close"); await invoke(entry, "returnToTreasury"); await finalize();
    const result = await read(entry); assert.equal(result.checkpoint.observation.accounting.state, 4);
    assert.equal(result.checkpoint.observation.accounting.nativeBalance, 0n); assert.equal(result.payment.amount, entry.plan.claim.amount);
  }
});
