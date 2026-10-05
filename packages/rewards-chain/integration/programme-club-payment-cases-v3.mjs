import assert from "node:assert/strict";
import { encodeFunctionData, zeroAddress } from "viem";
import { rewardClaimMessagesV3, safeRewardConsentMessageV3, rewardCampaignV3Abi } from "../dist/campaign-v3.js";
import { rewardClaimMessages, safeRewardConsentMessage } from "../dist/claims.js";
import { readVerifiedRewardProgrammeAthleteClaimV3 } from "../dist/claim-reader-v3.js";
import { readVerifiedRewardProgrammeClubClaimV3 } from "../dist/club-claim-reader-v3.js";
import { readVerifiedRewardClubSafeDeployment } from "../dist/club-safe-deployment.js";
import { verifyRewardClubSafeConsentV3 } from "../dist/club-safe.js";
import { encodeRewardProgrammeClubPaymentV3, verifySignedRewardProgrammeClubPaymentV3,
  readRewardProgrammeClubPaymentPreflightV3 } from "../dist/programme-club-payments-v3.js";
import { readVerifiedRewardProgrammeClubPaymentV3 } from "../dist/programme-club-payment-reader-v3.js";
import { rewardProgrammeClubPaymentFromObservationV3 } from "../dist/programme-club-payment-receipts-v3.js";

const badHash = `0x${"9a".repeat(32)}`;
const owners = chain => [...chain.clubOwners].sort((a, b) => a.address.toLowerCase().localeCompare(b.address.toLowerCase())).slice(0, 2);
const signPair = async (chain, typed) => `0x${(await Promise.all(owners(chain).map(o => o.signTypedData(typed)))).map(s => s.slice(2)).join("")}`;

/** Actual quorum action on this caller-owned ephemeral chain only. Preserving
 * threshold 2 still advances nonce and therefore invalidates a prior review. */
async function executeSafeThreshold(chain, safe, threshold) {
  const address = safe.expected.context.verifyingContract, abi = safe.artifacts.singleton.abi;
  const data = encodeFunctionData({ abi, functionName: "changeThreshold", args: [threshold] });
  const nonce = await chain.publicClient.readContract({ address, abi, functionName: "nonce" });
  const message = { to: address, value: 0n, data, operation: 0, safeTxGas: 0n, baseGas: 0n, gasPrice: 0n,
    gasToken: zeroAddress, refundReceiver: zeroAddress, nonce };
  const typed = { domain: { chainId: 31337, verifyingContract: address }, primaryType: "SafeTx", message, types: { SafeTx: [
    { name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "data", type: "bytes" }, { name: "operation", type: "uint8" },
    { name: "safeTxGas", type: "uint256" }, { name: "baseGas", type: "uint256" }, { name: "gasPrice", type: "uint256" },
    { name: "gasToken", type: "address" }, { name: "refundReceiver", type: "address" }, { name: "nonce", type: "uint256" },
  ] } };
  const signatures = await signPair(chain, typed);
  const hash = await chain.operatorClient.writeContract({ address, abi, functionName: "execTransaction",
    args: [address, 0n, data, 0, 0n, 0n, 0n, zeroAddress, zeroAddress, signatures] });
  assert.equal((await chain.publicClient.waitForTransactionReceipt({ hash, timeout: 10000 })).status, "success");
  await chain.testClient.mine({ blocks: 96, interval: 1 });
}

/** Test-only caller-owned chain. No input endpoint, Keychain, API identity,
 * nomination or review is persisted. Returns evidence, never private keys. */
export async function programmeClubPaymentCasesV3({ chain, expectation, safe, adversarial = false, t }) {
  const c = chain.publicClient;
  assert.equal(await c.getChainId(), 31337);
  const original = await readVerifiedRewardClubSafeDeployment(c, safe.provenance);
  const e = { ...expectation, treasury: safe.provenance, review: { reviewedBlock: original.safe.finalizedBlock,
    deploymentBlock: original.deploymentBlock, initializerHash: original.initializerHash } };
  const witness = await readVerifiedRewardProgrammeClubClaimV3(c, e), at = witness.observation.finalizedBlock;
  assert.equal(witness.award.beneficiaryKind, 1); assert.equal(witness.award.paid, false);
  assert.equal(witness.provenance.slot, e.slot); assert.equal(witness.treasury.executionNonce, 0n);
  assert.deepEqual(witness.treasury.finalizedBlock, at);
  assert.equal(witness.treasury.executionHistoryReviewRequired, true);
  await assert.rejects(readVerifiedRewardProgrammeAthleteClaimV3(c, e), { code: "reward_athlete_claim_required" });
  const claim = { entitlementId: e.entitlementId, recipient: e.recipient, amount: witness.award.amount,
    pot: e.slot === 5 ? "league" : "race", nonce: witness.award.nonce, issuedAt: at.timestamp, expiresAt: at.timestamp + 86400n,
    allocationDigest: e.upload.allocationDigest };
  const context = witness.campaign.context, messages = rewardClaimMessagesV3(context, claim);
  const proofs = { operator: await chain.operator.signTypedData(messages.authorization),
    recipient: await signPair(chain, safeRewardConsentMessageV3(context, claim)) };
  const plan = { protocolVersion: 3, expectation: e, claim, proofs, consentCheckpoint: at, relayerAddress: chain.relayer.address,
    nonce: BigInt(await c.getTransactionCount({ address: chain.relayer.address })) };
  const preflight = input => readRewardProgrammeClubPaymentPreflightV3(c, input ?? plan);
  await preflight();
  const encoded = encodeRewardProgrammeClubPaymentV3(plan);
  const tx = { ...encoded, type: "eip1559", gas: 1000000n, maxFeePerGas: 30000000000n, maxPriorityFeePerGas: 0n };
  const serialized = await chain.relayer.signTransaction(tx);
  const attempt = await verifySignedRewardProgrammeClubPaymentV3(c, plan, serialized);
  assert.equal(attempt.protocolVersion, 3); assert.equal(attempt.provenance.slot, e.slot);
  assert.equal(attempt.safeExecutionNonce, 0n); assert.notEqual(attempt.wrappedRecipientDigest, attempt.recipientDigest);

  if (adversarial) {
    await t.test("V3 club consent rejects one owner, old domain, unwrapped/wrong-purpose and substituted proofs", async () => {
      const oldConsent = await signPair(chain, safeRewardConsentMessage(context, claim));
      const rawConsent = await signPair(chain, messages.consent);
      const wrongPurpose = await signPair(chain, { ...safeRewardConsentMessageV3(context, claim),
        message: { message: attempt.operatorDigest } });
      for (const recipient of [proofs.recipient.slice(0, 132), oldConsent, rawConsent, wrongPurpose, "0x"]) {
        await assert.rejects(preflight({ ...plan, proofs: { ...proofs, recipient } }));
        if (recipient !== "0x") await assert.rejects(c.call({ account: chain.relayer.address,
          ...encodeRewardProgrammeClubPaymentV3({ ...plan, proofs: { ...proofs, recipient } }) }));
      }
      const oldOperator = await chain.operator.signTypedData(rewardClaimMessages(context, claim).authorization);
      await assert.rejects(preflight({ ...plan, proofs: { ...proofs, operator: oldOperator } }), { code: "reward_claim_signature_mismatch" });
      for (const mutate of [p => p.claim.amount++, p => p.claim.recipient = chain.treasury,
        p => p.claim.allocationDigest = badHash, p => p.claim.pot = "league", p => p.expectation.slot = 5,
        p => p.expectation.review.initializerHash = badHash, p => p.expectation.review.reviewedBlock.hash = badHash]) {
        const copy = structuredClone(plan); mutate(copy); await assert.rejects(preflight(copy));
      }
      const changedNonce = { ...plan, claim: { ...claim, nonce: claim.nonce + 1n } };
      changedNonce.proofs = { operator: await chain.operator.signTypedData(rewardClaimMessagesV3(context, changedNonce.claim).authorization),
        recipient: await signPair(chain, safeRewardConsentMessageV3(context, changedNonce.claim)) };
      await assert.rejects(preflight(changedNonce), { code: "reward_payment_authorization_nonce_mismatch" });
    });
    await t.test("V3 club captures caller inputs and sanitizes unavailable provider details", async () => {
      const copy = structuredClone(plan), pending = verifySignedRewardProgrammeClubPaymentV3(c, copy, serialized);
      copy.claim.amount++; copy.expectation.treasury.safe.owners[0] = chain.treasury; copy.consentCheckpoint.hash = badHash;
      assert.deepEqual(await pending, attempt);
      await assert.rejects(readVerifiedRewardProgrammeClubClaimV3({ ...c, readContract: args => {
        if (args.functionName === "nonce") throw Error("private-provider-credential");
        return c.readContract(args);
      } }, e), error => error.code === "reward_club_claim_observation_unavailable" && !String(error).includes("credential"));
      for (const patch of [{ chainId: 143 }, { to: chain.treasury }, { nonce: tx.nonce + 1 }, { value: 1n },
        { data: tx.data + "00" }, { gas: 0n }, { accessList: [{ address: chain.treasury, storageKeys: [] }] }]) {
        await assert.rejects(verifySignedRewardProgrammeClubPaymentV3(c, plan, await chain.relayer.signTransaction({ ...tx, ...patch })));
      }
      await assert.rejects(verifySignedRewardProgrammeClubPaymentV3(c, plan, await chain.operator.signTransaction(tx)));
    });
    await t.test("actual 2-of-3 Safe execution invalidates a stale review before payment", async () => {
      const snapshot = await chain.testClient.snapshot();
      try {
        await executeSafeThreshold(chain, safe, 2n);
        await assert.rejects(preflight(), { code: "reward_club_execution_changed_since_review" });
        // Historical signed evidence can still be verified; it is NOT a fresh send permission.
        assert.equal((await verifySignedRewardProgrammeClubPaymentV3(c, plan, serialized)).transactionHash, attempt.transactionHash);
      } finally { await chain.testClient.revert({ id: snapshot }); }
      await preflight();
    });
    await t.test("V3 club reads recheck programme and publication anchors after Safe IO", async () => {
      for (const target of [witness.provenance.deploymentBlockNumber, witness.observation.review.stageBlockNumber]) {
        let safeRead = false;
        await assert.rejects(readVerifiedRewardProgrammeClubClaimV3({ ...c,
          readContract: args => { if (args.functionName === "nonce") safeRead = true; return c.readContract(args); },
          getBlock: async args => {
            const block = await c.getBlock(args); return safeRead && args.blockNumber === target ? { ...block, hash: badHash } : block;
          },
        }, e), { code: "reward_chain_changed_during_observation" });
        let consentReads = 0;
        await assert.rejects(readRewardProgrammeClubPaymentPreflightV3({ ...c,
          readContract: args => { if (args.functionName === "isValidSignature") consentReads++; return c.readContract(args); },
          getBlock: async args => {
            const block = await c.getBlock(args);
            return consentReads >= 2 && args.blockNumber === target ? { ...block, hash: badHash } : block;
          },
        }, plan), { code: "reward_chain_changed_during_observation" });
      }
    });
  }

  const balanceBefore = await c.getBalance({ address: e.recipient });
  await assert.rejects(async () => {
    await c.sendRawTransaction({ serializedTransaction: serialized }); throw Error("synthetic_lost_club_send_response");
  }, /synthetic_lost_club_send_response/);
  const receipt = await c.waitForTransactionReceipt({ hash: attempt.transactionHash, timeout: 10000 });
  assert.equal(receipt.status, "success"); await chain.testClient.mine({ blocks: 96, interval: 1 });
  const observe = (reader = c) => readVerifiedRewardProgrammeClubPaymentV3(reader, plan, serialized);
  const result = await observe();
  assert.equal(result.payment.transactionHash, attempt.transactionHash);
  assert.equal(result.payment.amount, claim.amount); assert.equal(result.checkpoint.award.nonce, claim.nonce + 1n);
  assert.equal(result.payment.provenance.slot, e.slot); assert.equal(result.payment.pot, claim.pot);
  assert.equal(result.payment.safeReceivedLogIndex, result.payment.logIndex + 1);
  assert.equal(await c.getBalance({ address: e.recipient }), balanceBefore + claim.amount);
  const nonceAfter = await c.getTransactionCount({ address: chain.relayer.address });
  assert.deepEqual(await observe(), result); assert.equal(await c.getTransactionCount({ address: chain.relayer.address }), nonceAfter);
  await assert.rejects(c.call({ ...encoded, account: chain.relayer.address }));
  await assert.rejects(preflight(), { code: "reward_claim_already_paid" });

  if (adversarial) {
    await t.test("V3 club recovery requires exact paid row, signed transaction and both ordered receipt events", async () => {
      const transaction = await c.getTransaction({ hash: attempt.transactionHash }), block = await c.getBlock({ blockNumber: receipt.blockNumber });
      const observed = { observedChainId: 31337, transaction, receipt, canonicalPaymentBlock: { number: block.number, hash: block.hash, timestamp: block.timestamp },
        finalizedBlock: result.payment.finalizedBlock, runtimeCode: await c.getCode({ address: encoded.to, blockNumber: receipt.blockNumber }) };
      assert.deepEqual(rewardProgrammeClubPaymentFromObservationV3(plan, attempt.transactionHash, observed), result.payment);
      for (const mutate of [o => o.receipt.status = "reverted", o => o.receipt.logs.pop(), o => o.receipt.logs.shift(),
        o => o.receipt.logs.reverse(), o => o.receipt.logs.push(o.receipt.logs[0]), o => o.receipt.logs[1].logIndex++,
        o => o.receipt.logs[1].address = chain.treasury, o => o.receipt.logs[1].topics[1] = badHash,
        o => o.receipt.logs[1].data = badHash, o => o.receipt.logs[1].removed = true, o => o.receipt.logs[0].topics[1] = badHash,
        o => o.transaction.input += "00", o => o.transaction.nonce++, o => o.transaction.chainId = 143,
        o => o.receipt.blockHash = badHash, o => o.transaction.from = chain.operator.address,
        o => o.canonicalPaymentBlock.timestamp = claim.expiresAt, o => o.finalizedBlock.number = receipt.blockNumber - 1n,
        o => o.runtimeCode = "0x", o => o.receipt.gasUsed = transaction.gas + 1n]) {
        const copy = structuredClone(observed); mutate(copy);
        assert.throws(() => rewardProgrammeClubPaymentFromObservationV3(plan, attempt.transactionHash, copy));
      }
      await assert.rejects(observe({ ...c, readContract: async args => {
        const value = await c.readContract(args);
        if (args.address.toLowerCase() === encoded.to.toLowerCase() && args.functionName === "entitlements")
          return value.map((item, i) => i === 3 ? item + 1n : item);
        return value;
      } }), { code: "reward_payment_award_mismatch" });
      await assert.rejects(observe({ ...c, getTransaction: async args => {
        const tx = await c.getTransaction(args); return args.hash === attempt.transactionHash ? { ...tx, gas: tx.gas + 1n } : tx;
      } }), { code: "reward_payment_signed_transaction_mismatch" });
      await assert.rejects(observe({ ...c, getTransactionReceipt: args => {
        if (args.hash === attempt.transactionHash) throw Error("private-provider-credential"); return c.getTransactionReceipt(args);
      } }), error => error.code === "reward_club_payment_observation_unavailable" && !String(error).includes("credential"));
      for (const target of [witness.provenance.deploymentBlockNumber, witness.observation.review.stageBlockNumber, receipt.blockNumber]) {
        let consentReads = 0;
        await assert.rejects(observe({ ...c,
          readContract: args => { if (args.functionName === "isValidSignature") consentReads++; return c.readContract(args); },
          getBlock: async args => {
            const block = await c.getBlock(args);
            return consentReads >= 2 && args.blockNumber === target ? { ...block, hash: badHash } : block;
          },
        }), { code: "reward_chain_changed_during_observation" });
      }
    });
    await t.test("later actual Safe control change, campaign pause, expiry and return cannot erase club payment", async () => {
      const snapshot = await chain.testClient.snapshot();
      try {
        await executeSafeThreshold(chain, safe, 1n);
        await assert.rejects(verifyRewardClubSafeConsentV3(c, { safe: e.treasury.safe, campaignContext: context, claim, signature: proofs.recipient }),
          { code: "reward_club_two_signatures_required" });
        assert.equal((await observe()).payment.transactionHash, attempt.transactionHash);
        const write = async (functionName, args = []) => {
          const hash = await chain.operatorClient.writeContract({ address: encoded.to, abi: rewardCampaignV3Abi, functionName, args });
          assert.equal((await c.waitForTransactionReceipt({ hash, timeout: 10000 })).status, "success");
          await chain.testClient.mine({ blocks: 96, interval: 1 });
        };
        await write("pause"); assert.equal((await observe()).checkpoint.observation.accounting.paused, true);
        await write("resume");
        await chain.testClient.setNextBlockTimestamp({ timestamp: claim.expiresAt + 1n });
        await chain.testClient.mine({ blocks: 96, interval: 1 });
        assert.equal((await observe()).payment.amount, claim.amount);
        const current = await observe();
        await chain.testClient.setNextBlockTimestamp({ timestamp: current.checkpoint.observation.accounting.claimDeadline + 1n });
        await write("close"); await write("returnToTreasury");
        assert.equal((await observe()).checkpoint.observation.accounting.nativeBalance, 0n);
      } finally { await chain.testClient.revert({ id: snapshot }); }
      assert.equal((await observe()).payment.amount, claim.amount);
    });
  }
  return { data: encoded.data, plan, serialized, result, observe };
}
