import { beforeEach, expect, it, vi } from "vitest";
import { createDefaultRewardProgrammeDraftV2, type SavedRewardPlanningDraft } from "@raceson/domain/rewards/programme-draft-v2";
import { decodeProgrammeDepositQuoteV3 } from "@raceson/domain/rewards/programme-deposit-v3";
import { reviewProgrammeDepositV3, inspectProgrammeDepositV3 } from "./programmeDepositV3";
const mock = vi.hoisted(() => ({ request: vi.fn(), enabled: true, mode: "local" }));
vi.mock("@/lib/api", () => ({ apiRequest: (...args: unknown[]) => mock.request(...args) }));
vi.mock("@/lib/public-env", () => ({ publicEnv: { get rewardDemo() { return mock.enabled ? { mode: mock.mode } : null; }, rewardPortalEnabled: true } }));
const id = "89000000-0000-4000-8000-000000000001", hash = `0x${"d".repeat(64)}`;
const record: SavedRewardPlanningDraft = { draftId: id, organizationId: id, seasonId: id, chainId: 31337, organizationName: "Synthetic organization",
  seasonName: "Synthetic league", revision: 1, updatedAt: "2026-09-10T00:00:00Z", rules: createDefaultRewardProgrammeDraftV2() };
const quote = () => decodeProgrammeDepositQuoteV3({ schema: "raceson-programme-deposit-v3", chainId: 31337, draftId: id, rulesRevision: 1,
  address: `0x${"a".repeat(40)}`, funderAddress: `0x${"b".repeat(40)}`, approvalId: id, contextHash: "c".repeat(64), policyHash: `0x${"e".repeat(64)}`,
  expectedDepositedWei: "0", amountWei: "1000000000000000000", budgetWei: "100000000000000000000000", expiresAt: new Date(Date.now() + 120000).toISOString() });
beforeEach(() => { mock.enabled = true; mock.mode = "local"; mock.request.mockReset(); });
it("review sends only the decimal amount to an authenticated no-store scoped endpoint", async () => {
  const q = quote(); mock.request.mockResolvedValue({ status: "ready", quote: q });
  expect(await reviewProgrammeDepositV3(record, "1")).toEqual({ status: "ready", quote: q });
  expect(mock.request).toHaveBeenCalledWith({ method: "POST", path: `/v1/organizer/rewards/drafts/${id}/deposit-review`, body: { amountMon: "1" }, cache: "no-store" });
});
it("wrong revision, scope, response keys and mainnet are refused", async () => {
  for (const patch of [{ rulesRevision: 2 }, { draftId: "89000000-0000-4000-8000-000000000002" }, { chainId: 143 }, { signature: "forbidden" }]) {
    mock.request.mockResolvedValueOnce({ status: "ready", quote: { ...quote(), ...patch } }); await expect(reviewProgrammeDepositV3(record, "1")).rejects.toThrow();
  }
  mock.request.mockResolvedValueOnce({ status: "ready", quote: quote(), secret: "forbidden" }); await expect(reviewProgrammeDepositV3(record, "1")).rejects.toThrow();
});
it("receipt response binds exactly the requested hash, not a paid claim or other transaction", async () => {
  const q = quote(); mock.request.mockResolvedValue({ status: "confirmed", transactionHash: hash });
  expect((await inspectProgrammeDepositV3(record, q, hash)).status).toBe("confirmed");
  for (const patch of [{ status: "paid" }, { transactionHash: `0x${"a".repeat(64)}` }, { privateProof: "forbidden" }]) {
    mock.request.mockResolvedValueOnce({ status: "confirmed", transactionHash: hash, ...patch }); await expect(inspectProgrammeDepositV3(record, q, hash)).rejects.toThrow();
  }
});
it("disabled or cross-network demo cannot even request a quote or receipt", async () => {
  mock.enabled = false; await expect(reviewProgrammeDepositV3(record, "1")).rejects.toThrow();
  mock.enabled = true; mock.mode = "testnet"; await expect(inspectProgrammeDepositV3(record, quote(), hash)).rejects.toThrow();
  expect(mock.request).not.toHaveBeenCalled();
});
