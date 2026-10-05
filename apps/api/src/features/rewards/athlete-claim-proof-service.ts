import { requireReward } from "@raceson/domain/rewards";
import { readRewardAthleteClaimProofs, storeRewardAthleteClaimProof, rewardDocumentUuid as uuid,
  type RewardAccountIdentity, type RewardAthleteClaimProofContext, type RewardLedgerRpc } from "@raceson/db/rewards";
import { normalizeRewardAthleteClaimExpectation, readRewardCreationBytecode, readVerifiedRewardAthleteClaim, rewardClaimMessages, verifyRewardWalletControl,
  verifyRewardClaimEoaProof, requireLiveRewardClaim, rewardCampaignBuild, type RewardCampaignReader, type RewardClaim } from "@raceson/rewards-chain";
import type { RewardPortalConfig } from "./request-identity.js";

type Input={intentId:string;role:"recipient"|"operator"};
type ReadDeps=RewardPortalConfig&{rpc?:RewardLedgerRpc};
function fixedScope(identity:RewardAccountIdentity,input:Input){
  requireReward(input.role==="operator"||input.role==="recipient","invalid_reward_claim_proof_role");
  return {identity:{userId:uuid(identity.userId),sessionId:uuid(identity.sessionId)},request:{intentId:uuid(input.intentId),role:input.role}};
}
/** Private full-package reconstruction. Historical proof validation is not a
 * current execution lease, active identity approval or permission to send. */
export async function verifyStoredAthleteRewardClaimProofs(context:RewardAthleteClaimProofContext,config:RewardPortalConfig){
  const {intent,reviewContext,upload,checkpoint}=context;const u=upload.body;const d=checkpoint.deployment;
  requireReward(reviewContext.chainId===config.chainId&&reviewContext.challenge.origin===config.origin,"reward_wallet_context_mismatch");
  requireReward(reviewContext.challenge.proof,"reward_destination_proof_required");
  const wallet=await verifyRewardWalletControl(reviewContext.challenge,reviewContext.challenge.proof.signature);
  requireReward(wallet.messageHash===reviewContext.challenge.proof.messageHash,"invalid_reward_claim_proof_document");
  // Instance runtime hashes include constructor immutables. The saved registry
  // must match the intent; a fresh chain read checks its full pinned runtime.
  requireReward(d.buildId===rewardCampaignBuild.id&&d.creationCodeHash===rewardCampaignBuild.creationCodeHash,"reward_claim_campaign_not_ready");
  const expected=normalizeRewardAthleteClaimExpectation({deployment:{context:{environment:d.chainId===31337?"local-simulation":"monad-testnet",
    chainId:d.chainId,verifyingContract:d.contractAddress},operatorAddress:u.operatorAddress,treasuryAddress:u.treasuryAddress,
    programmeId:u.programmeId,campaignId:u.campaignId,programmeManifestHash:u.programmeManifestHash,enabledPot:u.enabledPot,
    deploymentTransactionHash:d.deploymentTransactionHash,deploymentNonce:d.deploymentNonce},upload:u,
    entitlementId:context.entitlement.onChainId,recipient:intent.recipientAddress});
  const claim:RewardClaim={entitlementId:expected.entitlementId,recipient:expected.recipient,amount:expected.award.amount,
    pot:expected.award.pot===0?"race":"league",nonce:intent.nonce,issuedAt:intent.issuedAt,expiresAt:intent.expiresAt,allocationDigest:expected.upload.allocationDigest};
  for(const saved of context.proofs){
    const proof=await verifyRewardClaimEoaProof(expected.deployment.context,claim,saved.role,u.operatorAddress,saved.signature);
    requireReward(proof.digest===saved.digest&&proof.signer===saved.signer,"invalid_reward_claim_proof_document");
  }
  return {context,expected,claim,messages:rewardClaimMessages(expected.deployment.context,claim)};
}
/** Contains exact payout capabilities and private identity evidence. Internal
 * service/worker use only; NOT a browser response and NOT fresh send authority. */
export async function loadVerifiedAthleteRewardClaimProofs(identity:RewardAccountIdentity,input:Input,deps:ReadDeps){
  const fixed=fixedScope(identity,input);const {rpc,chainId,origin}=deps;
  return verifyStoredAthleteRewardClaimProofs(await readRewardAthleteClaimProofs(fixed.identity,fixed.request,rpc),{chainId,origin});
}
/** Caller supplies only its own exact signature and retry key, never a claim
 * amount, actor/session, window, witness, destination or transaction. */
export async function submitAthleteRewardClaimProof(identity:RewardAccountIdentity,input:Input&{signature:`0x${string}`;idempotencyKey:string},
  deps:ReadDeps&{reader:RewardCampaignReader;creationCode?:`0x${string}`}){
  const fixed=fixedScope(identity,input);const signature=input.signature;const idempotencyKey=input.idempotencyKey;
  requireReward(typeof idempotencyKey==="string"&&idempotencyKey.length>=8&&idempotencyKey.length<=128,"invalid_reward_claim_proof_request");
  const {rpc,reader,creationCode,chainId,origin}=deps;
  let loaded=await loadVerifiedAthleteRewardClaimProofs(fixed.identity,fixed.request,{rpc,chainId,origin});
  const proof=await verifyRewardClaimEoaProof(loaded.expected.deployment.context,loaded.claim,fixed.request.role,
    loaded.expected.deployment.operatorAddress,signature);
  const existing=loaded.context.proofs.find(p=>p.role===fixed.request.role);
  if(existing){
    requireReward(existing.signature===proof.signature&&existing.digest===proof.digest&&existing.idempotencyKey===idempotencyKey,"reward_ledger_idempotency_conflict");
  }else{
    const r=loaded.context.reviewContext;
    requireReward(r.reviewState==="reviewed"&&r.latestReview?.reviewId===loaded.context.intent.readinessReviewId,"reward_claim_readiness_required");
    requireReward(fixed.request.role!=="operator"||loaded.context.proofs.some(p=>p.role==="recipient"),"reward_claim_recipient_consent_required");
    const code=creationCode??await readRewardCreationBytecode(reader,loaded.expected.deployment);
    const witness=await readVerifiedRewardAthleteClaim(reader,loaded.expected,code);
    requireReward(witness.award.nonce===loaded.claim.nonce,"reward_claim_not_live");
    requireLiveRewardClaim(loaded.expected.deployment.context,loaded.claim,witness.observation.finalizedBlock.timestamp,witness.observation.accounting.claimDeadline);
    const saved=await storeRewardAthleteClaimProof(fixed.identity,{...fixed.request,idempotencyKey,proof,witness,observedAt:new Date().toISOString()},rpc);
    loaded=await verifyStoredAthleteRewardClaimProofs(saved,{chainId,origin});
  }
  const saved=loaded.context.proofs.find(p=>p.role===fixed.request.role)!;
  return {proofId:saved.proofId,intentId:saved.intentId,role:saved.role,recordedAt:saved.recordedAt,expiresAt:loaded.claim.expiresAt.toString()};
}
