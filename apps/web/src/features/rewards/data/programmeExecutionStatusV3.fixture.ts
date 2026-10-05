// Invented UI fixture only. No public-chain or actual ledger evidence.
import { uploadContext, uploadFixture } from "./allocationUploadV3.fixture";
export const executionContext = { ...uploadContext, uploadId: uploadFixture(true).prepared!.id, packageHash: "c".repeat(64) };
export const executionWire = (confirmed = true) => ({ schema: "raceson-programme-execution-status-v3" as const,
  chainId: executionContext.chainId, draftId: executionContext.draftId, slot: 1, approvalId: executionContext.approvalId,
  uploadId: executionContext.uploadId, packageHash: executionContext.packageHash, documentHash: executionContext.documentHash,
  current: true, campaignAddress: executionContext.campaignAddress, entitlementCount: "20",
  steps: [0, 1].map(n => ({ intentId: `8d000000-0000-4000-8000-00000000001${n}`, step: n,
    action: n === 0 ? "complete_funding" as const : "upload_awards" as const, batchStart: n === 0 ? null : 0, batchSize: n === 0 ? null : 20,
    state: n === 0 || confirmed ? "confirmed" as const : "submitted" as const, transactionHash: `0x${String(n + 1).repeat(64)}`,
    receipt: n !== 0 && !confirmed ? null : { blockNumber: String(100 + n), blockHash: `0x${String(n + 3).repeat(64)}`,
      blockTimestamp: "1789030000", feeWei: "1000000000000000", recordedAt: "2026-09-10T10:00:00.000Z" } })) });
