import { apiRequest } from "@/lib/api";
import { decodeOwnAthleteClaimsV3, type AthleteConsentRecordV3 } from "@raceson/rewards-chain/athlete-consent-v3";
import { requireClaimNetwork } from "./athleteClaims";
import { decodeAthletePaymentStatusV3 } from "../model/athletePaymentStatusV3";

export async function getAthletePaymentStatusV3(claim: AthleteConsentRecordV3) {
  const fixed = decodeOwnAthleteClaimsV3({ schema: "raceson-own-claims-v3", chainId: claim.chainId, items: [claim], nextCursor: null }, claim.chainId).items[0];
  requireClaimNetwork(fixed.chainId);
  const raw = await apiRequest<unknown>({ path: `/v1/athlete/rewards/uploads/${fixed.uploadId}/destinations/${fixed.destinationId}/awards/${fixed.entitlementId}/claims/${fixed.claimId}/payment`, cache: "no-store" });
  requireClaimNetwork(fixed.chainId); return decodeAthletePaymentStatusV3(raw, fixed);
}
