import assert from "node:assert/strict";
import { toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { rewardWalletControlMessage, verifyRewardWalletControl } from "../../../../packages/rewards-chain/dist/index.js";

export const readinessId = n => `78000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const id = readinessId;
const signer = privateKeyToAccount(toHex(994n,{size:32})); // Synthetic, no real assets.
export async function readinessFixture(chainId=31337) {
  const identity={userId:id(1),sessionId:id(2)};const config={chainId,origin:"http://127.0.0.1:5173"};
  const c={challengeId:id(3),userId:id(4),sessionId:id(5),...config,address:signer.address.toLowerCase(),nonce:"d".repeat(64),
    issuedAt:"2026-09-08T07:00:00Z",expiresAt:"2026-09-08T07:10:00Z",checkedAt:"2026-09-08T09:00:00Z",idempotencyKey:"readiness-wallet",proof:null};
  const signature=await signer.signMessage({message:rewardWalletControlMessage(c)});
  c.proof={proofId:id(6),...await verifyRewardWalletControl(c,signature),verifiedAt:"2026-09-08T07:00:01Z"};
  const d={requestId:id(7),userId:id(4),sessionId:id(5),athleteProfileId:id(8),proofId:id(6),address:c.address,chainId,
    requestedAt:"2026-09-08T07:00:02Z",idempotencyKey:"readiness-destination",withdrawnAt:null,status:"pending_review"};
  const attestation={schemaVersion:1,policy:"operator-observed-external-wallet-v1",verifiedDateOfBirth:"1990-01-01",
    identityEvidenceRef:id(10),adultEvidenceRef:id(11),walletMfaEvidenceRef:id(12),walletRecoveryEvidenceRef:id(13)};
  const input={programmeId:id(9),requestId:id(7),expectedProfileFingerprintSha256:"a".repeat(64),expectedRevision:0,attestation,idempotencyKey:"review-readiness"};
  const context={programmeId:id(9),operatorUserId:id(1),chainId:31337,destination:d,challenge:c,profileFingerprintSha256:"a".repeat(64),
    dateOfBirth:"1990-01-01",birthYear:1990,latestReview:null,reviewState:"unreviewed"};
  const review={reviewId:id(14),programmeId:id(9),requestId:id(7),revision:1,reviewedByUserId:id(1),reviewedSessionId:id(2),
    reviewedAt:"2026-09-08T09:00:01Z",profileFingerprintSha256:"a".repeat(64),attestation,idempotencyKey:input.idempotencyKey,revokedAt:null,revocationReason:null};
  const calls=[];const rpc=async(name,args)=>{
    calls.push({name,args:structuredClone(args)});assert.equal(args.p_actor_user_id,id(1));assert.equal(args.p_actor_session_id,id(2));assert.equal(args.p_programme_id,id(9));
    if(name==="service_read_reward_athlete_review_context")return{data:structuredClone(context),error:null};
    if(name==="service_revoke_reward_athlete_review")return{data:{...structuredClone(review),revokedAt:"2026-09-08T09:00:02Z",revocationReason:args.p_reason},error:null};
    return{data:structuredClone(review),error:null};
  };
  return{identity,config,context,review,input,calls,rpc};
}
