import { distributionFixture } from "./reward-distribution.mjs";
import { rewardId as id } from "./reward-calculation.mjs";

/** Synthetic wire projections only; never seed real sporting or reward data. */
export function preparationFixture() {
  const f = distributionFixture(), wei = n => String(BigInt(n) * 10n ** 18n);
  const selection = { ...f.scope, campaignId: f.allocation.campaignId };
  const reviewId = id(72), snapshotId = f.detail.sourceSnapshotId;
  const view = { ...selection, budgetWei: wei(1200), stage: "preview", allocationId: null, preview: {
    reviewId, revision: 1, snapshotId, reviewedAt: "2026-09-08T10:00:00Z", capturedAt: "2026-09-08T09:00:00Z",
    pot: "race", previewDigest: "a".repeat(64), allocatedWei: wei(70), unallocatedWei: wei(1130),
    selectedFinishCount: 1, excludedFinishCount: 0, awardCount: 1,
    families: [["podium", 800, 50], ["record", 200, 20], ["club_performance", 200, 0]].map(([family, budget, allocated]) =>
      ({ family, budgetWei: wei(budget), allocatedWei: wei(allocated), unallocatedWei: wei(budget - allocated) })),
    items: [{ key: `athlete:${id(1000)}`, kind: "athlete", id: id(1000), name: "Synthetic runner", amountWei: wei(70),
      breakdown: [{ family: "podium", amountWei: wei(50) }, { family: "record", amountWei: wei(20) }] }], nextCursor: null,
  } };
  const request = { reviewId, previewDigest: view.preview.previewDigest, idempotencyKey: "synthetic-confirmation", confirmAllocation: true };
  const receipt = { ...selection, reviewId, allocationId: f.allocation.allocationId, allocatedWei: wei(70), unallocatedWei: wei(1130),
    entitlementCount: 1, reservedAt: f.detail.reservedAt };
  return { ...f, selection, view, request, receipt };
}
