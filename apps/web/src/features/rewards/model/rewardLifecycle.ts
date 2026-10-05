import type { AthleteConsentRecordV3 } from "@raceson/rewards-chain/athlete-consent-v3";
import type { AthletePaymentStatusV3 } from "./athletePaymentStatusV3";

export type ClaimProgress = "unknown" | "unclaimed" | "claimed";
export type PaymentProgress = "unknown" | "not_sent" | "processing" | "held" | "paid";
/** A claim is consent, not a receipt. Missing or partial observations are never zero payments. */
export function rewardLifecycle(claims: Pick<AthleteConsentRecordV3, "recipientConsented">[], complete: boolean,
  statuses: AthletePaymentStatusV3[] | null, failed: boolean): { claim: ClaimProgress; payment: PaymentProgress } {
  const paid = !failed && statuses?.some(s => s.confirmed);
  return {
    claim: paid || claims.some(c => c.recipientConsented) ? "claimed" : complete ? "unclaimed" : "unknown",
    payment: failed || !statuses ? "unknown" : paid ? "paid" : !complete ? "unknown"
      : statuses.some(s => s.readinessHeld) ? "held"
        : statuses.some(s => s.state !== "not_prepared") ? "processing" : "not_sent",
  };
}
export function lifecycleCopy(locale: string) {
  return locale === "hr" ? {
    allocation: "Dodjela", awarded: "Dodijeljeno", claim: "Preuzimanje", payment: "Isplata",
    unknown: "Nije potvrđeno", unclaimed: "Nije zatraženo", claimed: "Zatraženo",
    not_sent: "Nije poslano", processing: "U obradi", held: "Na čekanju", paid: "Isplaćeno",
  } : {
    allocation: "Allocation", awarded: "Awarded", claim: "Claim", payment: "Payment",
    unknown: "Not verified", unclaimed: "Unclaimed", claimed: "Claim submitted",
    not_sent: "Not sent", processing: "Processing", held: "On hold", paid: "Paid",
  };
}
