import { readClaimV3, readPaymentStatusV3, type ClaimContextV3, type ClaimScopeV3,
  type RewardAccountIdentity, type RewardLedgerRpc } from "@raceson/db/rewards";
import { canonicalRewardJson } from "@raceson/rewards-chain";
import { requireReward } from "@raceson/domain/rewards";
import { traceWorkflowV3, type WorkflowTraceV3 } from "./workflow-v3-service.js";
type Payment = Awaited<ReturnType<typeof readPaymentStatusV3>>;
/** Pure whitelisted projection; receipt history is independent of today's
 * source/readiness and says nothing about current wallet balance. */
export function projectWorkflowStatusV3(claim: ClaimContextV3, payment: Payment) {
  const i = claim.intent, r = claim.readiness;
  requireReward(i && i.id === payment.claimId && i.uploadId === payment.uploadId && i.destinationId === payment.destinationId
    && i.entitlementId === payment.entitlementId && i.chainId === payment.chainId && i.recipientAddress === payment.recipientAddress
    && i.witness.amountWei.toString() === payment.amountWei, "reward_workflow_status_changed");
  const readinessCurrent = r.state === "reviewed" && r.review?.id === i.reviewId
    && r.source.sourceGuardHash === i.sourceGuardHash && r.profileFingerprint === i.profileFingerprint && !payment.readinessHeld;
  const recipientConsented = claim.proofs.some(p => p.role === "recipient"), operatorApproved = claim.proofs.some(p => p.role === "operator");
  const holds = [
    ...(!readinessCurrent ? ["readiness_review_required"] : []),
    ...(!recipientConsented ? ["recipient_consent_required"] : []),
    ...(!operatorApproved ? ["operator_approval_required"] : []),
  ];
  return {
    schema: "raceson-claim-workflow-status-v1" as const, chainId: payment.chainId, uploadId: payment.uploadId,
    destinationId: payment.destinationId, entitlementId: payment.entitlementId, claimId: payment.claimId,
    amountWei: payment.amountWei, recipientAddress: payment.recipientAddress,
    allocation: { recorded: true, sourceCurrent: r.source.current && r.source.sourceGuardHash === i.sourceGuardHash },
    readiness: { current: readinessCurrent, state: r.state },
    consent: { recipientRecorded: recipientConsented, operatorRecorded: operatorApproved,
      issuedAt: i.issuedAt.toString(), expiresAt: i.expiresAt.toString() },
    eligibility: { state: "not_observed" as const, claimable: false, holds },
    payment: { state: payment.state, paymentId: payment.paymentId, transactionHash: payment.transactionHash,
      submitted: ["submitted", "confirmed"].includes(payment.state), verified: payment.confirmed },
    receipt: payment.confirmed ? { transactionHash: payment.transactionHash, blockNumber: payment.blockNumber,
      blockHash: payment.blockHash, amountWei: payment.amountWei, recipientAddress: payment.recipientAddress } : null,
  };
}
export function sameWorkflowClaimV3(a: ClaimContextV3, b: ClaimContextV3) {
  const stable = (c: ClaimContextV3) => {
    const { checkedAt: _observedAt, ...challenge } = c.readiness.challenge;
    return { ...c, readiness: { ...c.readiness, challenge } };
  };
  // checkedAt is the fresh read clock, not a claim/review expiry or proof field.
  return canonicalRewardJson(stable(a)) === canonicalRewardJson(stable(b));
}
export async function readWorkflowStatusV3(actor: RewardAccountIdentity, scope: ClaimScopeV3,
  deps: { rpc?: RewardLedgerRpc; trace?: WorkflowTraceV3 } = {}) {
  const fixedActor = { ...actor }, fixedScope = { ...scope };
  return traceWorkflowV3(deps.trace, "claim_status", async () => {
    const before = await readClaimV3(fixedActor, fixedScope, deps.rpc);
    const payment = await readPaymentStatusV3(fixedActor, fixedScope, deps.rpc);
    const after = await readClaimV3(fixedActor, fixedScope, deps.rpc);
    // Fresh authorization and consistency across the two repository projections.
    requireReward(sameWorkflowClaimV3(before, after), "reward_workflow_status_changed");
    return projectWorkflowStatusV3(after, payment);
  });
}
