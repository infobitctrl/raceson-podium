import { clubFixture, clubAddress, clubId } from "./clubFixtures.test-helper";
import { organizerFixture } from "./organizerFixtures.test-helper";
import { makeClubReviewInput, type ClubReviewObservation, type OperatorClubContext, type OperatorClubRequest,
  type OperatorClubSelection, type OperatorClubReview } from "./organizerClubs";
export const clubReviewTestHash = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as `0x${string}`;
/** Synthetic public UI fixtures; not real ownership, signatures, audit records or chain observations. */
export function organizerClubFixture() {
  const { candidate, request } = clubFixture(), { programme, programmes } = organizerFixture();
  const nomination: OperatorClubRequest = { requestId: request.requestId, clubId: request.clubId, clubName: "Synthetic treasury club",
    address: candidate.safeAddress, requestedAt: request.requestedAt, nominationStatus: "pending_review" };
  const selection: OperatorClubSelection = { programmeId: programme.programmeId, chainId: 31337, requestId: request.requestId,
    clubId: request.clubId, address: candidate.safeAddress, requestedAt: request.requestedAt };
  const { address: _address, ...scope } = selection;
  const context: OperatorClubContext = { ...scope, clubName: nomination.clubName, ownerProfileId: clubId(5), ownerName: "Synthetic club owner",
    candidate, nominationStatus: "pending_review", identityFingerprintSha256: "a".repeat(64), reviewState: "unreviewed", latestReview: null };
  const observeInput = { expectedIdentityFingerprintSha256: context.identityFingerprintSha256, expectedRevision: 0,
    factoryAddress: clubAddress(30), deploymentTransactionHash: clubReviewTestHash(31) };
  const preview: ClubReviewObservation = { programmeId: programme.programmeId, requestId: request.requestId, chainId: 31337, ...observeInput,
    candidate, initializerHash: clubReviewTestHash(32), deploymentBlock: { number: "100", hash: clubReviewTestHash(33), timestamp: "1788915600" },
    reviewedBlock: { number: "120", hash: clubReviewTestHash(34), timestamp: "1788915610" }, scope: "initialization_only", executionHistoryReviewRequired: true };
  const refs = { authorityEvidenceRef: clubId(40), controlEvidenceRef: clubId(41), recoveryEvidenceRef: clubId(42), executionHistoryEvidenceRef: clubId(43) };
  const input = makeClubReviewInput(selection, preview, refs, clubId(44));
  const review: OperatorClubReview = { reviewId: clubId(45), revision: 1, reviewedAt: "2026-09-09T01:02:00Z",
    identityFingerprintSha256: context.identityFingerprintSha256, revokedAt: null, revocationReason: null };
  const reply = { programmeId: programme.programmeId, requestId: request.requestId, chainId: 31337, review };
  const page = { programmeId: programme.programmeId, chainId: 31337 as const, items: [nomination], nextCursor: null };
  return { programme, programmes, candidate, nomination, selection, context, preview, observeInput, refs, input, review, reply, page };
}
