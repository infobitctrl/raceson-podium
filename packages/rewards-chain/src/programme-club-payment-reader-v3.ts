import { parseTransaction, type Hex } from "viem";
import { readRewardProgrammeClubAwardV3 } from "./claim-reader-v3.js";
import { normalizeRewardProgrammeClubPaymentV3, verifySignedRewardProgrammeClubPaymentV3,
  type RewardProgrammeClubPaymentPlanV3 } from "./programme-club-payments-v3.js";
import { rewardProgrammeClubPaymentFromObservationV3 } from "./programme-club-payment-receipts-v3.js";
import { verifyRewardClubSafeConsentV3 } from "./club-safe.js";
import type { RewardProgrammeClubClaimReaderV3 } from "./club-claim-reader-v3.js";
import { bytes32, demand, RewardProtocolError } from "./validation.js";

const sameScalar = (value: unknown, expected: Hex | undefined) => typeof value === "string" && /^0x[0-9a-fA-F]{1,64}$/.test(value)
  && expected !== undefined && BigInt(value) === BigInt(expected);

/** Historical receipt recovery, not permission for a fresh claim. The exact
 * signed attempt, parent/child, package, publication, paid CLUB row and two
 * ordered receipt events must agree. Verify Safe consent at its SAVED block
 * and at receipt time, never require today's Safe ownership after payment.
 * No signer, database writer, broadcaster or invented human review here. */
export async function readVerifiedRewardProgrammeClubPaymentV3(reader: RewardProgrammeClubClaimReaderV3,
  input: RewardProgrammeClubPaymentPlanV3, signedTransaction: Hex) {
  const p = normalizeRewardProgrammeClubPaymentV3(input), e = p.expectation;
  try {
    const attempt = await verifySignedRewardProgrammeClubPaymentV3(reader, p, signedTransaction);
    const checkpoint = await readRewardProgrammeClubAwardV3(reader, e, "paid"), f = checkpoint.observation.finalizedBlock;
    demand(checkpoint.award.nonce === p.claim.nonce + 1n && checkpoint.observation.accounting.paid[e.upload.enabledPot] >= p.claim.amount,
      "reward_payment_award_mismatch");
    const [transaction, receipt] = await Promise.all([
      reader.getTransaction({ hash: attempt.transactionHash }), reader.getTransactionReceipt({ hash: attempt.transactionHash })]);
    demand(receipt.blockNumber <= f.number, "reward_payment_not_finalized");
    demand(receipt.blockNumber >= checkpoint.observation.review.stageBlockNumber, "reward_payment_before_deployment");
    const signed = parseTransaction(attempt.signedTransaction);
    demand(transaction.gas === attempt.gasLimit && transaction.maxFeePerGas === attempt.maxFeePerGas && transaction.maxPriorityFeePerGas === attempt.maxPriorityFeePerGas
      && sameScalar(transaction.r, signed.r) && sameScalar(transaction.s, signed.s) && transaction.yParity === signed.yParity,
      "reward_payment_signed_transaction_mismatch");
    const [block, runtimeCode, operatorCode] = await Promise.all([reader.getBlock({ blockNumber: receipt.blockNumber }),
      reader.getCode({ address: e.deployment.context.verifyingContract, blockNumber: receipt.blockNumber }),
      reader.getCode({ address: e.programme.operatorAddress, blockNumber: receipt.blockNumber })]);
    demand(block.number === receipt.blockNumber && block.hash !== null, "reward_payment_not_canonical");
    demand(runtimeCode !== undefined, "reward_deployment_code_missing");
    demand(operatorCode === undefined || operatorCode === "0x", "reward_claim_eoa_operator_required");
    const payment = rewardProgrammeClubPaymentFromObservationV3(p, attempt.transactionHash, { observedChainId: e.programme.context.chainId,
      transaction, receipt, runtimeCode, canonicalPaymentBlock: { number: block.number, hash: block.hash, timestamp: block.timestamp }, finalizedBlock: f });
    await verifyRewardClubSafeConsentV3(reader, { safe: e.treasury.safe, campaignContext: e.deployment.context,
      claim: p.claim, signature: p.proofs.recipient,
      checkpoint: { number: payment.blockNumber, hash: payment.blockHash, timestamp: payment.blockTimestamp } });
    const anchors = [f, { number: payment.blockNumber, hash: payment.blockHash, timestamp: payment.blockTimestamp },
      p.consentCheckpoint, e.review.reviewedBlock, e.review.deploymentBlock];
    const [chain, head, canonical, stageAfter, programmeAfter] = await Promise.all([reader.getChainId(), reader.getBlock({ blockTag: "finalized" }),
      Promise.all(anchors.map(b => reader.getBlock({ blockNumber: b.number }))),
      reader.getBlock({ blockNumber: checkpoint.observation.review.stageBlockNumber }),
      reader.getBlock({ blockNumber: checkpoint.provenance.deploymentBlockNumber })]);
    demand(chain === attempt.chainId, "reward_observed_chain_mismatch");
    demand(head.number !== null && head.hash !== null && head.number >= f.number && head.timestamp >= f.timestamp, "reward_finality_regressed");
    demand(canonical.every((b, i) => b.number === anchors[i].number && b.hash !== null && bytes32(b.hash) === anchors[i].hash && b.timestamp === anchors[i].timestamp)
      && anchors.every(b => head.number !== b.number || (bytes32(head.hash!) === b.hash && head.timestamp === b.timestamp))
      && stageAfter.number === checkpoint.observation.review.stageBlockNumber && stageAfter.hash !== null
      && bytes32(stageAfter.hash) === checkpoint.observation.review.stageBlockHash
      && programmeAfter.number === checkpoint.provenance.deploymentBlockNumber && programmeAfter.hash !== null
      && bytes32(programmeAfter.hash) === checkpoint.provenance.deploymentBlockHash, "reward_chain_changed_during_observation");
    return { payment, checkpoint };
  } catch (error) {
    if (error instanceof RewardProtocolError) throw error;
    throw new RewardProtocolError("reward_club_payment_observation_unavailable");
  }
}
