import type { OrganizerClubReadinessV3, OrganizerClubSelectionV3 } from "./organizerClubPreparationV3";
export const clubReviewTestId = (n: number) => `8fc00000-0000-4000-8000-${String(n).padStart(12,"0")}`;
export const clubReviewTestAddress = (n: number) => `0x${String(n).padStart(40,"0")}` as `0x${string}`;
export function clubReviewV3Fixture() {
  const id = clubReviewTestId, a = clubReviewTestAddress;
  const selection: OrganizerClubSelectionV3 = {clubId:id(1),slot:5,award:{chainId:10143,uploadId:id(2),requestId:id(3),claimId:id(4),
    entitlementId:`0x${"a".repeat(64)}`,campaignAddress:a(5),recipientAddress:a(6),amountWei:"100000000000000001",pot:"race"}};
  const readiness: OrganizerClubReadinessV3 = {schema:"raceson-club-readiness-v3",chainId:10143,uploadId:id(2),requestId:id(3),clubId:id(1),slot:5,
    address:a(6),state:"unreviewed",sourceCurrent:true,sourceGuardHash:"b".repeat(64),identityFingerprint:"c".repeat(64),reviewId:null,reviewedAt:null,revokedAt:null};
  const input = {previousReviewId:null,sourceGuardHash:readiness.sourceGuardHash,identityFingerprint:readiness.identityFingerprint,
    factoryAddress:a(9),deploymentTransactionHash:`0x${"d".repeat(64)}` as `0x${string}`};
  const observation = {schema:"raceson-club-observation-v3",chainId:10143,uploadId:id(2),requestId:id(3),clubId:id(1),slot:5,...input,
    candidate:{safeAddress:a(6),singletonAddress:a(7),fallbackHandlerAddress:a(8),owners:[a(10),a(11),a(12)]},initializerHash:`0x${"e".repeat(64)}`,
    deploymentBlock:{number:"100",hash:`0x${"f".repeat(64)}`,timestamp:"1000"},reviewedBlock:{number:"101",hash:`0x${"a".repeat(64)}`,timestamp:"1001"},
    scope:"initialization_only",executionHistoryReviewRequired:true};
  const refs = {authorityEvidenceRef:id(20),controlEvidenceRef:id(21),recoveryEvidenceRef:id(22),executionHistoryEvidenceRef:id(23)};
  return {selection,readiness,input,observation,refs,record:{schema:"raceson-club-readiness-record-v3",reviewId:id(24),reviewedAt:"2026-09-15T12:00:00Z",revokedAt:null}};
}
