// Synthetic wire fixture only; never imported by runtime modules.
export const uploadContext = { chainId: 31337, draftId: "8d000000-0000-4000-8000-000000000001", slot: 1,
  approvalId: "8d000000-0000-4000-8000-000000000002", contextHash: "a".repeat(64), documentHash: "b".repeat(64),
  campaignAddress: `0x${"3".repeat(40)}`, budgetWei: "10000000000000000000", allocatedWei: "7000000000000000000",
  unallocatedWei: "3000000000000000000", entitlementCount: "20" };
export function uploadFixture(prepared = false) {
  return { current: true, contextHash: uploadContext.contextHash, budgetWei: uploadContext.budgetWei,
    allocatedWei: uploadContext.allocatedWei, unallocatedWei: uploadContext.unallocatedWei, entitlementCount: uploadContext.entitlementCount,
    prepared: prepared ? { id: "8d000000-0000-4000-8000-000000000003", packageHash: "c".repeat(64), preparedAt: "2026-09-10T09:00:00.000Z" } : null };
}
export const uploadWire = (prepared = false) => ({ schema: "raceson-allocation-upload-view-v3", ...uploadContext,
  ...uploadFixture(prepared), stageReady: false, payableWei: "0" });
