import { beforeEach, describe, expect, it, vi } from "vitest";
import { organizerClubFixture } from "../model/organizerClubFixtures.test-helper";
import { clubId, clubAddress } from "../model/clubFixtures.test-helper";
import { getOperatorClubRequests, getOperatorClubContext, observeOperatorClub, recordOperatorClub, revokeOperatorClub } from "./organizerClubs";
const c = vi.hoisted(() => ({ api: vi.fn(), enabled: true, mode: "local" }));
vi.mock("@/lib/api", () => ({ apiRequest: c.api }));
vi.mock("@/lib/public-env", () => ({ publicEnv: { get rewardPortalEnabled() { return c.enabled; }, rewardDemo: { get mode() { return c.mode; } } } }));
beforeEach(() => { c.api.mockReset(); c.enabled = true; c.mode = "local"; });
const path = (f: ReturnType<typeof organizerClubFixture>) => `/v1/organizer/rewards/programmes/${f.selection.programmeId}/club-treasuries`;
describe("organizer club HTTP client", () => {
  it("uses explicit no-store list, selected detail and read-only chain observation routes", async () => {
    const f = organizerClubFixture(); c.api.mockResolvedValueOnce(f.page).mockResolvedValueOnce(f.context).mockResolvedValueOnce(f.preview);
    expect(await getOperatorClubRequests(f.programme.programmeId, 31337)).toEqual({ chainId: 31337, items: f.page.items, nextCursor: null });
    expect(await getOperatorClubContext(f.selection)).toEqual(f.context);
    expect(await observeOperatorClub(f.selection, f.observeInput)).toEqual(f.preview);
    expect(c.api.mock.calls.map(([x]) => x)).toEqual([{ path: path(f), cache: "no-store" },
      { path: `${path(f)}/${f.selection.requestId}/review`, cache: "no-store" },
      { path: `${path(f)}/${f.selection.requestId}/observe`, method: "POST", body: f.observeInput, cache: "no-store" }]);
  });
  it("copies the selected scope, expectation and all nested decision fields before asynchronous IO", async () => {
    const f = organizerClubFixture(), original = structuredClone(f.input);
    c.api.mockImplementation(async () => { f.selection.requestId = clubId(99); f.input.evidence.candidate.owners[0] = clubAddress(99);
      f.input.evidence.reviewedBlock.number = "999"; f.input.evidence.controlEvidenceRef = clubId(99); return f.reply; });
    expect(await recordOperatorClub(f.selection, f.input)).toEqual(f.review);
    expect(c.api.mock.calls[0][0].body).toEqual(original); expect(c.api.mock.calls[0][0].cache).toBe("no-store");
  });
  it("requires the exact review revision and identity receipt, plus exact reasoned revocation", async () => {
    const f = organizerClubFixture();
    for (const patch of [{ programmeId: clubId(99) }, { requestId: clubId(99) }, { chainId: 10143 }, { review: { ...f.review, revision: 2 } },
      { review: { ...f.review, identityFingerprintSha256: "b".repeat(64) } }, { privateEvidence: "secret" }]) {
      c.api.mockResolvedValue({ ...f.reply, ...patch }); await expect(recordOperatorClub(f.selection, f.input)).rejects.toThrow();
    }
    const review = { ...f.review, revokedAt: "2026-09-09T01:03:00Z", revocationReason: "operator_correction" as const };
    c.api.mockResolvedValue({ ...f.reply, review }); expect(await revokeOperatorClub(f.selection, f.review.reviewId, "operator_correction")).toEqual(review);
    expect(c.api.mock.lastCall?.[0]).toEqual({ path: `${path(f)}/${f.selection.requestId}/reviews/${f.review.reviewId}/revoke`, method: "POST",
      body: { reason: "operator_correction", confirmRevoke: true }, cache: "no-store" });
    c.api.mockResolvedValue(f.reply); await expect(revokeOperatorClub(f.selection, f.review.reviewId, "operator_correction")).rejects.toThrow();
  });
  it("rejects wrong scope, unsorted/oversized pages and invalid cursors", async () => {
    const f = organizerClubFixture(), items = Array.from({ length: 25 }, (_, i) => ({ ...f.nomination, requestId: clubId(i + 50) }));
    c.api.mockResolvedValue({ ...f.page, items, nextCursor: clubId(74) });
    expect((await getOperatorClubRequests(f.programme.programmeId, 31337, clubId(49))).items).toHaveLength(25);
    for (const patch of [{ programmeId: clubId(99) }, { chainId: 10143 }, { items: [items[1], items[0]] },
      { items: [...items, items[0]] }, { nextCursor: clubId(70) }]) {
      c.api.mockResolvedValue({ ...f.page, items, nextCursor: clubId(74), ...patch });
      await expect(getOperatorClubRequests(f.programme.programmeId, 31337)).rejects.toThrow();
    }
  });
  it("denies disabled/invalid/wrong-network input before IO and a network change before showing any response", async () => {
    const f = organizerClubFixture(); c.enabled = false; await expect(getOperatorClubContext(f.selection)).rejects.toThrow(); c.enabled = true;
    await expect(getOperatorClubRequests("../other", 31337)).rejects.toThrow();
    await expect(getOperatorClubRequests(f.programme.programmeId, 31337, "bad")).rejects.toThrow();
    await expect(recordOperatorClub(f.selection, { ...f.input, confirmReview: false } as never)).rejects.toThrow();
    c.mode = "testnet"; await expect(observeOperatorClub(f.selection, f.observeInput)).rejects.toThrow(); expect(c.api).not.toHaveBeenCalled();
    c.mode = "local"; c.api.mockImplementation(async () => { c.mode = "testnet"; return f.context; });
    await expect(getOperatorClubContext(f.selection)).rejects.toThrow();
  });
});
