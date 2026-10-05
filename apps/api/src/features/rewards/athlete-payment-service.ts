import { requireReward } from "@raceson/domain/rewards";
import { readRewardAthletePaymentContext,reserveRewardAthletePaymentIntent,readRewardAthletePaymentAttempt,storeRewardAthletePaymentAttempt,
  rewardDocumentUuid as uuid,type RewardAccountIdentity,type RewardAthletePaymentContext,type RewardLedgerRpc } from "@raceson/db/rewards";
import { canonicalRewardJson,normalizeRewardAthletePaymentPlan,verifySignedRewardAthletePayment,readVerifiedRewardAthleteClaim,
  requireLiveRewardClaim,readRewardPendingNonce,RewardProtocolError,type RewardCampaignReader,type RewardNonceReader } from "@raceson/rewards-chain";
import { verifyStoredAthleteRewardClaimProofs } from "./athlete-claim-proof-service.js";
import type { RewardPortalConfig } from "./request-identity.js";

type Config=RewardPortalConfig&{rpc?:RewardLedgerRpc};
type LiveDeps=Config&{reader:RewardCampaignReader&RewardNonceReader;creationCode:`0x${string}`};
const key=(value:unknown)=>{requireReward(typeof value==="string"&&value.length>=8&&value.length<=128,"invalid_reward_payment_request");return value;};
const address=(value:unknown)=>{requireReward(typeof value==="string"&&/^0x[0-9a-fA-F]{40}$/.test(value)&&BigInt(value)>0n,
  "invalid_reward_payment_request");return value.toLowerCase() as `0x${string}`;};
const scope=(identity:RewardAccountIdentity,claimIntentId:string)=>({identity:{userId:uuid(identity.userId),sessionId:uuid(identity.sessionId)},claimIntentId:uuid(claimIntentId)});
async function approved(context:RewardAthletePaymentContext,config:RewardPortalConfig){
  const loaded=await verifyStoredAthleteRewardClaimProofs(context.claimContext,config);
  const operator=loaded.context.proofs.find(p=>p.role==="operator");const recipient=loaded.context.proofs.find(p=>p.role==="recipient");
  requireReward(operator&&recipient,"reward_payment_approvals_required");
  return {...loaded,proofs:{operator:operator.signature,recipient:recipient.signature}};
}
type Approved=Awaited<ReturnType<typeof approved>>;
function plan(context:RewardAthletePaymentContext,a:Approved){
  const i=context.paymentIntent;requireReward(i,"reward_payment_intent_required");
  return normalizeRewardAthletePaymentPlan({deployment:a.expected.deployment,upload:a.expected.upload,claim:a.claim,proofs:a.proofs,
    relayerAddress:i.relayerAddress,nonce:i.nonce});
}
async function fresh(a:Approved,relayer:`0x${string}`,deps:LiveDeps){
  requireReward(a.context.reviewContext.reviewState==="reviewed"&&a.context.reviewContext.latestReview?.reviewId===a.context.intent.readinessReviewId,
    "reward_claim_readiness_required");
  // Normalize before RPC so a gas payer can never be either approver or payee.
  normalizeRewardAthletePaymentPlan({deployment:a.expected.deployment,upload:a.expected.upload,claim:a.claim,proofs:a.proofs,relayerAddress:relayer,nonce:0n});
  const witness=await readVerifiedRewardAthleteClaim(deps.reader,a.expected,deps.creationCode);
  requireReward(witness.award.nonce===a.claim.nonce,"reward_claim_not_live");
  requireLiveRewardClaim(a.expected.deployment.context,a.claim,witness.observation.finalizedBlock.timestamp,witness.observation.accounting.claimDeadline);
  const block=witness.observation.finalizedBlock;
  let code,again;try{code=await deps.reader.getCode({address:relayer,blockNumber:block.number});again=await deps.reader.getBlock({blockNumber:block.number});}
  catch{throw new RewardProtocolError("reward_payment_observation_unavailable");}
  // Pinned viem getCode maps the RPC's empty bytecode "0x" to undefined.
  // Thrown RPC failures remain errors; nonempty/delegated or malformed code fails.
  requireReward(code===undefined||code==="0x","reward_relayer_eoa_required");
  requireReward(again.number===block.number&&again.hash?.toLowerCase()===block.hash&&again.timestamp===block.timestamp,"reward_chain_changed_during_observation");
  const pendingNonce=await readRewardPendingNonce(deps.reader,a.expected.deployment.context,relayer);
  return{witness,pendingNonce};
}

/** Internal operator preparation. This reserves a gas-payer slot, not an award,
 * fresh send lease, private key or broadcast. Retries return the original plan. */
export async function prepareAthleteRewardPayment(identity:RewardAccountIdentity,input:{claimIntentId:string;idempotencyKey:string;relayerAddress:`0x${string}`},dependencies:LiveDeps){
  const s=scope(identity,input.claimIntentId);const idempotencyKey=key(input.idempotencyKey);const relayerAddress=address(input.relayerAddress);
  const {rpc,chainId,origin,reader,creationCode}=dependencies;const deps={rpc,chainId,origin,reader,creationCode};
  let context=await readRewardAthletePaymentContext(s.identity,{claimIntentId:s.claimIntentId},rpc);let a=await approved(context,deps);
  if(context.paymentIntent){requireReward(context.paymentIntent.idempotencyKey===idempotencyKey&&context.paymentIntent.relayerAddress===relayerAddress,"reward_payment_already_planned");}
  else{
    const observed=await fresh(a,relayerAddress,deps);
    context=await reserveRewardAthletePaymentIntent(s.identity,{claimIntentId:s.claimIntentId,relayerAddress,idempotencyKey,observedChainId:chainId,
      pendingNonce:observed.pendingNonce,witness:observed.witness,observedAt:new Date().toISOString()},rpc);
    a=await approved(context,deps);
  }
  requireReward(context.paymentIntent,"reward_payment_intent_required");
  return{claimIntentId:s.claimIntentId,paymentIntentId:context.paymentIntent.paymentIntentId,plan:plan(context,a)};
}

/** Private exact signed-byte loader. The returned object is a payout capability,
 * not a browser response; verification does not grant current send authority. */
export async function loadVerifiedAthleteRewardPaymentAttempt(identity:RewardAccountIdentity,input:{claimIntentId:string;paymentIntentId:string;attemptId:string},dependencies:Config){
  const s=scope(identity,input.claimIntentId);const paymentIntentId=uuid(input.paymentIntentId);const attemptId=uuid(input.attemptId);
  const {rpc,chainId,origin}=dependencies;const loaded=await readRewardAthletePaymentAttempt(s.identity,{claimIntentId:s.claimIntentId,paymentIntentId,attemptId},rpc);
  requireReward(loaded,"reward_payment_attempt_required");const a=await approved(loaded.context,{chainId,origin});const p=plan(loaded.context,a);
  const verified=await verifySignedRewardAthletePayment(p,loaded.attempt.body.signedTransaction);
  requireReward(canonicalRewardJson(verified)===canonicalRewardJson(loaded.attempt.body),"reward_stored_payment_attempt_mismatch");
  return{claimIntentId:s.claimIntentId,paymentIntentId,attemptId,plan:p,verified};
}

/** Fresh eligibility observation for private queue/arm operations. The SQL
 * transition repeats source/session/readiness checks after acquiring its locks. */
export async function observeFreshAthleteRewardPayment(identity:RewardAccountIdentity,input:{claimIntentId:string;paymentIntentId:string;attemptId:string},dependencies:LiveDeps){
  const s=scope(identity,input.claimIntentId);const paymentIntentId=uuid(input.paymentIntentId);const attemptId=uuid(input.attemptId);
  const {rpc,chainId,origin,reader,creationCode}=dependencies;const deps={rpc,chainId,origin,reader,creationCode};
  const loaded=await loadVerifiedAthleteRewardPaymentAttempt(s.identity,{claimIntentId:s.claimIntentId,paymentIntentId,attemptId},deps);
  const context=await readRewardAthletePaymentContext(s.identity,{claimIntentId:s.claimIntentId},rpc);const a=await approved(context,deps);
  requireReward(canonicalRewardJson(plan(context,a))===canonicalRewardJson(loaded.plan),"reward_stored_payment_attempt_mismatch");
  return{...loaded,...await fresh(a,loaded.plan.relayerAddress,deps)};
}

/** Accepts only the reserved exact payment signed by the independent relayer.
 * New variants need fresh eligibility, not merely an old valid signature.
 * No automatic fee replacement or sending is implied by storing a variant. */
export async function recordSignedAthleteRewardPayment(identity:RewardAccountIdentity,input:{claimIntentId:string;paymentIntentId:string;
  idempotencyKey:string;signedTransaction:`0x${string}`},dependencies:LiveDeps){
  const s=scope(identity,input.claimIntentId);const paymentIntentId=uuid(input.paymentIntentId);const idempotencyKey=key(input.idempotencyKey);
  const signedTransaction=input.signedTransaction;const {rpc,chainId,origin,reader,creationCode}=dependencies;const deps={rpc,chainId,origin,reader,creationCode};
  const context=await readRewardAthletePaymentContext(s.identity,{claimIntentId:s.claimIntentId},rpc);
  requireReward(context.paymentIntent?.paymentIntentId===paymentIntentId,"reward_payment_intent_required");
  const a=await approved(context,deps);const verified=await verifySignedRewardAthletePayment(plan(context,a),signedTransaction);
  const existing=await readRewardAthletePaymentAttempt(s.identity,{claimIntentId:s.claimIntentId,paymentIntentId,idempotencyKey},rpc);
  if(existing){
    requireReward(canonicalRewardJson(verified)===canonicalRewardJson(existing.attempt.body),"reward_ledger_idempotency_conflict");
    return{attemptId:existing.attempt.attemptId,paymentIntentId,claimIntentId:s.claimIntentId,recordedByUserId:s.identity.userId,
      recordedAt:existing.attempt.recordedAt,transactionHash:verified.transactionHash};
  }
  const observed=await fresh(a,context.paymentIntent.relayerAddress,deps);
  // Earlier unseen uses of this reserved nonce require explicit reconciliation.
  requireReward(observed.pendingNonce<=context.paymentIntent.nonce,"reward_payment_nonce_consumed");
  return storeRewardAthletePaymentAttempt(s.identity,{claimIntentId:s.claimIntentId,paymentIntentId,idempotencyKey,attempt:verified,
    witness:observed.witness,observedAt:new Date().toISOString()},rpc);
}
