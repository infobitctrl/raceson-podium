import { beforeEach, describe, expect, it, vi } from "vitest";
import { organizerFixture, organizerId as id } from "../model/organizerFixtures.test-helper";
import { getOrganizerDestinations, getOrganizerProgrammes, getOrganizerReadiness, recordOrganizerReview, revokeOrganizerReview } from "./organizerRewards";
const controls = vi.hoisted(() => ({ api: vi.fn(), enabled: true, mode: "local" }));
vi.mock("@/lib/api", () => ({ apiRequest: controls.api }));
vi.mock("@/lib/public-env", () => ({ publicEnv: { get rewardPortalEnabled() { return controls.enabled; }, rewardDemo: { get mode() { return controls.mode; } } } }));
beforeEach(() => { controls.api.mockReset(); controls.enabled = true; controls.mode = "local"; });
const base = "/v1/organizer/rewards/programmes";
describe("private organizer HTTP clients", () => {
  it("loads only the explicit page/detail and uses no-store requests", async () => {
    const f = organizerFixture(); controls.api.mockResolvedValueOnce(f.programmes)
      .mockResolvedValueOnce({ ...f.destinations, programmeId: id(1) }).mockResolvedValueOnce(f.context);
    await getOrganizerProgrammes(); await getOrganizerDestinations(id(1)); await getOrganizerReadiness(f.selection);
    expect(controls.api.mock.calls.map(([c]) => c)).toEqual([
      { path: base, cache: "no-store" }, { path: `${base}/${id(1)}/destinations`, cache: "no-store" },
      { path: `${base}/${id(1)}/destinations/${id(4)}/readiness`, cache: "no-store" },
    ]);
  });
  it("captures decisions before IO and requires exact write response revision, fingerprint and selected scope", async () => {
    const f = organizerFixture(), original = structuredClone(f.input);
    controls.api.mockImplementation(async () => { f.input.attestation.identityEvidenceRef = id(99); f.selection.requestId = id(99);
      return { programmeId: id(1), requestId: id(4), chainId: 31337, review: f.review }; });
    expect(await recordOrganizerReview(f.selection, f.input)).toEqual(f.review);
    expect(controls.api.mock.calls[0][0].body).toEqual(original);
    f.selection.requestId = id(4);
    controls.api.mockResolvedValue({ programmeId: id(1), requestId: id(4), chainId: 31337, review: { ...f.review, revision: 2 } });
    await expect(recordOrganizerReview(f.selection, original)).rejects.toThrow();
  });
  it("retries the same explicit revocation and validates its historical result", async () => {
    const f = organizerFixture(), review = { ...f.review, revokedAt: "2026-09-08T09:00:02Z", revocationReason: "operator_correction" };
    controls.api.mockResolvedValue({ programmeId: id(1), requestId: id(4), chainId: 31337, review });
    await revokeOrganizerReview(f.selection, id(6), "operator_correction");
    expect(controls.api).toHaveBeenCalledExactlyOnceWith({ path: `${base}/${id(1)}/destinations/${id(4)}/readiness/${id(6)}/revoke`,
      method: "POST", body: { reason: "operator_correction" }, cache: "no-store" });
    controls.api.mockResolvedValue({ programmeId: id(1), requestId: id(4), chainId: 31337, review: f.review });
    await expect(revokeOrganizerReview(f.selection, id(6), "operator_correction")).rejects.toThrow();
  });
  it("rejects disabled, invalid and wrong-network inputs before IO, plus configuration changes while reading", async () => {
    const f = organizerFixture(); controls.enabled = false;
    await expect(getOrganizerProgrammes()).rejects.toThrow(); controls.enabled = true;
    await expect(getOrganizerDestinations("../private")).rejects.toThrow();
    await expect(getOrganizerProgrammes("bad")).rejects.toThrow(); controls.mode = "testnet";
    await expect(getOrganizerReadiness(f.selection)).rejects.toThrow(); expect(controls.api).not.toHaveBeenCalled();
    controls.mode = "local"; controls.api.mockImplementation(async () => { controls.mode = "testnet"; return f.programmes; });
    await expect(getOrganizerProgrammes()).rejects.toThrow();
  });
});
