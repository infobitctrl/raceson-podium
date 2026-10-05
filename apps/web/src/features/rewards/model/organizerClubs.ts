import { requirePortal, rewardRecord, walletAddress } from "./athleteRewards";
import { claimInteger, claimTimestamp } from "./athleteClaims";
import { organizerUuid, type RewardNetwork } from "./organizerRewards";
import { decodeClubTreasuryCandidate, type ClubTreasuryCandidate } from "./clubTreasuries";
export const clubReviewStates = ["unreviewed","reviewed","revoked","identity_hold","identity_changed","request_withdrawn"] as const;
export const clubReviewReasons = ["authority_uncertain","key_control_changed","wallet_history_uncertain","operator_correction"] as const;
export const clubEvidenceFields = ["authorityEvidenceRef","controlEvidenceRef","recoveryEvidenceRef","executionHistoryEvidenceRef"] as const;
export type ClubReviewReason = typeof clubReviewReasons[number];
export type OperatorClubRequest = { requestId:string; clubId:string; clubName:string|null; address:`0x${string}`; requestedAt:string;
  nominationStatus:"pending_review"|"identity_hold"|"withdrawn" };
export type OperatorClubSelection = Pick<OperatorClubRequest,"requestId"|"clubId"|"address"|"requestedAt"> & {programmeId:string;chainId:RewardNetwork};
export type OperatorClubReview = { reviewId:string;revision:number;reviewedAt:string;identityFingerprintSha256:string;revokedAt:string|null;revocationReason:ClubReviewReason|null };
export type OperatorClubContext = Omit<OperatorClubSelection,"address"> & {clubName:string|null;ownerProfileId:string|null;ownerName:string|null;
  candidate:ClubTreasuryCandidate;nominationStatus:OperatorClubRequest["nominationStatus"];identityFingerprintSha256:string;
  reviewState:typeof clubReviewStates[number];latestReview:OperatorClubReview|null};
export type ClubChainBlock = { number:string;hash:`0x${string}`;timestamp:string };
export type ClubReviewObservation = {programmeId:string;requestId:string;chainId:RewardNetwork;expectedIdentityFingerprintSha256:string;expectedRevision:number;
  candidate:ClubTreasuryCandidate;factoryAddress:`0x${string}`;deploymentTransactionHash:`0x${string}`;initializerHash:`0x${string}`;
  deploymentBlock:ClubChainBlock;reviewedBlock:ClubChainBlock;scope:"initialization_only";executionHistoryReviewRequired:true};
export type ClubReviewObserveInput = Pick<ClubReviewObservation,"expectedIdentityFingerprintSha256"|"expectedRevision"|"factoryAddress"|"deploymentTransactionHash">;
export type ClubReviewInput = Pick<ClubReviewObservation,"expectedIdentityFingerprintSha256"|"expectedRevision"> & {idempotencyKey:string;confirmReview:true;
  evidence:Pick<ClubReviewObservation,"chainId"|"candidate"|"factoryAddress"|"deploymentTransactionHash"|"initializerHash"|"deploymentBlock"|"reviewedBlock"> &
    Record<typeof clubEvidenceFields[number],string> & {schemaVersion:1;policy:"operator-reviewed-original-safe-v1"}};
function object(value:unknown,keys:string[]) { const r=rewardRecord(value,keys), d=Object.getOwnPropertyDescriptors(r);
  requirePortal((Object.getPrototypeOf(r)===Object.prototype||Object.getPrototypeOf(r)===null)&&!Object.getOwnPropertySymbols(r).length
    &&keys.every(k=>d[k].enumerable&&"value" in d[k]));return r; }
const label=(v:unknown):v is string|null=>v===null||(typeof v==="string"&&v.length>0&&v.trim()===v&&[...v].length<=256);
const fingerprint=(v:unknown):v is string=>typeof v==="string"&&/^[0-9a-f]{64}$/.test(v);
export const clubReviewAddress=(v:unknown):v is `0x${string}`=>walletAddress(v)&&v===v.toLowerCase()&&BigInt(v)>1n;
export const clubReviewHash=(v:unknown):v is `0x${string}`=>typeof v==="string"&&/^0x[0-9a-f]{64}$/.test(v)&&BigInt(v)>0n;
const revision=(v:unknown):v is number=>typeof v==="number"&&Number.isInteger(v)&&v>=0&&v<=2147483645;
export function decodeOperatorClubRequest(value:unknown):OperatorClubRequest {
  const r=object(value,["requestId","clubId","clubName","address","requestedAt","nominationStatus"]);
  requirePortal(organizerUuid(r.requestId)&&organizerUuid(r.clubId)&&label(r.clubName)&&clubReviewAddress(r.address)&&claimTimestamp(r.requestedAt)
    &&["pending_review","identity_hold","withdrawn"].includes(String(r.nominationStatus)));return {...r} as OperatorClubRequest;
}
export function decodeOperatorClubSelection(value:unknown):OperatorClubSelection {
  const r=object(value,["programmeId","requestId","clubId","address","requestedAt","chainId"]);
  requirePortal(organizerUuid(r.programmeId)&&organizerUuid(r.requestId)&&organizerUuid(r.clubId)&&clubReviewAddress(r.address)&&claimTimestamp(r.requestedAt)
    &&(r.chainId===31337||r.chainId===10143));return {...r} as OperatorClubSelection;
}
export function decodeOperatorClubReview(value:unknown):OperatorClubReview {
  const r=object(value,["reviewId","revision","reviewedAt","identityFingerprintSha256","revokedAt","revocationReason"]);
  requirePortal(organizerUuid(r.reviewId)&&typeof r.revision==="number"&&Number.isInteger(r.revision)&&r.revision>0&&r.revision<2147483647
    &&claimTimestamp(r.reviewedAt)&&fingerprint(r.identityFingerprintSha256)&&(r.revokedAt===null?r.revocationReason===null:
      claimTimestamp(r.revokedAt)&&Date.parse(r.revokedAt)>=Date.parse(r.reviewedAt)&&clubReviewReasons.some(reason=>reason===r.revocationReason)));
  return {...r} as OperatorClubReview;
}
export function decodeOperatorClubContext(value:unknown,selection:OperatorClubSelection):OperatorClubContext {
  const s=decodeOperatorClubSelection(selection),r=object(value,["programmeId","requestId","clubId","requestedAt","chainId","clubName","ownerProfileId","ownerName",
    "candidate","nominationStatus","identityFingerprintSha256","reviewState","latestReview"]);
  requirePortal(Object.entries(s).every(([k,v])=>k==="address"||r[k]===v)&&label(r.clubName)&&label(r.ownerName)
    &&(r.ownerProfileId===null||organizerUuid(r.ownerProfileId))&&fingerprint(r.identityFingerprintSha256)
    &&clubReviewStates.some(state=>state===r.reviewState)&&["pending_review","identity_hold","withdrawn"].includes(String(r.nominationStatus)));
  const candidate=decodeClubTreasuryCandidate(r.candidate),latestReview=r.latestReview===null?null:decodeOperatorClubReview(r.latestReview);
  requirePortal(candidate.safeAddress===s.address&&(latestReview===null||Date.parse(latestReview.reviewedAt)>=Date.parse(s.requestedAt)));
  if(r.reviewState==="reviewed")requirePortal(latestReview!==null&&latestReview.revokedAt===null&&latestReview.identityFingerprintSha256===r.identityFingerprintSha256&&r.nominationStatus==="pending_review");
  if(r.reviewState==="unreviewed")requirePortal(latestReview===null&&r.nominationStatus==="pending_review");
  if(r.reviewState==="revoked")requirePortal(latestReview?.revokedAt!=null);
  if(r.reviewState==="request_withdrawn")requirePortal(r.nominationStatus==="withdrawn");
  return {...r,candidate,latestReview} as OperatorClubContext;
}
export function decodeClubObserveInput(value:unknown):ClubReviewObserveInput {
  const r=object(value,["expectedIdentityFingerprintSha256","expectedRevision","factoryAddress","deploymentTransactionHash"]);
  requirePortal(fingerprint(r.expectedIdentityFingerprintSha256)&&revision(r.expectedRevision)&&clubReviewAddress(r.factoryAddress)&&clubReviewHash(r.deploymentTransactionHash));
  return {...r} as ClubReviewObserveInput;
}
function block(value:unknown):ClubChainBlock { const r=object(value,["number","hash","timestamp"]);requirePortal(claimInteger(r.number)&&claimInteger(r.timestamp)&&clubReviewHash(r.hash));return {number:r.number,hash:r.hash,timestamp:r.timestamp}; }
export function decodeClubObservation(value:unknown,selection:OperatorClubSelection,input:ClubReviewObserveInput):ClubReviewObservation {
  const s=decodeOperatorClubSelection(selection),expected=decodeClubObserveInput(input),r=object(value,["programmeId","requestId","chainId",...Object.keys(expected),
    "candidate","initializerHash","deploymentBlock","reviewedBlock","scope","executionHistoryReviewRequired"]);
  requirePortal(r.programmeId===s.programmeId&&r.requestId===s.requestId&&r.chainId===s.chainId&&Object.entries(expected).every(([k,v])=>r[k]===v)
    &&r.scope==="initialization_only"&&r.executionHistoryReviewRequired===true&&clubReviewHash(r.initializerHash));
  const candidate=decodeClubTreasuryCandidate(r.candidate),deploymentBlock=block(r.deploymentBlock),reviewedBlock=block(r.reviewedBlock);
  requirePortal(candidate.safeAddress===s.address&&![candidate.safeAddress,candidate.singletonAddress,candidate.fallbackHandlerAddress].includes(expected.factoryAddress)
    &&BigInt(deploymentBlock.number)>0n&&BigInt(deploymentBlock.number)<=BigInt(reviewedBlock.number)&&BigInt(deploymentBlock.timestamp)<=BigInt(reviewedBlock.timestamp)
    &&(deploymentBlock.number!==reviewedBlock.number||JSON.stringify(deploymentBlock)===JSON.stringify(reviewedBlock)));
  return {...r,candidate,deploymentBlock,reviewedBlock} as ClubReviewObservation;
}
export function makeClubReviewInput(selection:OperatorClubSelection,preview:ClubReviewObservation,refs:Record<typeof clubEvidenceFields[number],string>,idempotencyKey:string):ClubReviewInput {
  const input=decodeClubObserveInput({expectedIdentityFingerprintSha256:preview.expectedIdentityFingerprintSha256,expectedRevision:preview.expectedRevision,
    factoryAddress:preview.factoryAddress,deploymentTransactionHash:preview.deploymentTransactionHash});
  const p=decodeClubObservation(preview,selection,input);requirePortal(clubEvidenceFields.every(k=>organizerUuid(refs[k]))&&typeof idempotencyKey==="string"&&idempotencyKey.length>=8&&idempotencyKey.length<=128);
  return {expectedIdentityFingerprintSha256:p.expectedIdentityFingerprintSha256,expectedRevision:p.expectedRevision,idempotencyKey,confirmReview:true,
    evidence:{schemaVersion:1,policy:"operator-reviewed-original-safe-v1",chainId:p.chainId,candidate:p.candidate,factoryAddress:p.factoryAddress,
      deploymentTransactionHash:p.deploymentTransactionHash,initializerHash:p.initializerHash,deploymentBlock:p.deploymentBlock,reviewedBlock:p.reviewedBlock,
      authorityEvidenceRef:refs.authorityEvidenceRef,controlEvidenceRef:refs.controlEvidenceRef,recoveryEvidenceRef:refs.recoveryEvidenceRef,executionHistoryEvidenceRef:refs.executionHistoryEvidenceRef}};
}
