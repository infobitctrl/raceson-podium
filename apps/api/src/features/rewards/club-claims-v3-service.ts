import { readClubClaimV3,storeClubClaimV3,storeClubClaimProofV3,rewardDocumentUuid as uuid,
  copyRewardLedgerDocument as copy,type ClubClaimContextV3,type ClubClaimScopeV3,type RewardAccountIdentity,type RewardLedgerRpc } from "@raceson/db/rewards";
import { requireReward } from "@raceson/domain/rewards";
import { canonicalRewardJson,normalizeRewardProgrammeClubClaimExpectationV3,readVerifiedRewardProgrammeClubClaimV3,
  verifyRewardClubSafeConsentV3,type RewardClaim,type RewardProgrammeClubClaimReaderV3 } from "@raceson/rewards-chain";
import { rewardClaimMessagesV3,rewardClaimDigestsV3,safeRewardConsentMessageV3,verifyRewardClaimEoaProofV3 } from "@raceson/rewards-chain/campaign-v3";
import type { Hex } from "viem";
import { programmeClaimBindingV3 } from "./programme-claim-binding-v3.js";
import { compactClaimWitnessV3 } from "./athlete-claims-v3-service.js";
type Dependencies={chainId:31337|10143;rpc?:RewardLedgerRpc;reader:RewardProgrammeClubClaimReaderV3};
type Input=Omit<ClubClaimScopeV3,"chainId">;
function capture(identity:RewardAccountIdentity,input:Input,chainId:31337|10143) {
  requireReward(["recipient","operator"].includes(input.role) && /^0x[0-9a-f]{64}$/.test(input.entitlementId),"invalid_reward_club_claim_v3");
  return {actor:{userId:uuid(identity.userId),sessionId:uuid(identity.sessionId)},scope:{chainId,uploadId:uuid(input.uploadId),
    requestId:uuid(input.requestId),claimId:uuid(input.claimId),entitlementId:input.entitlementId,role:input.role}};
}
export function programmeClubClaimExpectationV3(c:ClubClaimContextV3,entitlementId:string) {
  const review=c.intent?c.readiness.retryReview:c.readiness.review;
  requireReward(review && (!c.intent || review.id===c.intent.reviewId),"reward_claim_readiness_required");
  const e=review.evidence,candidate=e.candidate,chainId=c.readiness.source.chainId;
  const block=(b:typeof e.reviewedBlock)=>({number:BigInt(b.number),hash:b.hash,timestamp:BigInt(b.timestamp)});
  return normalizeRewardProgrammeClubClaimExpectationV3({
    ...programmeClaimBindingV3(c,entitlementId,candidate.safeAddress),
    treasury:{safe:{context:{environment:chainId===31337?"local-simulation":"monad-testnet",chainId,verifyingContract:candidate.safeAddress},
      singletonAddress:candidate.singletonAddress,fallbackHandlerAddress:candidate.fallbackHandlerAddress,owners:candidate.owners},
      factoryAddress:e.factoryAddress,deploymentTransactionHash:e.deploymentTransactionHash},
    review:{reviewedBlock:block(e.reviewedBlock),deploymentBlock:block(e.deploymentBlock),initializerHash:e.initializerHash}});
}
export function preparedClubClaimV3(c:ClubClaimContextV3,entitlementId:string) {
  const expectation=programmeClubClaimExpectationV3(c,entitlementId),i=c.intent;requireReward(i,"reward_claim_scope_required");
  requireReward(i.entitlementId===expectation.entitlementId && i.witness.amountWei===expectation.award.amount
    && i.witness.allocationDigest===expectation.upload.allocationDigest,"invalid_reward_club_claim_v3");
  const claim:RewardClaim={entitlementId:expectation.entitlementId,recipient:expectation.recipient,amount:expectation.award.amount,
    pot:expectation.award.pot===0?"race":"league",nonce:i.nonce,issuedAt:i.issuedAt,expiresAt:i.expiresAt,allocationDigest:expectation.upload.allocationDigest};
  return {expectation,claim,messages:rewardClaimMessagesV3(expectation.deployment.context,claim),
    consent:safeRewardConsentMessageV3(expectation.deployment.context,claim),digests:rewardClaimDigestsV3(expectation.deployment.context,claim)};
}
export function compactClubClaimWitnessV3(w:Awaited<ReturnType<typeof readVerifiedRewardProgrammeClubClaimV3>>) {
  return {...compactClaimWitnessV3(w),treasury:{reviewedBlock:w.treasury.reviewedBlock,deploymentBlock:w.treasury.deploymentBlock,
    initializerHash:w.treasury.initializerHash,executionNonce:w.treasury.executionNonce}};
}
function ready(c:ClubClaimContextV3) {
  const r=c.readiness,i=c.intent;
  requireReward(r.state==="reviewed" && r.review && (!i || r.review.id===i.reviewId && r.identityFingerprint===i.identityFingerprint
    && r.source.sourceGuardHash===i.sourceGuardHash),"reward_claim_readiness_required");
}
async function verifyProof(p:ReturnType<typeof preparedClubClaimV3>,role:"recipient"|"operator",signature:Hex,
  checkpoint:ClubClaimContextV3["proofs"][number]["witness"]["finalizedBlock"],deps:Dependencies) {
  if(role==="operator")return {...await verifyRewardClaimEoaProofV3(p.expectation.deployment.context,p.claim,role,p.expectation.programme.operatorAddress,signature),wrappedDigest:null};
  const {observation:_,...proof}=await verifyRewardClubSafeConsentV3(deps.reader,{safe:p.expectation.treasury.safe,
    campaignContext:p.expectation.deployment.context,claim:p.claim,signature,checkpoint});
  // Chain readers use checksummed addresses; the private ledger is canonical
  // lowercase. This changes encoding only, never the verified signer identity.
  return {...proof,signer:proof.signer.toLowerCase() as Hex,signature:proof.signature.toLowerCase() as Hex};
}
export async function verifyStoredClubClaimProofsV3(c:ClubClaimContextV3,entitlementId:string,deps:Dependencies) {
  const p=preparedClubClaimV3(c,entitlementId);
  for(const row of c.proofs) requireReward(canonicalRewardJson(await verifyProof(p,row.role,row.proof.signature,row.witness.finalizedBlock,deps))
    ===canonicalRewardJson(row.proof),"invalid_reward_claim_proof");
  return p;
}
async function live(c:ClubClaimContextV3,entitlementId:string,deps:Dependencies) {
  ready(c);const p=await verifyStoredClubClaimProofsV3(c,entitlementId,deps);
  const witness=compactClubClaimWitnessV3(await readVerifiedRewardProgrammeClubClaimV3(deps.reader,p.expectation)),i=c.intent!,f=witness.finalizedBlock;
  requireReward(witness.nonce===i.nonce && f.timestamp>=i.issuedAt && f.timestamp<i.expiresAt
    && f.number>=i.witness.finalizedBlock.number && (f.number!==i.witness.finalizedBlock.number || f.hash===i.witness.finalizedBlock.hash)
    && canonicalRewardJson(witness.treasury)===canonicalRewardJson(i.witness.treasury),"reward_claim_window_unavailable");
  for(const row of c.proofs) {
    requireReward(f.number>=row.witness.finalizedBlock.number && f.timestamp>=row.witness.finalizedBlock.timestamp
      && (f.number!==row.witness.finalizedBlock.number || f.hash===row.witness.finalizedBlock.hash),"reward_claim_observation_regressed");
    if(row.role==="recipient")requireReward(canonicalRewardJson(await verifyProof(p,"recipient",row.proof.signature,f,deps))===canonicalRewardJson(row.proof),"invalid_reward_claim_proof");
  }
  return {prepared:p,witness};
}
const metadata=(c:ClubClaimContextV3)=>({schema:"raceson-club-claim-record-v3" as const,claimId:c.intent!.id,uploadId:c.intent!.uploadId,
  requestId:c.intent!.requestId,entitlementId:c.intent!.entitlementId,chainId:c.intent!.chainId,recipientAddress:c.intent!.recipientAddress,
  amountWei:c.intent!.witness.amountWei.toString(),issuedAt:c.intent!.issuedAt.toString(),expiresAt:c.intent!.expiresAt.toString(),
  recipientConsented:c.proofs.some(p=>p.role==="recipient"),operatorApproved:c.proofs.some(p=>p.role==="operator")});
// Reauthorize even historical responses after asynchronous signature verification.
async function reread(actor:RewardAccountIdentity,scope:ClubClaimScopeV3,c:ClubClaimContextV3,deps:Dependencies) {
  const fresh=await readClubClaimV3(actor,scope,deps.rpc);
  requireReward(canonicalRewardJson(fresh.intent)===canonicalRewardJson(c.intent),"invalid_reward_club_claim_v3");return fresh;
}
export async function prepareClubClaimV3(identity:RewardAccountIdentity,input:Omit<Input,"role">&{reviewId:string;sourceGuardHash:string;identityFingerprint:string},deps:Dependencies) {
  const {actor,scope}=capture(identity,{...input,role:"operator"},deps.chainId),reviewId=uuid(input.reviewId),
    sourceGuardHash=input.sourceGuardHash,identityFingerprint=input.identityFingerprint;
  let c=await readClubClaimV3(actor,scope,deps.rpc);
  if(c.intent) {
    requireReward(c.intent.reviewId===reviewId && c.intent.sourceGuardHash===sourceGuardHash && c.intent.identityFingerprint===identityFingerprint,"reward_ledger_idempotency_conflict");
    await verifyStoredClubClaimProofsV3(c,scope.entitlementId,deps);return metadata(await reread(actor,scope,c,deps));
  }
  ready(c);requireReward(c.readiness.review!.id===reviewId && c.readiness.source.sourceGuardHash===sourceGuardHash
    && c.readiness.identityFingerprint===identityFingerprint,"reward_claim_readiness_required");
  const witness=compactClubClaimWitnessV3(await readVerifiedRewardProgrammeClubClaimV3(deps.reader,programmeClubClaimExpectationV3(c,scope.entitlementId)));
  c=await storeClubClaimV3(actor,scope,{reviewId,sourceGuardHash,identityFingerprint,witness,observedAt:new Date().toISOString()},deps.rpc);
  preparedClubClaimV3(c,scope.entitlementId);return metadata(c);
}
export async function reviewClubClaimSigningV3(identity:RewardAccountIdentity,input:Input,deps:Dependencies) {
  const {actor,scope}=capture(identity,input,deps.chainId),c=await readClubClaimV3(actor,scope,deps.rpc);
  await verifyStoredClubClaimProofsV3(c,scope.entitlementId,deps);
  if(c.proofs.some(p=>p.role===scope.role))return {...metadata(await reread(actor,scope,c,deps)),status:"already_recorded" as const};
  if(scope.role==="operator")requireReward(c.proofs.some(p=>p.role==="recipient"),"reward_recipient_consent_required");
  const {prepared,witness}=await live(c,scope.entitlementId,deps),fresh=await reread(actor,scope,c,deps);ready(fresh);
  if(fresh.proofs.some(p=>p.role===scope.role))return {...metadata(fresh),status:"already_recorded" as const};
  return {...metadata(fresh),status:"signature_required" as const,role:scope.role,
    ...(scope.role==="recipient"?{binding:{schema:"raceson-club-consent-binding-v3" as const,
      campaignAddress:prepared.expectation.deployment.context.verifyingContract.toLowerCase(),pot:prepared.claim.pot,
      nonce:prepared.claim.nonce.toString(),allocationDigest:prepared.claim.allocationDigest},
      observation:{blockNumber:witness.finalizedBlock.number.toString(),blockHash:witness.finalizedBlock.hash,
        timestamp:witness.finalizedBlock.timestamp.toString()}}:{}),
    typedData:copy(scope.role==="recipient"?prepared.consent:prepared.messages.authorization)};
}
/** Signatures supplied by the actual wallet only; no keys, signing or broadcast. */
export async function recordClubClaimProofV3(identity:RewardAccountIdentity,input:Input&{signature:Hex},deps:Dependencies) {
  const {actor,scope}=capture(identity,input,deps.chainId),signature=input.signature.toLowerCase() as Hex;
  requireReward(scope.role==="operator"?/^0x[0-9a-f]{130}$/.test(signature):/^0x([0-9a-f]{2}){1,8192}$/.test(signature),"invalid_reward_claim_signature");
  let c=await readClubClaimV3(actor,scope,deps.rpc);
  await verifyStoredClubClaimProofsV3(c,scope.entitlementId,deps);
  const old=c.proofs.find(p=>p.role===scope.role);
  if(old) { requireReward(old.proof.signature===signature,"reward_ledger_idempotency_conflict");return metadata(await reread(actor,scope,c,deps)); }
  if(scope.role==="operator")requireReward(c.proofs.some(p=>p.role==="recipient"),"reward_recipient_consent_required");
  const {prepared,witness}=await live(c,scope.entitlementId,deps),proof=await verifyProof(prepared,scope.role,signature,witness.finalizedBlock,deps);
  c=await storeClubClaimProofV3(actor,scope,{proof,witness,observedAt:new Date().toISOString()},deps.rpc);
  await verifyStoredClubClaimProofsV3(c,scope.entitlementId,deps);return metadata(await reread(actor,scope,c,deps));
}
