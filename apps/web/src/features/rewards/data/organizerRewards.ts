import { apiRequest } from "@/lib/api";
import { publicEnv } from "@/lib/public-env";
import { requirePortal } from "../model/athleteRewards";
import { requireClaimNetwork } from "./athleteClaims";
import { decodeOrganizerDestination, decodeOrganizerPage, decodeOrganizerProgramme, decodeOrganizerReadiness,
  decodeOrganizerReviewInput, decodeOrganizerReviewReply, decodeOrganizerSelection, organizerUuid, revocationReasons,
  type OrganizerReviewInput, type OrganizerSelection, type RevocationReason, type RewardNetwork } from "../model/organizerRewards";

const base = "/v1/organizer/rewards/programmes";
function network(): RewardNetwork {
  const chainId = publicEnv.rewardDemo?.mode === "local" ? 31337 : 10143;
  requireClaimNetwork(chainId); return chainId;
}
const cursor = (after: string | null) => { requirePortal(after === null || organizerUuid(after)); return after ? `?after=${encodeURIComponent(after)}` : ""; };
const readinessPath = (scope: OrganizerSelection) => `${base}/${scope.programmeId}/destinations/${scope.requestId}/readiness`;
export async function getOrganizerProgrammes(after: string | null = null) {
  const chainId = network(), path = base + cursor(after);
  const raw = await apiRequest<unknown>({ path, cache: "no-store" }); requireClaimNetwork(chainId);
  return decodeOrganizerPage(raw, chainId, after, decodeOrganizerProgramme, item => item.programmeId);
}
export async function getOrganizerDestinations(programmeId: string, after: string | null = null) {
  requirePortal(organizerUuid(programmeId)); const chainId = network(), path = `${base}/${programmeId}/destinations${cursor(after)}`;
  const raw = await apiRequest<unknown>({ path, cache: "no-store" }); requireClaimNetwork(chainId);
  return decodeOrganizerPage(raw, chainId, after, decodeOrganizerDestination, item => item.requestId, programmeId);
}
export async function getOrganizerReadiness(selection: OrganizerSelection) {
  const fixed = decodeOrganizerSelection(selection); requireClaimNetwork(fixed.chainId);
  const raw = await apiRequest<unknown>({ path: readinessPath(fixed), cache: "no-store" }); requireClaimNetwork(fixed.chainId);
  return decodeOrganizerReadiness(raw, fixed);
}
export async function recordOrganizerReview(selection: OrganizerSelection, input: OrganizerReviewInput) {
  const fixed = decodeOrganizerSelection(selection), body = decodeOrganizerReviewInput(input); requireClaimNetwork(fixed.chainId);
  const raw = await apiRequest<unknown>({ path: readinessPath(fixed), method: "POST", body, cache: "no-store" });
  requireClaimNetwork(fixed.chainId); const review = decodeOrganizerReviewReply(raw, fixed);
  requirePortal(review.profileFingerprintSha256 === body.expectedProfileFingerprintSha256 && review.revision === body.expectedRevision + 1);
  return review;
}
export async function revokeOrganizerReview(selection: OrganizerSelection, reviewId: string, reason: RevocationReason) {
  const fixed = decodeOrganizerSelection(selection); requirePortal(organizerUuid(reviewId) && revocationReasons.includes(reason)); requireClaimNetwork(fixed.chainId);
  const raw = await apiRequest<unknown>({ path: `${readinessPath(fixed)}/${reviewId}/revoke`, method: "POST", body: { reason }, cache: "no-store" });
  requireClaimNetwork(fixed.chainId); const review = decodeOrganizerReviewReply(raw, fixed);
  requirePortal(review.reviewId === reviewId && review.revokedAt !== null && review.revocationReason === reason); return review;
}
