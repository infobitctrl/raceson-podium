import { beforeEach, describe, expect, it, vi } from "vitest";
import { recordWorkspaceFixture } from "../../../../../api/test/fixtures/reward-record-workspace.mjs";
import { listOrganizerRecordRaces, getOrganizerRecordWorkspace, captureOrganizerRecord, previewOrganizerRecord, approveOrganizerRecord, withdrawOrganizerRecord } from "./organizerRecords";
import { buildRecordApproval } from "../model/organizerRecords";
const c = vi.hoisted(() => ({ api: vi.fn(), enabled: true, mode: "local" }));
vi.mock("@/lib/api", () => ({ apiRequest: c.api }));
vi.mock("@/lib/public-env", () => ({ publicEnv: { get rewardPortalEnabled() { return c.enabled; }, rewardDemo: { get mode() { return c.mode; } } } }));
beforeEach(() => { c.api.mockReset(); c.enabled = true; c.mode = "local"; });
describe("record browser transport", () => {
  it("pins scope, uses no-store and sends only explicit decisions without actor/amount/wallet fields", async () => {
    const h = await recordWorkspaceFixture(), s = { ...h.scope, chainId: 31337 as const }, d = buildRecordApproval(h.priorView, h.draft.targetRaceId, "M", h.draft.baselineSourceId, h.f.comparison);
    c.api.mockResolvedValue(h.racePage); expect(await listOrganizerRecordRaces(s)).toEqual(h.racePage);
    c.api.mockResolvedValue(h.priorView); expect(await getOrganizerRecordWorkspace(s, d.priorSnapshotId)).toEqual(h.priorView);
    const capture = { priorRaceId: h.capture.priorRaceId, idempotencyKey: "synthetic-capture", confirmCapture: true as const };
    c.api.mockResolvedValue(h.capture); await captureOrganizerRecord(s, capture); expect(c.api.mock.calls.at(-1)![0].body).toEqual(capture);
    c.api.mockResolvedValue(h.verified); expect(await previewOrganizerRecord(s, d)).toEqual(h.verified);
    const approval = { ...d, previewDigest: h.verified.previewDigest, idempotencyKey: "synthetic-approval", confirmApproval: true as const };
    c.api.mockResolvedValue(h.saved); await approveOrganizerRecord(s, approval); expect(c.api.mock.calls.at(-1)![0].body).toEqual(approval);
    c.api.mockResolvedValue(h.withdrawal); await withdrawOrganizerRecord(s, { approvalId: h.saved.approvalId, expectedRevision: 1,
      idempotencyKey: "synthetic-withdrawal", reason: "  Synthetic correction  ", confirmWithdrawal: true });
    expect(c.api.mock.calls.at(-1)![0].body.reason).toBe("Synthetic correction");
    for (const [call] of c.api.mock.calls) { expect(call.cache).toBe("no-store"); expect(call.path).toContain(`/sources/${s.snapshotId}/record-`);
      expect(JSON.stringify(call)).not.toMatch(/operatorUserId|wallet|amountWei|privateKey/); }
  });
  it("rejects scope, digest, revision and extra-private-field response substitution", async () => {
    const h = await recordWorkspaceFixture(), s = { ...h.scope, chainId: 31337 as const }, d = buildRecordApproval(h.priorView, h.draft.targetRaceId, "M", h.draft.baselineSourceId, h.f.comparison);
    for (const response of [{ ...h.verified, gender: "F" }, { ...h.verified, snapshotId: d.priorSnapshotId }, { ...h.verified, previewDigest: "bad" }, { ...h.verified, rawPacket: {} }]) {
      c.api.mockResolvedValue(response); await expect(previewOrganizerRecord(s, d)).rejects.toThrow();
    }
    c.api.mockResolvedValue({ ...h.saved, revision: 2 }); await expect(approveOrganizerRecord(s, { ...d, previewDigest: h.verified.previewDigest, idempotencyKey: "synthetic-save", confirmApproval: true })).rejects.toThrow();
    c.api.mockResolvedValue({ ...h.withdrawal, approvalId: s.snapshotId }); await expect(withdrawOrganizerRecord(s, { approvalId: h.saved.approvalId, expectedRevision: 1,
      idempotencyKey: "synthetic-withdraw", reason: "Synthetic correction", confirmWithdrawal: true })).rejects.toThrow();
  });
  it("guards the network before and after IO and rejects incomplete capture/cursor inputs", async () => {
    const h = await recordWorkspaceFixture(), s = { ...h.scope, chainId: 31337 as const };
    c.enabled = false; await expect(listOrganizerRecordRaces(s)).rejects.toThrow(); c.enabled = true;
    await expect(listOrganizerRecordRaces({ ...s, chainId: 10143 })).rejects.toThrow();
    await expect(getOrganizerRecordWorkspace(s, null, s.snapshotId)).rejects.toThrow();
    await expect(captureOrganizerRecord(s, { priorRaceId: h.capture.priorRaceId, idempotencyKey: "x", confirmCapture: true })).rejects.toThrow();
    expect(c.api).not.toHaveBeenCalled(); c.api.mockImplementation(async () => { c.mode = "testnet"; return h.view; });
    await expect(getOrganizerRecordWorkspace(s)).rejects.toThrow();
  });
});
