import { toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { rewardClaimMessagesV3 } from "@raceson/rewards-chain/campaign-v3";
import type { AthleteConsentRecordV3, AthleteConsentSelectionV3 } from "@raceson/rewards-chain/athlete-consent-v3";
import type { AthleteAllocationV3 } from "@raceson/domain/rewards/athlete-allocations-v3";
import type { AthletePaymentStatusV3 } from "./athletePaymentStatusV3";
// Explicit synthetic test signer, never a generated athlete wallet.
export const consentV3Signer = privateKeyToAccount(toHex(0xFE001n, { size: 32 }));
export function consentV3Fixture() {
  const id = (n: number) => `8fe00000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const selection: AthleteConsentSelectionV3 = { chainId: 31337, uploadId: id(1), destinationId: id(2), claimId: id(3), entitlementId: toHex(1n, { size: 32 }),
    campaignAddress: toHex(2n, { size: 20 }), recipientAddress: consentV3Signer.address.toLowerCase() as `0x${string}`, amountWei: "1000000000000000001", pot: "league" };
  const claim: AthleteConsentRecordV3 = { schema: "raceson-athlete-claim-record-v3", chainId: selection.chainId, uploadId: selection.uploadId,
    destinationId: selection.destinationId, claimId: selection.claimId, entitlementId: selection.entitlementId, recipientAddress: selection.recipientAddress,
    amountWei: selection.amountWei, issuedAt: "1800000000", expiresAt: "1800086400", recipientConsented: false, operatorApproved: false };
  const award: AthleteAllocationV3 = { entitlementId: claim.entitlementId, approvalId: id(4), draftId: id(5), slot: 6, athleteProfileId: id(6),
    chainId: 31337, sourceKind: "final_league", amountWei: claim.amountWei, campaignAddress: selection.campaignAddress,
    recordedAt: "2026-09-11T10:00:00Z", ageStatus: "unverified_adult" };
  const typedData = rewardClaimMessagesV3({ chainId: 31337, environment: "local-simulation", verifyingContract: selection.campaignAddress },
    { entitlementId: claim.entitlementId, recipient: claim.recipientAddress, amount: BigInt(claim.amountWei), pot: "league", nonce: 0n,
      issuedAt: BigInt(claim.issuedAt), expiresAt: BigInt(claim.expiresAt), allocationDigest: toHex(4n, { size: 32 }) }).consent;
  const review = { ...claim, status: "signature_required" as const, role: "recipient" as const, typedData,
    observation: { blockNumber: "200", blockHash: toHex(5n, { size: 32 }), timestamp: "1800000001" } };
  const receipt = { ...claim, recipientConsented: true };
  const payment: AthletePaymentStatusV3 = { schema: "raceson-athlete-payment-status-v3", chainId: 31337, uploadId: claim.uploadId, destinationId: claim.destinationId,
    claimId: claim.claimId, entitlementId: claim.entitlementId, recipientAddress: claim.recipientAddress, amountWei: claim.amountWei,
    paymentId: null, state: "not_prepared", transactionHash: null, confirmed: false, blockNumber: null, blockHash: null, readinessHeld: false };
  return { claim, award, selection, review, receipt, payment };
}
