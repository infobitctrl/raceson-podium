import { readClaimV3, storeClaimV3, storeClaimProofV3, rewardDocumentUuid as uuid, rewardDocumentInteger as uint,
  copyRewardLedgerDocument as copy, type ClaimContextV3, type ClaimScopeV3, type RewardAccountIdentity, type RewardLedgerRpc } from "@raceson/db/rewards";
import { requireReward } from "@raceson/domain/rewards";
import { hashPublicRewardRules, canonicalRewardJson, type RewardClaim } from "@raceson/rewards-chain";
import { normalizeRewardProgrammeV3 } from "@raceson/rewards-chain/programme-v3";
import { decodeRewardProgrammeUploadV3 } from "@raceson/rewards-chain/programme-lifecycle-v3";
import { rewardAllocationCommitmentV3, rewardClaimMessagesV3, rewardClaimDigestsV3, verifyRewardClaimEoaProofV3 } from "@raceson/rewards-chain/campaign-v3";
import { normalizeRewardProgrammeAthleteClaimExpectationV3, readVerifiedRewardProgrammeAthleteClaimV3,
  type RewardClaimReaderV3, type RewardProgrammeAthleteClaimWitnessV3 } from "@raceson/rewards-chain/claim-reader-v3";
import type { Hex } from "viem";
import { verifyReadinessWalletV3 } from "./athlete-readiness-v3-service.js";
import { programmeClaimBindingV3 } from "./programme-claim-binding-v3.js";
type Dependencies = { chainId:31337|10143; origin:string; rpc?:RewardLedgerRpc; reader:RewardClaimReaderV3 };
type Input = Omit<ClaimScopeV3,"chainId">;
function capture(identity:RewardAccountIdentity,s:Input,chainId:31337|10143) {
  requireReward(["operator","recipient"].includes(s.role) && /^0x[0-9a-f]{64}$/.test(s.entitlementId),"invalid_reward_claim_v3");
  return {actor:{userId:uuid(identity.userId),sessionId:uuid(identity.sessionId)},scope:{chainId,uploadId:uuid(s.uploadId),destinationId:uuid(s.destinationId),
    entitlementId:s.entitlementId,claimId:uuid(s.claimId),role:s.role}};
}
export function programmeAthleteClaimExpectationV3(c:ClaimContextV3,entitlementId:string) {
  return normalizeRewardProgrammeAthleteClaimExpectationV3(programmeClaimBindingV3(c,entitlementId,c.readiness.destination.address));
}
export function preparedClaimV3(c:ClaimContextV3,entitlementId:string) {
  const e=programmeAthleteClaimExpectationV3(c,entitlementId),i=c.intent;requireReward(i,"reward_claim_scope_required");
  requireReward(i.entitlementId===e.entitlementId && i.witness.amountWei===e.award.amount && i.witness.allocationDigest===e.upload.allocationDigest,
    "invalid_reward_claim_v3");
  const claim:RewardClaim={entitlementId:e.entitlementId,recipient:e.recipient,amount:e.award.amount,pot:e.award.pot===0?"race":"league",
    nonce:i.nonce,issuedAt:i.issuedAt,expiresAt:i.expiresAt,allocationDigest:e.upload.allocationDigest};
  return {expectation:e,claim,messages:rewardClaimMessagesV3(e.deployment.context,claim),digests:rewardClaimDigestsV3(e.deployment.context,claim)};
}
function ready(c:ClaimContextV3) {
  const r=c.readiness,i=c.intent;
  requireReward(r.state==="reviewed" && r.review && (!i || r.review.id===i.reviewId && r.profileFingerprint===i.profileFingerprint
    && r.source.sourceGuardHash===i.sourceGuardHash),"reward_claim_readiness_required");
}
export function compactClaimWitnessV3(w:Pick<RewardProgrammeAthleteClaimWitnessV3,"campaign"|"observation"|"recipient"> & {
  award:Pick<RewardProgrammeAthleteClaimWitnessV3["award"],"entitlementId"|"amount"|"nonce"> }) {
  return {protocolVersion:3 as const,chainId:w.campaign.context.chainId,campaignAddress:w.campaign.context.verifyingContract.toLowerCase(),
    stageTransactionHash:w.observation.review.stageTransactionHash,allocationDigest:w.observation.accounting.allocationDigest,
    entitlementId:w.award.entitlementId,recipientAddress:w.recipient.toLowerCase(),amountWei:w.award.amount,nonce:w.award.nonce,
    finalizedBlock:w.observation.finalizedBlock,claimDeadline:w.observation.accounting.claimDeadline};
}
async function verifyStoredProofs(c:ClaimContextV3,entitlementId:string) {
  const p=preparedClaimV3(c,entitlementId);
  for(const row of c.proofs){const verified=await verifyRewardClaimEoaProofV3(p.expectation.deployment.context,p.claim,row.role,
    p.expectation.programme.operatorAddress,row.proof.signature);
    requireReward(canonicalRewardJson(verified)===canonicalRewardJson(row.proof),"invalid_reward_claim_proof");}
  return p;
}
async function live(c:ClaimContextV3,entitlementId:string,deps:Dependencies) {
  ready(c);await verifyReadinessWalletV3(c.readiness,deps);
  const p=await verifyStoredProofs(c,entitlementId),w=await readVerifiedRewardProgrammeAthleteClaimV3(deps.reader,p.expectation),i=c.intent!;
  const f=w.observation.finalizedBlock;
  requireReward(w.award.nonce===i.nonce && f.timestamp>=i.issuedAt && f.timestamp<i.expiresAt
    && f.number>=i.witness.finalizedBlock.number && (f.number!==i.witness.finalizedBlock.number || f.hash===i.witness.finalizedBlock.hash),"reward_claim_window_unavailable");
  for(const proof of c.proofs)requireReward(f.number>=proof.witness.finalizedBlock.number && f.timestamp>=proof.witness.finalizedBlock.timestamp
    && (f.number!==proof.witness.finalizedBlock.number || f.hash===proof.witness.finalizedBlock.hash),"reward_claim_observation_regressed");
  return {prepared:p,witness:compactClaimWitnessV3(w)};
}
const metadata=(c:ClaimContextV3)=>({schema:"raceson-athlete-claim-record-v3" as const,claimId:c.intent!.id,uploadId:c.intent!.uploadId,
  destinationId:c.intent!.destinationId,entitlementId:c.intent!.entitlementId,chainId:c.intent!.chainId,recipientAddress:c.intent!.recipientAddress,
  amountWei:c.intent!.witness.amountWei.toString(),issuedAt:c.intent!.issuedAt.toString(),expiresAt:c.intent!.expiresAt.toString(),
  recipientConsented:c.proofs.some(p=>p.role==="recipient"),operatorApproved:c.proofs.some(p=>p.role==="operator")});

// Crypto/provider IO is not a lease on the account session. Reauthorize even
// historical/idempotent responses without requiring a new chain observation.
async function reread(actor:RewardAccountIdentity,scope:ClaimScopeV3,c:ClaimContextV3,deps:Dependencies) {
  const fresh=await readClaimV3(actor,scope,deps.rpc);
  requireReward(canonicalRewardJson(fresh.intent)===canonicalRewardJson(c.intent),"invalid_reward_claim_v3");
  return fresh;
}

export async function prepareAthleteClaimV3(identity:RewardAccountIdentity,input:Omit<Input,"role">&{reviewId:string;sourceGuardHash:string;profileFingerprint:string},deps:Dependencies) {
  const {actor,scope}=capture(identity,{...input,role:"operator"},deps.chainId),reviewId=uuid(input.reviewId),
    sourceGuardHash=input.sourceGuardHash,profileFingerprint=input.profileFingerprint;
  let c=await readClaimV3(actor,scope,deps.rpc);await verifyReadinessWalletV3(c.readiness,deps);
  if(c.intent){requireReward(c.intent.reviewId===reviewId && c.intent.sourceGuardHash===sourceGuardHash && c.intent.profileFingerprint===profileFingerprint,"reward_ledger_idempotency_conflict");
    await verifyStoredProofs(c,scope.entitlementId);return metadata(await reread(actor,scope,c,deps));}
  ready(c);requireReward(c.readiness.review!.id===reviewId && c.readiness.source.sourceGuardHash===sourceGuardHash
    && c.readiness.profileFingerprint===profileFingerprint,"reward_claim_readiness_required");
  const w=await readVerifiedRewardProgrammeAthleteClaimV3(deps.reader,programmeAthleteClaimExpectationV3(c,scope.entitlementId));
  c=await storeClaimV3(actor,scope,{reviewId,sourceGuardHash,profileFingerprint,witness:compactClaimWitnessV3(w),observedAt:new Date().toISOString()},deps.rpc);
  preparedClaimV3(c,scope.entitlementId);return metadata(c);
}

/** Exact message review, never an instruction to auto-sign. Responses contain
 * no stored proof; already-recorded roles do not receive a new signing request. */
export async function reviewAthleteClaimSigningV3(identity:RewardAccountIdentity,input:Input,deps:Dependencies) {
  const {actor,scope}=capture(identity,input,deps.chainId),c=await readClaimV3(actor,scope,deps.rpc);
  await verifyReadinessWalletV3(c.readiness,deps);await verifyStoredProofs(c,scope.entitlementId);
  if(c.proofs.some(p=>p.role===scope.role))return {...metadata(await reread(actor,scope,c,deps)),status:"already_recorded" as const};
  if(scope.role==="operator")requireReward(c.proofs.some(p=>p.role==="recipient"),"reward_recipient_consent_required");
  const {prepared,witness}=await live(c,scope.entitlementId,deps),fresh=await reread(actor,scope,c,deps);ready(fresh);
  if(fresh.proofs.some(p=>p.role===scope.role))return {...metadata(fresh),status:"already_recorded" as const};
  return {...metadata(fresh),status:"signature_required" as const,role:scope.role,
    ...(scope.role==="recipient"?{observation:{blockNumber:witness.finalizedBlock.number.toString(),
      blockHash:witness.finalizedBlock.hash,timestamp:witness.finalizedBlock.timestamp.toString()}}:{}),
    typedData:copy(scope.role==="recipient"?prepared.messages.consent:prepared.messages.authorization)};
}
/** User supplies only their actual signature; all amount/domain/window data is
 * rebuilt privately. Separate operator signature is required after consent. */
export async function recordAthleteClaimProofV3(identity:RewardAccountIdentity,input:Input&{signature:Hex},deps:Dependencies) {
  const {actor,scope}=capture(identity,input,deps.chainId),signature=input.signature;
  let c=await readClaimV3(actor,scope,deps.rpc);await verifyReadinessWalletV3(c.readiness,deps);
  const p=await verifyStoredProofs(c,scope.entitlementId),proof=await verifyRewardClaimEoaProofV3(p.expectation.deployment.context,p.claim,scope.role,p.expectation.programme.operatorAddress,signature);
  const old=c.proofs.find(p=>p.role===scope.role);
  if(old){requireReward(canonicalRewardJson(old.proof)===canonicalRewardJson(proof),"reward_ledger_idempotency_conflict");return metadata(await reread(actor,scope,c,deps));}
  if(scope.role==="operator")requireReward(c.proofs.some(p=>p.role==="recipient"),"reward_recipient_consent_required");
  const {witness}=await live(c,scope.entitlementId,deps);
  c=await storeClaimProofV3(actor,scope,{proof,witness,observedAt:new Date().toISOString()},deps.rpc);
  await verifyStoredProofs(c,scope.entitlementId);return metadata(await reread(actor,scope,c,deps));
}
