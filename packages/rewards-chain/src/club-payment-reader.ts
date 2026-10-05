import { parseTransaction, type Hex } from "viem";
import { rewardCampaignAbi } from "./abi.js";
import { readVerifiedRewardCampaign } from "./campaign-checkpoint.js";
import { requireRewardCreationBytecode } from "./deployment.js";
import { normalizeRewardClubPaymentPlan, verifySignedRewardClubPayment, type RewardClubPaymentPlan } from "./club-payments.js";
import { rewardClubPaymentFromObservation } from "./club-payment-receipts.js";
import type { RewardClubClaimReader } from "./club-claim-reader.js";
import { bytes32, demand, RewardProtocolError, walletAddress } from "./validation.js";

const sameScalar = (value: unknown, expected: Hex | undefined) => typeof value === "string" && /^0x[0-9a-fA-F]{1,64}$/.test(value)
  && expected !== undefined && BigInt(value) === BigInt(expected);

/** Read-only reconciliation of an exact club signed attempt and both actual
 * receipt events. Later pause/expiry or changed Safe control cannot erase a
 * canonical payment. This intentionally verifies Safe consent at its SAVED
 * checkpoint, not current control or fresh source/identity/send permission. */
export async function readVerifiedRewardClubPayment(reader: RewardClubClaimReader, input: RewardClubPaymentPlan, signedTransaction: Hex, creationCode: Hex) {
  const p = normalizeRewardClubPaymentPlan(input), code = requireRewardCreationBytecode(creationCode), e = p.expected;
  try {
    const attempt = await verifySignedRewardClubPayment(reader, p, signedTransaction);
    const checkpoint = await readVerifiedRewardCampaign(reader, e.deployment, code), f = checkpoint.observation.finalizedBlock;
    const [transaction, receipt] = await Promise.all([reader.getTransaction({ hash: attempt.transactionHash }), reader.getTransactionReceipt({ hash: attempt.transactionHash })]);
    demand(receipt.blockNumber <= f.number, "reward_payment_not_finalized");
    demand(receipt.blockNumber >= checkpoint.deployment.deploymentBlockNumber, "reward_payment_before_deployment");
    const signed = parseTransaction(attempt.signedTransaction);
    demand(transaction.gas === attempt.gasLimit && transaction.maxFeePerGas === attempt.maxFeePerGas && transaction.maxPriorityFeePerGas === attempt.maxPriorityFeePerGas
      && sameScalar(transaction.r, signed.r) && sameScalar(transaction.s, signed.s) && transaction.yParity === signed.yParity, "reward_payment_signed_transaction_mismatch");
    const [block, runtimeCode, row] = await Promise.all([reader.getBlock({ blockNumber: receipt.blockNumber }),
      reader.getCode({ address: e.deployment.context.verifyingContract, blockNumber: f.number }),
      reader.readContract({ address: e.deployment.context.verifyingContract, abi: rewardCampaignAbi, functionName: "entitlements", args: [p.claim.entitlementId], blockNumber: f.number })]);
    demand(block.number === receipt.blockNumber && block.hash !== null, "reward_payment_not_canonical");
    demand(runtimeCode !== undefined, "reward_deployment_code_missing");
    const payment = rewardClubPaymentFromObservation(p, attempt.transactionHash, { observedChainId: checkpoint.deployment.chainId, transaction, receipt, runtimeCode,
      canonicalPaymentBlock: { number: block.number, hash: block.hash, timestamp: block.timestamp }, finalizedBlock: f });
    const u = e.upload, a = checkpoint.observation.accounting, award = e.award;
    demand([3, 4].includes(a.state) && a.accountedFunding === u.budgets[u.enabledPot] && a.budgets[u.enabledPot] === u.budgets[u.enabledPot]
      && a.allocated[u.enabledPot] === u.allocated[u.enabledPot] && a.paid[u.enabledPot] >= p.claim.amount && a.entitlementCount === u.entitlementCount
      && a.uploadDigest === u.uploadDigest && a.snapshotDigest === u.snapshotDigest && a.allocationDigest === u.allocationDigest, "reward_payment_checkpoint_mismatch");
    demand(bytes32(row[0]) === award.beneficiaryId && row[1] === p.claim.amount && bytes32(row[2]) === award.explanationHash && row[3] === p.claim.nonce + 1n
      && walletAddress(row[4]) === p.claim.recipient && row[5] === award.pot && row[6] === true && row[7] === 1, "reward_payment_award_mismatch");
    const anchors = [f, { number: payment.blockNumber, hash: payment.blockHash, timestamp: payment.blockTimestamp },
      p.consentCheckpoint, e.review.reviewedBlock, e.review.deploymentBlock];
    const [chain, head, canonical] = await Promise.all([reader.getChainId(), reader.getBlock({ blockTag: "finalized" }),
      Promise.all(anchors.map(b => reader.getBlock({ blockNumber: b.number })))]);
    demand(chain === attempt.chainId, "reward_observed_chain_mismatch");
    demand(head.number !== null && head.hash !== null && head.number >= f.number && head.timestamp >= f.timestamp, "reward_finality_regressed");
    demand(canonical.every((b, i) => b.number === anchors[i].number && b.hash !== null && bytes32(b.hash) === anchors[i].hash && b.timestamp === anchors[i].timestamp)
      && anchors.every(b => head.number !== b.number || (bytes32(head.hash!) === b.hash && head.timestamp === b.timestamp)), "reward_chain_changed_during_observation");
    return { payment, checkpoint };
  } catch (error) { if (error instanceof RewardProtocolError) throw error; throw new RewardProtocolError("reward_club_payment_observation_unavailable"); }
}
