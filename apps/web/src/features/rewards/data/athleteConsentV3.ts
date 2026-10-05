import { apiRequest } from "@/lib/api";
import { decodeAthleteAllocationsV3, athleteAllocationCursorV3 } from "@raceson/domain/rewards/athlete-allocations-v3";
import { decodeAthleteConsentSelectionV3, decodeAthleteConsentReviewV3, decodeAthleteConsentRecordV3,
  decodeOwnAthleteClaimsV3, type AthleteConsentSelectionV3 } from "@raceson/rewards-chain/athlete-consent-v3";
import { requireClaimNetwork } from "./athleteClaims";
import { requirePortal, rewardUuid } from "../model/athleteRewards";

function path(s: AthleteConsentSelectionV3) {
  return `/v1/athlete/rewards/uploads/${s.uploadId}/destinations/${s.destinationId}/awards/${s.entitlementId}/claims/${s.claimId}`;
}
export async function getAthleteConsentReviewV3(selection: AthleteConsentSelectionV3) {
  const fixed = decodeAthleteConsentSelectionV3(selection); requireClaimNetwork(fixed.chainId);
  const raw = await apiRequest<unknown>({ path: `${path(fixed)}/signing`, cache: "no-store" });
  requireClaimNetwork(fixed.chainId); return decodeAthleteConsentReviewV3(raw, fixed);
}
/** Consent only: no transfer, nonce choice, key material or operator approval. */
export async function submitAthleteConsentV3(selection: AthleteConsentSelectionV3, signature: string) {
  const fixed = decodeAthleteConsentSelectionV3(selection); requireClaimNetwork(fixed.chainId);
  requirePortal(/^0x[0-9a-f]{128}(1b|1c)$/.test(signature));
  const raw = await apiRequest<unknown>({ path: `${path(fixed)}/proof`, method: "POST", cache: "no-store", body: { signature } });
  requireClaimNetwork(fixed.chainId); return decodeAthleteConsentRecordV3(raw, fixed);
}
export async function getOwnAthleteClaimsV3(chainId: 31337 | 10143, after: string | null = null) {
  requireClaimNetwork(chainId); requirePortal(after === null || rewardUuid(after));
  const raw = await apiRequest<unknown>({ path: `/v1/athlete/rewards/claims-v3${after ? `?after=${encodeURIComponent(after)}` : ""}`, cache: "no-store" });
  requireClaimNetwork(chainId); return decodeOwnAthleteClaimsV3(raw, chainId, after);
}
/** Walletless awards stay visible; listing is not a claimability or payment lease. */
export async function getOwnAthleteAllocationsV3(chainId: 31337 | 10143, after: string | null = null) {
  requireClaimNetwork(chainId); requirePortal(after === null || athleteAllocationCursorV3(after));
  const raw = await apiRequest<unknown>({ path: `/v1/athlete/rewards/programme-allocations-v3${after ? `?after=${encodeURIComponent(after)}` : ""}`, cache: "no-store" });
  requireClaimNetwork(chainId); return decodeAthleteAllocationsV3(raw, chainId, after);
}
