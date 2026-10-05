import type { AthleteConsentRecordV3 } from "@raceson/rewards-chain/athlete-consent-v3";
import { requirePortal, rewardRecord, rewardUuid } from "./athleteRewards";

export const paymentStatesV3 = ["not_prepared", "prepared", "signed", "queued", "leased", "broadcasting", "submitted", "confirmed"] as const;
export type AthletePaymentStatusV3 = {
  schema: "raceson-athlete-payment-status-v3"; chainId: 31337 | 10143;
  uploadId: string; destinationId: string; entitlementId: string; claimId: string;
  recipientAddress: string; amountWei: string; paymentId: string | null;
  state: typeof paymentStatesV3[number]; transactionHash: string | null; confirmed: boolean;
  blockNumber: string | null; blockHash: string | null; readinessHeld: boolean;
};
const hash = (v: unknown) => typeof v === "string" && /^0x[0-9a-f]{64}$/.test(v) && BigInt(v) > 0n;
/** Exact private status projection, never a fresh-chain claimability lease. */
export function decodeAthletePaymentStatusV3(raw: unknown, claim: AthleteConsentRecordV3): AthletePaymentStatusV3 {
  const r = rewardRecord(raw, ["schema", "chainId", "uploadId", "destinationId", "entitlementId", "claimId", "recipientAddress", "amountWei",
    "paymentId", "state", "transactionHash", "confirmed", "blockNumber", "blockHash", "readinessHeld"]);
  requirePortal(r.schema === "raceson-athlete-payment-status-v3" && ["chainId", "uploadId", "destinationId", "entitlementId", "claimId", "recipientAddress", "amountWei"]
    .every(k => r[k] === claim[k as keyof AthleteConsentRecordV3]) && paymentStatesV3.includes(r.state as typeof paymentStatesV3[number])
    && typeof r.confirmed === "boolean" && typeof r.readinessHeld === "boolean"
    && (r.paymentId === null || rewardUuid(r.paymentId)) && (r.transactionHash === null || hash(r.transactionHash))
    && (r.state === "not_prepared") === (r.paymentId === null)
    && (["not_prepared", "prepared"].includes(r.state as string)) === (r.transactionHash === null)
    && (r.state === "confirmed") === r.confirmed);
  requirePortal(r.confirmed ? typeof r.blockNumber === "string" && /^[1-9][0-9]{0,77}$/.test(r.blockNumber)
    && BigInt(r.blockNumber) < (1n << 256n) && hash(r.blockHash) : r.blockNumber === null && r.blockHash === null);
  return r as AthletePaymentStatusV3;
}
