import { apiRequest } from "@/lib/api";
import { requirePortal, rewardRecord } from "../model/athleteRewards";
import { requireClaimNetwork } from "./athleteClaims";
import { decodeOrganizerPage, organizerUuid, type RewardNetwork } from "../model/organizerRewards";
import { decodeOperatorClubRequest, decodeOperatorClubSelection, decodeOperatorClubContext, decodeClubObserveInput, decodeClubObservation,
  decodeOperatorClubReview, makeClubReviewInput, clubReviewReasons, type OperatorClubSelection, type ClubReviewObserveInput,
  type ClubReviewInput, type ClubReviewObservation, type ClubReviewReason } from "../model/organizerClubs";
const path=(s:{programmeId:string})=>`/v1/organizer/rewards/programmes/${s.programmeId}/club-treasuries`;
export async function getOperatorClubRequests(programmeId:string,chainId:RewardNetwork,after:string|null=null) {
  requirePortal(organizerUuid(programmeId)&&(after===null||organizerUuid(after)));requireClaimNetwork(chainId);
  const raw=await apiRequest<unknown>({path:path({programmeId})+(after?`?after=${encodeURIComponent(after)}`:""),cache:"no-store"});requireClaimNetwork(chainId);
  return decodeOrganizerPage(raw,chainId,after,decodeOperatorClubRequest,r=>r.requestId,programmeId);
}
export async function getOperatorClubContext(selection:OperatorClubSelection) {
  const s=decodeOperatorClubSelection(selection);requireClaimNetwork(s.chainId);
  const raw=await apiRequest<unknown>({path:`${path(s)}/${s.requestId}/review`,cache:"no-store"});requireClaimNetwork(s.chainId);
  return decodeOperatorClubContext(raw,s);
}
export async function observeOperatorClub(selection:OperatorClubSelection,input:ClubReviewObserveInput) {
  const s=decodeOperatorClubSelection(selection),body=decodeClubObserveInput(input);requireClaimNetwork(s.chainId);
  const raw=await apiRequest<unknown>({path:`${path(s)}/${s.requestId}/observe`,method:"POST",body,cache:"no-store"});requireClaimNetwork(s.chainId);
  return decodeClubObservation(raw,s,body);
}
function reply(raw:unknown,s:OperatorClubSelection) {
  const r=rewardRecord(raw,["programmeId","requestId","chainId","review"]);requirePortal(r.programmeId===s.programmeId&&r.requestId===s.requestId&&r.chainId===s.chainId);
  const review=decodeOperatorClubReview(r.review);requirePortal(Date.parse(review.reviewedAt)>=Date.parse(s.requestedAt));return review;
}
export async function recordOperatorClub(selection:OperatorClubSelection,input:ClubReviewInput) {
  const s=decodeOperatorClubSelection(selection);requireClaimNetwork(s.chainId);
  const r=rewardRecord(input,["expectedIdentityFingerprintSha256","expectedRevision","idempotencyKey","confirmReview","evidence"]);
  const e=rewardRecord(r.evidence,["schemaVersion","policy","chainId","candidate","factoryAddress","deploymentTransactionHash","initializerHash","deploymentBlock","reviewedBlock",
    "authorityEvidenceRef","controlEvidenceRef","recoveryEvidenceRef","executionHistoryEvidenceRef"]);
  requirePortal(r.confirmReview===true&&e.schemaVersion===1&&e.policy==="operator-reviewed-original-safe-v1");
  const body=makeClubReviewInput(s,{programmeId:s.programmeId,requestId:s.requestId,chainId:e.chainId,candidate:e.candidate,
    expectedIdentityFingerprintSha256:r.expectedIdentityFingerprintSha256,expectedRevision:r.expectedRevision,factoryAddress:e.factoryAddress,
    deploymentTransactionHash:e.deploymentTransactionHash,initializerHash:e.initializerHash,deploymentBlock:e.deploymentBlock,reviewedBlock:e.reviewedBlock,
    scope:"initialization_only",executionHistoryReviewRequired:true} as ClubReviewObservation,e as ClubReviewInput["evidence"],r.idempotencyKey as string);
  const raw=await apiRequest<unknown>({path:`${path(s)}/${s.requestId}/review`,method:"POST",body,cache:"no-store"});requireClaimNetwork(s.chainId);
  const review=reply(raw,s);requirePortal(review.revision===body.expectedRevision+1&&review.identityFingerprintSha256===body.expectedIdentityFingerprintSha256);return review;
}
export async function revokeOperatorClub(selection:OperatorClubSelection,reviewId:string,reason:ClubReviewReason) {
  const s=decodeOperatorClubSelection(selection);requirePortal(organizerUuid(reviewId)&&clubReviewReasons.includes(reason));requireClaimNetwork(s.chainId);
  const raw=await apiRequest<unknown>({path:`${path(s)}/${s.requestId}/reviews/${reviewId}/revoke`,method:"POST",body:{reason,confirmRevoke:true},cache:"no-store"});requireClaimNetwork(s.chainId);
  const review=reply(raw,s);requirePortal(review.reviewId===reviewId&&review.revokedAt!==null&&review.revocationReason===reason);return review;
}
