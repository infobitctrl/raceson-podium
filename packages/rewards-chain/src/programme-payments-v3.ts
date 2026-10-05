import { encodeAbiParameters, encodeEventTopics, parseTransaction, type Address, type Hex, type Transaction, type TransactionReceipt } from "viem";
import { normalizeRewardProgrammeAthleteClaimExpectationV3, readVerifiedRewardProgrammeAthleteClaimV3,
  readVerifiedRewardProgrammePaidAthleteV3, type RewardClaimReaderV3, type RewardProgrammeAthleteClaimExpectationV3 } from "./claim-reader-v3.js";
import { rewardCampaignV3Abi as abi, rewardClaimMessagesV3, rewardClaimDigestsV3, encodeRewardClaimV3,
  verifyRewardClaimEoaProofV3 } from "./campaign-v3.js";
import { requireLiveRewardClaim, type RewardClaim } from "./claims.js";
import { rewardCampaignV3Build, verifyRewardRuntimeV3 } from "./deployment-v3.js";
import { rewardSignedPaymentBytes, verifyRewardSignedPaymentEnvelope } from "./signed-payment-envelope.js";
import { bytes32, demand, RewardProtocolError, signatureBytes, uint, walletAddress } from "./validation.js";

/** Private approved programme-child records only. The relayer transaction nonce
 * is separate from the award authorization nonce. This object reserves neither
 * and is not a source/readiness approval, execution lease or permission to send. */
export type RewardProgrammeAthletePaymentPlanV3 = {
  protocolVersion: 3; expectation: RewardProgrammeAthleteClaimExpectationV3; claim: RewardClaim;
  proofs: { operator: Hex; recipient: Hex }; relayerAddress: Address; nonce: bigint;
};

export function normalizeRewardProgrammeAthletePaymentV3(input: RewardProgrammeAthletePaymentPlanV3) {
  demand(input.protocolVersion === 3, "wrong_reward_payment_protocol");
  const expectation = normalizeRewardProgrammeAthleteClaimExpectationV3(input.expectation), d = expectation.deployment;
  const c = rewardClaimMessagesV3(d.context, input.claim).consent.message;
  demand(c.entitlementId === expectation.entitlementId && c.recipient === expectation.recipient && c.amount === expectation.award.amount
    && c.pot === expectation.award.pot && c.allocationDigest === expectation.upload.allocationDigest, "reward_payment_claim_mismatch");
  demand(c.nonce < (1n << 256n) - 1n, "reward_claim_nonce_exhausted");
  const relayerAddress = walletAddress(input.relayerAddress), nonce = uint(input.nonce, 64);
  demand(nonce <= BigInt(Number.MAX_SAFE_INTEGER), "invalid_reward_payment_nonce");
  demand(![d.operatorAddress, d.treasuryAddress, expectation.programme.funderAddress, expectation.recipient]
    .some(a => a.toLowerCase() === relayerAddress.toLowerCase()), "reward_separate_relayer_required");
  const proofs = { operator: signatureBytes(input.proofs.operator), recipient: signatureBytes(input.proofs.recipient) };
  demand(proofs.operator.length === 132 && proofs.recipient.length === 132, "invalid_reward_claim_signature");
  const claim: RewardClaim = { entitlementId: c.entitlementId, recipient: c.recipient, amount: c.amount, pot: c.pot === 0 ? "race" : "league",
    nonce: c.nonce, issuedAt: c.issuedAt, expiresAt: c.expiresAt, allocationDigest: c.allocationDigest };
  return { protocolVersion: 3 as const, expectation, claim, proofs, relayerAddress, nonce };
}

export async function verifyRewardProgrammeAthletePaymentV3(input: RewardProgrammeAthletePaymentPlanV3) {
  const p = normalizeRewardProgrammeAthletePaymentV3(input), context = p.expectation.deployment.context;
  await Promise.all([verifyRewardClaimEoaProofV3(context, p.claim, "operator", p.expectation.programme.operatorAddress, p.proofs.operator),
    verifyRewardClaimEoaProofV3(context, p.claim, "recipient", p.expectation.programme.operatorAddress, p.proofs.recipient)]);
  return p;
}

/** Encoding only: never signs, selects gas, reserves a nonce or transmits. */
export function encodeRewardProgrammeAthletePaymentV3(input: RewardProgrammeAthletePaymentPlanV3) {
  const p = normalizeRewardProgrammeAthletePaymentV3(input), context = p.expectation.deployment.context;
  return { chainId: context.chainId, to: context.verifyingContract, nonce: Number(p.nonce), value: 0n,
    data: encodeRewardClaimV3(context, p.claim, p.proofs) };
}
const provenance = (p: ReturnType<typeof normalizeRewardProgrammeAthletePaymentV3>) => ({ kind: "programme-child" as const,
  programmeAddress: p.expectation.programme.context.verifyingContract.toLowerCase() as Address,
  deploymentTransactionHash: p.expectation.programme.deploymentTransactionHash, slot: p.expectation.slot });

export async function verifySignedRewardProgrammeAthletePaymentV3(input: RewardProgrammeAthletePaymentPlanV3, serialized: Hex) {
  const fixed = normalizeRewardProgrammeAthletePaymentV3(input), signedTransaction = rewardSignedPaymentBytes(serialized, 2048);
  const p = await verifyRewardProgrammeAthletePaymentV3(fixed), encoded = encodeRewardProgrammeAthletePaymentV3(p);
  const envelope = await verifyRewardSignedPaymentEnvelope(encoded, p.relayerAddress, signedTransaction, 2048);
  const digests = rewardClaimDigestsV3(p.expectation.deployment.context, p.claim);
  return { schemaVersion: 3 as const, protocolVersion: 3 as const, action: "pay_athlete" as const, chainId: encoded.chainId, ...envelope,
    nonce: p.nonce, contractAddress: encoded.to.toLowerCase() as Address, buildId: rewardCampaignV3Build.id, provenance: provenance(p),
    entitlementId: p.claim.entitlementId, recipient: p.claim.recipient.toLowerCase() as Address, amount: p.claim.amount, pot: p.claim.pot,
    authorizationNonce: p.claim.nonce, issuedAt: p.claim.issuedAt, expiresAt: p.claim.expiresAt,
    allocationDigest: p.claim.allocationDigest, operatorDigest: digests.authorization, recipientDigest: digests.consent };
}

/** Rechecks both signatures and finalized unpaid nonce/clock. A worker must
 * additionally recheck locked DB readiness/source, latest state, gas/nonce and
 * its lease immediately before broadcast. This is read-only and does not send. */
export async function readRewardProgrammeAthletePaymentPreflightV3(reader: RewardClaimReaderV3, input: RewardProgrammeAthletePaymentPlanV3) {
  const p = await verifyRewardProgrammeAthletePaymentV3(input);
  const witness = await readVerifiedRewardProgrammeAthleteClaimV3(reader, p.expectation);
  demand(witness.award.nonce === p.claim.nonce, "reward_payment_authorization_nonce_mismatch");
  requireLiveRewardClaim(p.expectation.deployment.context, p.claim, witness.observation.finalizedBlock.timestamp, witness.observation.accounting.claimDeadline);
  return witness;
}

type Block = { number: bigint; hash: Hex; timestamp: bigint };
export type RewardProgrammeAthletePaymentObservationV3 = {
  observedChainId: number; transaction: Transaction; receipt: TransactionReceipt;
  canonicalPaymentBlock: Block; finalizedBlock: Block; runtimeCode: Hex;
};

/** Exact successful EOA receipt only. Hash must come from a verified stored
 * signed attempt. This synchronous validator is not RPC consensus, signature
 * recovery or a DB payment commit. All public-chain IDs survive reconciliation. */
export function rewardProgrammeAthletePaymentFromObservationV3(input: RewardProgrammeAthletePaymentPlanV3, transactionHash: Hex,
  observed: RewardProgrammeAthletePaymentObservationV3) {
  const p = normalizeRewardProgrammeAthletePaymentV3(input), encoded = encodeRewardProgrammeAthletePaymentV3(p), hash = bytes32(transactionHash);
  const { receipt: r, transaction: tx } = observed;
  const block = { number: uint(observed.canonicalPaymentBlock.number), hash: bytes32(observed.canonicalPaymentBlock.hash), timestamp: uint(observed.canonicalPaymentBlock.timestamp) };
  const finalizedBlock = { number: uint(observed.finalizedBlock.number), hash: bytes32(observed.finalizedBlock.hash), timestamp: uint(observed.finalizedBlock.timestamp) };
  demand(observed.observedChainId === encoded.chainId && tx.chainId === encoded.chainId, "reward_payment_transaction_chain_mismatch");
  demand(r.status === "success", "reward_payment_reverted");
  demand(bytes32(r.transactionHash) === hash && bytes32(tx.hash) === hash, "reward_payment_transaction_mismatch");
  demand(r.to !== null && tx.to !== null && walletAddress(r.to) === encoded.to && walletAddress(tx.to) === encoded.to && r.contractAddress === null,
    "reward_payment_destination_mismatch");
  demand(walletAddress(r.from) === p.relayerAddress && walletAddress(tx.from) === p.relayerAddress, "reward_payment_sender_mismatch");
  demand(Number.isSafeInteger(tx.nonce) && tx.nonce === encoded.nonce, "reward_payment_nonce_mismatch");
  demand(tx.type === "eip1559" && tx.value === 0n && tx.input === encoded.data && (tx.accessList?.length ?? 0) === 0, "reward_payment_input_mismatch");
  demand(r.blockNumber === block.number && bytes32(r.blockHash) === block.hash && tx.blockNumber === block.number
    && tx.blockHash !== null && bytes32(tx.blockHash) === block.hash && Number.isSafeInteger(r.transactionIndex) && r.transactionIndex >= 0
    && tx.transactionIndex === r.transactionIndex, "reward_payment_receipt_mismatch");
  demand(block.number <= finalizedBlock.number && block.timestamp <= finalizedBlock.timestamp, "reward_payment_not_finalized");
  demand(block.number !== finalizedBlock.number || block.hash === finalizedBlock.hash && block.timestamp === finalizedBlock.timestamp,
    "reward_payment_not_canonical");
  // Historical receipt time, not today's clock. Later expiry must not erase payment.
  requireLiveRewardClaim(p.expectation.deployment.context, p.claim, block.timestamp, p.claim.expiresAt);
  const runtimeCodeHash = verifyRewardRuntimeV3(p.expectation.deployment, observed.runtimeCode);
  const topics = encodeEventTopics({ abi, eventName: "RewardPaid", args: { entitlementId: p.claim.entitlementId,
    recipient: p.claim.recipient, pot: p.claim.pot === "race" ? 0 : 1 } });
  const data = encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [p.claim.amount, p.claim.nonce]);
  demand(Array.isArray(r.logs) && r.logs.length === 1, "reward_payment_event_count_mismatch");
  const log = r.logs[0]!;
  demand(log.removed === false && log.logIndex !== null && Number.isSafeInteger(log.logIndex) && log.logIndex >= 0, "invalid_reward_payment_log");
  demand(log.blockNumber === block.number && log.blockHash === block.hash && log.transactionHash === hash && log.transactionIndex === r.transactionIndex,
    "reward_payment_log_receipt_mismatch");
  demand(walletAddress(log.address) === encoded.to && log.data.toLowerCase() === data && log.topics.length === topics.length
    && log.topics.every((topic, i) => topic.toLowerCase() === topics[i]), "reward_payment_event_mismatch");
  demand(tx.gas > 0n && uint(r.gasUsed) <= tx.gas && tx.maxFeePerGas !== undefined && uint(r.effectiveGasPrice) <= tx.maxFeePerGas,
    "reward_payment_gas_mismatch");
  return { schemaVersion: 3 as const, protocolVersion: 3 as const, action: "pay_athlete" as const, chainId: encoded.chainId,
    contractAddress: encoded.to.toLowerCase() as Address, relayerAddress: p.relayerAddress.toLowerCase() as Address, provenance: provenance(p),
    transactionHash: hash, nonce: p.nonce, blockNumber: block.number, blockHash: block.hash, blockTimestamp: block.timestamp,
    logIndex: log.logIndex, entitlementId: p.claim.entitlementId, recipient: p.claim.recipient.toLowerCase() as Address,
    amount: p.claim.amount, pot: p.claim.pot, authorizationNonce: p.claim.nonce, allocationDigest: p.claim.allocationDigest,
    gasLimit: tx.gas, gasUsed: r.gasUsed, effectiveGasPrice: r.effectiveGasPrice,
    // Limit-based Monad fee formula; not the measured local-Anvil account debit.
    monadGasLimitFee: uint(tx.gas * r.effectiveGasPrice), runtimeCodeHash, finalizedBlock };
}

const sameScalar = (value: unknown, expected: Hex | undefined) => typeof value === "string" && /^0x[0-9a-fA-F]{1,64}$/.test(value)
  && expected !== undefined && BigInt(value) === BigInt(expected);

/** Read-only recovery from the exact signed bytes, including after a lost send
 * response, later pause or expiry. Verifies factory provenance, staged package,
 * paid row/nonce, canonical finalized receipt, exact event and receipt-time EOA
 * code. Does not broadcast, mark a database row paid or renew a held claim. */
export async function readVerifiedRewardProgrammeAthletePaymentV3(reader: RewardClaimReaderV3,
  input: RewardProgrammeAthletePaymentPlanV3, signedTransaction: Hex) {
  const p = normalizeRewardProgrammeAthletePaymentV3(input);
  try {
    const attempt = await verifySignedRewardProgrammeAthletePaymentV3(p, signedTransaction);
    const checkpoint = await readVerifiedRewardProgrammePaidAthleteV3(reader, p.expectation), f = checkpoint.observation.finalizedBlock;
    demand(checkpoint.award.nonce === p.claim.nonce + 1n && checkpoint.observation.accounting.paid[p.expectation.upload.enabledPot] >= p.claim.amount,
      "reward_payment_award_mismatch");
    const [transaction, receipt] = await Promise.all([reader.getTransaction({ hash: attempt.transactionHash }), reader.getTransactionReceipt({ hash: attempt.transactionHash })]);
    demand(receipt.blockNumber <= f.number, "reward_payment_not_finalized");
    demand(receipt.blockNumber >= checkpoint.observation.review.stageBlockNumber, "reward_payment_before_deployment");
    const signed = parseTransaction(attempt.signedTransaction);
    demand(transaction.gas === attempt.gasLimit && transaction.maxFeePerGas === attempt.maxFeePerGas && transaction.maxPriorityFeePerGas === attempt.maxPriorityFeePerGas
      && sameScalar(transaction.r, signed.r) && sameScalar(transaction.s, signed.s) && transaction.yParity === signed.yParity,
      "reward_payment_signed_transaction_mismatch");
    const [block, runtimeCode, operatorCode, recipientCode] = await Promise.all([reader.getBlock({ blockNumber: receipt.blockNumber }),
      reader.getCode({ address: p.expectation.deployment.context.verifyingContract, blockNumber: receipt.blockNumber }),
      reader.getCode({ address: p.expectation.programme.operatorAddress, blockNumber: receipt.blockNumber }),
      reader.getCode({ address: p.claim.recipient, blockNumber: receipt.blockNumber })]);
    demand(block.number === receipt.blockNumber && block.hash !== null, "reward_payment_not_canonical");
    demand(runtimeCode !== undefined, "reward_deployment_code_missing");
    demand(operatorCode === undefined || operatorCode === "0x", "reward_claim_eoa_operator_required");
    demand(recipientCode === undefined || recipientCode === "0x", "reward_claim_eoa_recipient_required");
    const payment = rewardProgrammeAthletePaymentFromObservationV3(p, attempt.transactionHash, { observedChainId: p.expectation.programme.context.chainId,
      transaction, receipt, runtimeCode, canonicalPaymentBlock: { number: block.number, hash: block.hash, timestamp: block.timestamp }, finalizedBlock: f });
    const [chainAfter, finalAfter, anchorAfter, paidAfter] = await Promise.all([reader.getChainId(), reader.getBlock({ blockTag: "finalized" }),
      reader.getBlock({ blockNumber: f.number }), reader.getBlock({ blockNumber: receipt.blockNumber })]);
    demand(chainAfter === attempt.chainId, "reward_observed_chain_mismatch");
    demand(finalAfter.number !== null && finalAfter.hash !== null && finalAfter.number >= f.number && finalAfter.timestamp >= f.timestamp,
      "reward_finality_regressed");
    demand(anchorAfter.number === f.number && anchorAfter.hash !== null && bytes32(anchorAfter.hash) === f.hash && anchorAfter.timestamp === f.timestamp
      && (finalAfter.number !== f.number || bytes32(finalAfter.hash) === f.hash) && paidAfter.number === receipt.blockNumber && paidAfter.hash !== null
      && bytes32(paidAfter.hash) === payment.blockHash && paidAfter.timestamp === payment.blockTimestamp, "reward_chain_changed_during_observation");
    return { payment, checkpoint };
  } catch (error) {
    if (error instanceof RewardProtocolError) throw error;
    throw new RewardProtocolError("reward_payment_observation_unavailable");
  }
}
