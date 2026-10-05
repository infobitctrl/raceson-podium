import type { OrganizerDestination, OrganizerPage, OrganizerProgramme, OrganizerReadiness, OrganizerReview, OrganizerReviewInput, OrganizerSelection } from "./organizerRewards";
export const organizerId = (n: number) => `78000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
/** Synthetic display/review fixtures, never real identity or security evidence. */
export function organizerFixture() {
  const programme: OrganizerProgramme = { programmeId: organizerId(1), organizationId: organizerId(2), seasonId: organizerId(3),
    year: 2026, leagueName: "Synthetic Šibenik Trail League", seasonName: "2026", budgetWei: "100000000000000000001", createdAt: "2026-09-08T09:00:00Z" };
  const destination: OrganizerDestination = { requestId: organizerId(4), athleteProfileId: organizerId(5), athleteName: "Synthetic Runner",
    address: `0x${"12".repeat(20)}`, requestedAt: "2026-09-08T09:00:00Z", destinationStatus: "pending_review" };
  const selection: OrganizerSelection = { programmeId: programme.programmeId, chainId: 31337, requestId: destination.requestId,
    athleteProfileId: destination.athleteProfileId, address: destination.address, requestedAt: destination.requestedAt };
  const context: OrganizerReadiness = { ...selection, destinationStatus: "pending_review", dateOfBirth: "1990-01-01", birthYear: 1990,
    profileFingerprintSha256: "a".repeat(64), reviewState: "unreviewed", latestReview: null };
  const review: OrganizerReview = { reviewId: organizerId(6), revision: 1, reviewedAt: "2026-09-08T09:00:01Z",
    profileFingerprintSha256: context.profileFingerprintSha256, revokedAt: null, revocationReason: null };
  const input: OrganizerReviewInput = { expectedProfileFingerprintSha256: context.profileFingerprintSha256, expectedRevision: 0,
    idempotencyKey: organizerId(7), attestation: { schemaVersion: 1, policy: "operator-observed-external-wallet-v1", verifiedDateOfBirth: "1990-01-01",
      identityEvidenceRef: organizerId(10), adultEvidenceRef: organizerId(11), walletMfaEvidenceRef: organizerId(12), walletRecoveryEvidenceRef: organizerId(13) } };
  const programmes: OrganizerPage<OrganizerProgramme> = { chainId: 31337, items: [programme], nextCursor: null };
  const destinations: OrganizerPage<OrganizerDestination> = { chainId: 31337, items: [destination], nextCursor: null };
  return { programme, destination, selection, context, review, input, programmes, destinations };
}
