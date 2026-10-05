import { type Address,type Hex } from "viem";
import { normalizeRewardAthleteClaimExpectation,verifyRewardClaimEoaProof } from "./claim-reader.js";
import { encodeRewardClaim,rewardClaimMessages,rewardClaimDigests,type RewardClaim } from "./claims.js";
import { rewardCampaignBuild,type RewardDeploymentExpectation } from "./deployment.js";
import type { RewardLifecycleUpload } from "./lifecycle.js";
import { demand,signatureBytes,uint,walletAddress } from "./validation.js";
import { rewardSignedPaymentBytes,verifyRewardSignedPaymentEnvelope } from "./signed-payment-envelope.js";

/** Private approved records only. Nonce is the separate relayer transaction
 * nonce, NOT the entitlement's revocable authorization nonce. No reservation or
 * fresh identity/source/send authority is implied by this protocol object. */
export type RewardAthletePaymentPlan={deployment:RewardDeploymentExpectation;upload:RewardLifecycleUpload;claim:RewardClaim;
  proofs:{operator:Hex;recipient:Hex};relayerAddress:Address;nonce:bigint};

export function normalizeRewardAthletePaymentPlan(input:RewardAthletePaymentPlan){
  const e=normalizeRewardAthleteClaimExpectation({deployment:input.deployment,upload:input.upload,
    entitlementId:input.claim.entitlementId,recipient:input.claim.recipient});
  const c=rewardClaimMessages(e.deployment.context,input.claim).consent.message;
  demand(c.entitlementId===e.entitlementId&&c.recipient===e.recipient&&c.amount===e.award.amount&&c.pot===e.award.pot
    &&c.allocationDigest===e.upload.allocationDigest,"reward_payment_claim_mismatch");
  demand(c.nonce<(1n<<256n)-1n,"reward_claim_nonce_exhausted");
  const relayerAddress=walletAddress(input.relayerAddress);const nonce=uint(input.nonce,64);
  demand(nonce<=BigInt(Number.MAX_SAFE_INTEGER),"invalid_reward_payment_nonce");
  demand(![e.deployment.operatorAddress,e.deployment.treasuryAddress,e.recipient].some(a=>a.toLowerCase()===relayerAddress.toLowerCase()),
    "reward_separate_relayer_required");
  const claim:RewardClaim={entitlementId:c.entitlementId,recipient:c.recipient,amount:c.amount,pot:c.pot===0?"race":"league",
    nonce:c.nonce,issuedAt:c.issuedAt,expiresAt:c.expiresAt,allocationDigest:c.allocationDigest};
  const proofs={operator:signatureBytes(input.proofs.operator),recipient:signatureBytes(input.proofs.recipient)};
  demand(proofs.operator.length===132&&proofs.recipient.length===132,"invalid_reward_claim_signature");
  return {deployment:e.deployment,upload:e.upload,claim,proofs,relayerAddress,nonce};
}

/** Full signature recovery is required before signing, storing and private reads.
 * Historical signatures may still verify after expiry; execution checks are separate. */
export async function verifyRewardAthletePaymentPlan(input:RewardAthletePaymentPlan){
  const p=normalizeRewardAthletePaymentPlan(input);
  await Promise.all([verifyRewardClaimEoaProof(p.deployment.context,p.claim,"operator",p.deployment.operatorAddress,p.proofs.operator),
    verifyRewardClaimEoaProof(p.deployment.context,p.claim,"recipient",p.deployment.operatorAddress,p.proofs.recipient)]);
  return p;
}

/** Encoding only; no signing, gas selection, nonce reservation or transmission. */
export function encodeRewardAthletePayment(input:RewardAthletePaymentPlan){
  const p=normalizeRewardAthletePaymentPlan(input);
  return{chainId:p.deployment.context.chainId,to:p.deployment.context.verifyingContract,nonce:Number(p.nonce),value:0n,
    data:encodeRewardClaim(p.deployment.context,p.claim,p.proofs)};
}

/** Verifies exact canonical EIP-1559 bytes and all three synthetic/real signer
 * roles. Never accepts arbitrary calls, delegation, value or a substitute nonce. */
export async function verifySignedRewardAthletePayment(input:RewardAthletePaymentPlan,serialized:Hex){
  const fixed=normalizeRewardAthletePaymentPlan(input);
  const signedTransaction=rewardSignedPaymentBytes(serialized,2048);
  const p=await verifyRewardAthletePaymentPlan(fixed);const encoded=encodeRewardAthletePayment(p);
    const envelope=await verifyRewardSignedPaymentEnvelope(encoded,p.relayerAddress,signedTransaction,2048);
    const digests=rewardClaimDigests(p.deployment.context,p.claim);
    return{schemaVersion:1 as const,action:"pay_athlete" as const,chainId:encoded.chainId,...envelope,
      nonce:p.nonce,contractAddress:encoded.to.toLowerCase() as Address,
      buildId:rewardCampaignBuild.id,entitlementId:p.claim.entitlementId,recipient:p.claim.recipient.toLowerCase() as Address,
      amount:p.claim.amount,pot:p.claim.pot,authorizationNonce:p.claim.nonce,issuedAt:p.claim.issuedAt,expiresAt:p.claim.expiresAt,
      allocationDigest:p.claim.allocationDigest,operatorDigest:digests.authorization,recipientDigest:digests.consent};
}
