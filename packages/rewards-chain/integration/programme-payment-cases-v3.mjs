import assert from "node:assert/strict";
import { parseEther } from "viem";
import { rewardClaimMessagesV3 } from "../dist/campaign-v3.js";
import { normalizeRewardProgrammeAthleteClaimExpectationV3, readVerifiedRewardProgrammeAthleteClaimV3 } from "../dist/claim-reader-v3.js";
import { encodeRewardProgrammeAthletePaymentV3, verifySignedRewardProgrammeAthletePaymentV3,
  readRewardProgrammeAthletePaymentPreflightV3, readVerifiedRewardProgrammeAthletePaymentV3,
  rewardProgrammeAthletePaymentFromObservationV3 } from "../dist/programme-payments-v3.js";
import { fixtureSigner } from "./owned-chain.mjs";

/** Only called by our fresh owned loopback-chain tests, never the saved demo or
 * a public provider. Supplied proofs may come from rollback-only SQL/API tests. */
export async function programmePaymentCasesV3({ reader: c, testClient, operator, expectation, claim: storedClaim, proofs: storedProofs,
  recipient = fixtureSigner(0xA715), adversarial = true }) {
  assert.equal(await c.getChainId(), 31337);
  const e = normalizeRewardProgrammeAthleteClaimExpectationV3(expectation);
  assert.equal(e.recipient.toLowerCase(), recipient.address.toLowerCase());
  const relayer = fixtureSigner(0xFEED71);
  await testClient.setBalance({ address: relayer.address, value: parseEther("5") });
  const before = await readVerifiedRewardProgrammeAthleteClaimV3(c, e), time = before.observation.finalizedBlock.timestamp;
  const claim = storedClaim ?? { entitlementId: e.entitlementId, recipient: e.recipient, amount: e.award.amount,
    pot: e.award.pot === 0 ? "race" : "league", nonce: before.award.nonce, issuedAt: time, expiresAt: time + 86400n,
    allocationDigest: e.upload.allocationDigest };
  const messages = rewardClaimMessagesV3(e.deployment.context, claim);
  const proofs = storedProofs ?? { operator: await operator.signTypedData(messages.authorization), recipient: await recipient.signTypedData(messages.consent) };
  const p = { protocolVersion: 3, expectation: e, claim, proofs, relayerAddress: relayer.address,
    nonce: BigInt(await c.getTransactionCount({ address: relayer.address })) };
  await readRewardProgrammeAthletePaymentPreflightV3(c, p);
  const encoded = encodeRewardProgrammeAthletePaymentV3(p), gas = await c.estimateGas({ ...encoded, account: relayer.address }) * 12n / 10n;
  const serialized = await relayer.signTransaction({ ...encoded, type: "eip1559", gas, maxFeePerGas: 30000000000n, maxPriorityFeePerGas: 0n });
  const attempt = await verifySignedRewardProgrammeAthletePaymentV3(p, serialized);
  const balanceBefore = await c.getBalance({ address: e.recipient });
  // Broadcast succeeds but the caller loses its response. Recovery knows only
  // its previously verified bytes/hash and must never create another transfer.
  await assert.rejects(async () => { await c.sendRawTransaction({ serializedTransaction: serialized }); throw Error("synthetic_lost_payment_response"); }, /synthetic_lost_payment_response/);
  const receipt = await c.waitForTransactionReceipt({ hash: attempt.transactionHash }); assert.equal(receipt.status, "success");
  await testClient.mine({ blocks: 96, interval: 1 });
  const observe = reader => readVerifiedRewardProgrammeAthletePaymentV3(reader, p, serialized), result = await observe(c);
  assert.equal(result.payment.amount, claim.amount); assert.equal(result.payment.transactionHash, attempt.transactionHash);
  assert.equal(result.payment.authorizationNonce, claim.nonce); assert.equal(result.checkpoint.award.nonce, claim.nonce + 1n);
  assert.equal(await c.getBalance({ address: e.recipient }), balanceBefore + claim.amount);
  const nonceAfter = await c.getTransactionCount({ address: relayer.address });
  assert.deepEqual(await observe(c), result); assert.equal(await c.getTransactionCount({ address: relayer.address }), nonceAfter);
  await assert.rejects(c.call({ ...encoded, account: relayer.address }));
  await assert.rejects(readRewardProgrammeAthletePaymentPreflightV3(c, p), { code: "reward_claim_already_paid" });
  if (adversarial) {
    const transaction = await c.getTransaction({ hash: attempt.transactionHash }), block = await c.getBlock({ blockNumber: receipt.blockNumber });
    const observation = { observedChainId: 31337, transaction, receipt, canonicalPaymentBlock: { number: block.number, hash: block.hash, timestamp: block.timestamp },
      finalizedBlock: result.payment.finalizedBlock, runtimeCode: await c.getCode({ address: encoded.to, blockNumber: receipt.blockNumber }) };
    assert.deepEqual(rewardProgrammeAthletePaymentFromObservationV3(p, attempt.transactionHash, observation), result.payment);
    const badHash = `0x${"9a".repeat(32)}`;
    for (const mutate of [x => x.receipt.status = "reverted", x => x.observedChainId = 143, x => x.transaction.chainId = 143,
      x => x.transaction.nonce++, x => x.transaction.value = 1n, x => x.transaction.input += "00", x => x.transaction.to = operator.address,
      x => x.receipt.from = operator.address, x => x.receipt.blockHash = badHash, x => x.receipt.transactionHash = badHash,
      x => x.receipt.logs = [], x => x.receipt.logs.push(x.receipt.logs[0]), x => x.receipt.logs[0].removed = true,
      x => x.receipt.logs[0].data = `0x${"00".repeat(64)}`, x => x.receipt.logs[0].topics[1] = badHash,
      x => x.receipt.logs[0].address = operator.address, x => x.receipt.logs[0].transactionHash = badHash,
      x => x.finalizedBlock.number = receipt.blockNumber - 1n, x => x.canonicalPaymentBlock.timestamp = claim.expiresAt,
      x => x.receipt.gasUsed = transaction.gas + 1n, x => x.runtimeCode = "0x"])
      assert.throws(() => { const altered = structuredClone(observation); mutate(altered); rewardProgrammeAthletePaymentFromObservationV3(p, attempt.transactionHash, altered); });
    await assert.rejects(observe({ ...c, getTransaction: async args => {
      const tx = await c.getTransaction(args); return args.hash === attempt.transactionHash ? { ...tx, gas: tx.gas + 1n } : tx;
    } }), { code: "reward_payment_signed_transaction_mismatch" });
    await assert.rejects(observe({ ...c, readContract: async args => {
      const v = await c.readContract(args); if (args.address.toLowerCase() === encoded.to.toLowerCase() && args.functionName === "entitlements")
        return v.map((item, index) => index === 3 ? item + 1n : item); return v;
    } }), { code: "reward_payment_award_mismatch" });
    await assert.rejects(observe({ ...c, getCode: args => args.address.toLowerCase() === e.recipient.toLowerCase() && args.blockNumber === receipt.blockNumber
      ? Promise.resolve(`0xef0100${"11".repeat(20)}`) : c.getCode(args) }), { code: "reward_claim_eoa_recipient_required" });
    // A later account upgrade does not rewrite receipt-time EOA execution.
    await observe({ ...c, getCode: args => args.address.toLowerCase() === e.recipient.toLowerCase() && args.blockNumber !== receipt.blockNumber
      ? Promise.resolve(`0xef0100${"11".repeat(20)}`) : c.getCode(args) });
    await assert.rejects(observe({ ...c, getTransactionReceipt: args => {
      if (args.hash === attempt.transactionHash) throw Error("private-provider-credential"); return c.getTransactionReceipt(args);
    } }), e => e.code === "reward_payment_observation_unavailable" && !JSON.stringify(e).includes("private-provider-credential"));
  }
  return { plan: p, serialized, result, observe: () => observe(c) };
}
