import { apiRequest } from "@/lib/api";
import { decodeClubConsentSelectionV3, decodeClubConsentReviewV3, decodeClubConsentRecordV3,
  type ClubConsentSelectionV3 } from "@raceson/rewards-chain/club-consent-v3";
import { requireClaimNetwork } from "./athleteClaims";
import { requirePortal } from "../model/athleteRewards";

function path(s: ClubConsentSelectionV3) {
  return `/v1/club/rewards/uploads/${s.uploadId}/club-treasuries/${s.requestId}/awards/${s.entitlementId}/claims/${s.claimId}`;
}
export async function getClubConsentReviewV3(selection: ClubConsentSelectionV3) {
  const fixed = decodeClubConsentSelectionV3(selection); requireClaimNetwork(fixed.chainId);
  const raw = await apiRequest<unknown>({ path: `${path(fixed)}/signing`, cache: "no-store" });
  requireClaimNetwork(fixed.chainId); return decodeClubConsentReviewV3(raw, fixed);
}
/** Store consent only. No payment, nonce choice, key, owner identity or chain URL. */
export async function submitClubConsentV3(selection: ClubConsentSelectionV3, signature: string) {
  const fixed = decodeClubConsentSelectionV3(selection); requireClaimNetwork(fixed.chainId);
  requirePortal(/^0x[0-9a-f]{260}$/.test(signature));
  const raw = await apiRequest<unknown>({ path: `${path(fixed)}/proof`, method: "POST", cache: "no-store", body: { signature } });
  requireClaimNetwork(fixed.chainId); return decodeClubConsentRecordV3(raw, fixed);
}
