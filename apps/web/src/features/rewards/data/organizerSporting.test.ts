import { beforeEach, describe, expect, it, vi } from "vitest";
import { sportingFixture } from "../../../../../api/test/fixtures/reward-sporting.mjs";
import { getOrganizerSportingSource, captureOrganizerSportingSource, previewOrganizerSportingReview, submitOrganizerSportingReview } from "./organizerSporting";
import type { SportingReviewWire } from "../model/organizerSportingDraft";
const c = vi.hoisted(() => ({ api: vi.fn(), enabled: true, mode: "local" }));
vi.mock("@/lib/api", () => ({ apiRequest: c.api }));
vi.mock("@/lib/public-env", () => ({ publicEnv: { get rewardPortalEnabled() { return c.enabled; }, rewardDemo: { get mode() { return c.mode; } } } }));
beforeEach(() => { c.api.mockReset(); c.enabled = true; c.mode = "local"; });
describe("private sporting browser adapter", () => {
  it("uses pinned no-store sources and strict explicit capture/review bodies without actor or amounts", async () => {
    const f = await sportingFixture(), s = { ...f.selection, chainId: 31337 as const }, base = `/v1/organizer/rewards/programmes/${s.programmeId}/campaigns/${s.campaignId}/sources`;
    c.api.mockResolvedValue(f.view); expect(await getOrganizerSportingSource(s)).toEqual(f.view);
    expect(c.api).toHaveBeenLastCalledWith({ path: base, cache: "no-store" });
    const capture = { idempotencyKey: "synthetic-capture", confirmCapture: true as const }; c.api.mockResolvedValue(f.capture);
    await captureOrganizerSportingSource(s, capture); expect(c.api).toHaveBeenLastCalledWith({ path: `${base}/capture`, method: "POST", body: capture, cache: "no-store" });
    const request = { snapshotId: f.capture.snapshotId, expectedRevision: 0, review: f.f.review as unknown as SportingReviewWire }, p = await f.preview(request); c.api.mockResolvedValue(p);
    await previewOrganizerSportingReview(s, request, "race"); expect(c.api.mock.calls.at(-1)![0].body).toEqual({ expectedRevision: 0, review: f.f.review });
    c.api.mockResolvedValue(f.saved); await submitOrganizerSportingReview(s, { ...request, previewDigest: p.previewDigest, idempotencyKey: "synthetic-save", confirmReview: true });
    expect(Object.keys(c.api.mock.calls.at(-1)![0].body).sort()).toEqual(["confirmReview", "expectedRevision", "idempotencyKey", "previewDigest", "review"]);
  });
  it("denies disabled/wrong network, source-less cursor and malformed capture before I/O", async () => {
    const f = await sportingFixture(), s = { ...f.selection, chainId: 31337 as const }; c.enabled = false;
    await expect(getOrganizerSportingSource(s)).rejects.toThrow(); c.enabled = true;
    await expect(getOrganizerSportingSource({ ...s, chainId: 10143 })).rejects.toThrow();
    await expect(getOrganizerSportingSource(s, null, f.capture.snapshotId)).rejects.toThrow();
    await expect(captureOrganizerSportingSource(s, { idempotencyKey: "x", confirmCapture: true })).rejects.toThrow(); expect(c.api).not.toHaveBeenCalled();
  });
  it("rejects extra private fields and changed network after I/O", async () => {
    const f = await sportingFixture(), s = { ...f.selection, chainId: 31337 as const };
    c.api.mockResolvedValue({ ...f.view, context: {} }); await expect(getOrganizerSportingSource(s)).rejects.toThrow();
    c.api.mockImplementation(async () => { c.mode = "testnet"; return f.view; }); await expect(getOrganizerSportingSource(s)).rejects.toThrow();
  });
});
