import { beforeEach, describe, expect, it, vi } from "vitest";
import { decodeOrganizerClubReadinessV3, getOrganizerClubReadinessV3, makeOrganizerClubPreparationV3,
  prepareOrganizerClubClaimV3, type OrganizerClubSelectionV3 } from "./organizerClubPreparationV3";

const mock = vi.hoisted(() => ({ api: vi.fn(), env: { rewardPortalEnabled: true,
  rewardDemo: { mode: "local-testnet" } as { mode: string } | null } }));
vi.mock("@/lib/api", () => ({ apiRequest: mock.api }));
vi.mock("@/lib/public-env", () => ({ publicEnv: mock.env }));
const id = (n: number) => `8fc00000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const address = (n: number) => `0x${String(n).padStart(40, "0")}` as const;
function fixture() {
  const selection: OrganizerClubSelectionV3 = { clubId: id(1), slot: 2, award: { chainId: 10143,
    uploadId: id(2), requestId: id(3), claimId: id(4), entitlementId: `0x${"a".repeat(64)}`,
    campaignAddress: address(5), recipientAddress: address(6), amountWei: "100000000000000001", pot: "race" } };
  const readiness = { schema: "raceson-club-readiness-v3", chainId: 10143, uploadId: id(2), requestId: id(3),
    clubId: id(1), slot: 2, address: address(6), state: "reviewed", sourceCurrent: true,
    sourceGuardHash: "b".repeat(64), identityFingerprint: "c".repeat(64), reviewId: id(7),
    reviewedAt: "2026-09-15T12:00:00Z", revokedAt: null };
  const record = { schema: "raceson-club-claim-record-v3", chainId: 10143, uploadId: id(2), requestId: id(3),
    claimId: id(4), entitlementId: selection.award.entitlementId, recipientAddress: address(6), amountWei: selection.award.amountWei,
    issuedAt: "1800000000", expiresAt: "1800001000", recipientConsented: false, operatorApproved: false };
  return { selection, readiness, record };
}
beforeEach(() => { mock.api.mockReset(); mock.env.rewardPortalEnabled = true; mock.env.rewardDemo = { mode: "local-testnet" }; });

describe("V3 organizer club preparation boundary", () => {
  it("reads only the selected upload/nomination with no-store and no wallet or write", async () => {
    const f = fixture(); mock.api.mockResolvedValue(f.readiness);
    expect(await getOrganizerClubReadinessV3(f.selection)).toEqual(f.readiness);
    expect(mock.api).toHaveBeenCalledExactlyOnceWith({ path: `/v1/organizer/rewards/uploads/${id(2)}/club-treasuries/${id(3)}/readiness-v3`, cache: "no-store" });
  });
  it.each([
    { chainId: 31337 }, { uploadId: id(90) }, { requestId: id(90) }, { clubId: id(90) }, { slot: 6 }, { address: address(90) },
    { schema: "raceson-club-readiness-v2" }, { state: "paid" }, { privateProof: "hidden" },
    { sourceGuardHash: `0x${"b".repeat(64)}` }, { identityFingerprint: "invalid" },
    { reviewId: null }, { reviewedAt: "invalid" }, { sourceCurrent: false }, { revokedAt: "2026-09-15T12:01:00Z" },
  ])("rejects foreign, private or inconsistent readiness %j", patch => {
    const f = fixture(); expect(() => decodeOrganizerClubReadinessV3({ ...f.readiness, ...patch }, f.selection)).toThrow();
  });
  it.each(["request_withdrawn", "identity_hold", "source_hold", "revoked", "identity_changed", "unreviewed"])("never prepares a %s nomination", state => {
    const f = fixture(), raw = { ...f.readiness, state,
      ...(state === "unreviewed" ? { reviewId: null, reviewedAt: null } : {}),
      ...(state === "revoked" ? { revokedAt: "2026-09-15T12:01:00Z" } : {}) };
    expect(decodeOrganizerClubReadinessV3(raw, f.selection).state).toBe(state);
    expect(() => makeOrganizerClubPreparationV3(f.selection, raw)).toThrow(); expect(mock.api).not.toHaveBeenCalled();
  });
  it("captures immutable original expectations, submits no amount/nonce/recipient, checks exact result", async () => {
    const f = fixture(), command = makeOrganizerClubPreparationV3(f.selection, f.readiness);
    f.selection.award.claimId = id(90); f.readiness.sourceGuardHash = "d".repeat(64);
    mock.api.mockResolvedValue(f.record); expect(await prepareOrganizerClubClaimV3(command)).toEqual(f.record);
    expect(Object.isFrozen(command.selection.award)).toBe(true); expect(Object.isFrozen(command.body)).toBe(true);
    expect(mock.api).toHaveBeenCalledExactlyOnceWith({ path: `/v1/organizer/rewards/uploads/${id(2)}/club-treasuries/${id(3)}/awards/${f.record.entitlementId}/claims/${id(4)}/prepare`,
      method: "POST", cache: "no-store", body: { reviewId: id(7), sourceGuardHash: "b".repeat(64), identityFingerprint: "c".repeat(64) } });
  });
  it("retries only on explicit caller action with the identical claim and original review", async () => {
    const f = fixture(), command = makeOrganizerClubPreparationV3(f.selection, f.readiness);
    mock.api.mockRejectedValueOnce({ status: 503 }).mockResolvedValueOnce({ ...f.record, recipientConsented: true });
    await expect(prepareOrganizerClubClaimV3(command)).rejects.toEqual({ status: 503 });
    expect(mock.api).toHaveBeenCalledTimes(1);
    expect((await prepareOrganizerClubClaimV3(command)).recipientConsented).toBe(true);
    expect(mock.api.mock.calls[1]).toEqual(mock.api.mock.calls[0]);
  });
  it.each([{ amountWei: "1" }, { recipientAddress: address(90) }, { claimId: id(90) }, { uploadId: id(90) },
    { operatorApproved: true }, { transactionHash: `0x${"a".repeat(64)}` }])("rejects mismatched or payment-like preparation metadata %j", async patch => {
    const f = fixture(); mock.api.mockResolvedValue({ ...f.record, ...patch });
    await expect(prepareOrganizerClubClaimV3(makeOrganizerClubPreparationV3(f.selection, f.readiness))).rejects.toThrow();
  });
  it("rejects invalid selection, injected body fields and accessor properties before IO", async () => {
    const f = fixture(); await expect(getOrganizerClubReadinessV3({ ...f.selection, slot: 6 })).rejects.toThrow();
    const c = makeOrganizerClubPreparationV3(f.selection, f.readiness);
    await expect(prepareOrganizerClubClaimV3({ ...c, body: { ...c.body, amountWei: "1" } } as typeof c)).rejects.toThrow();
    const getter = vi.fn(() => f.readiness.reviewId), raw = { ...f.readiness };
    Object.defineProperty(raw, "reviewId", { get: getter });
    expect(() => decodeOrganizerClubReadinessV3(raw, f.selection)).toThrow(); expect(getter).not.toHaveBeenCalled();
    expect(mock.api).not.toHaveBeenCalled();
  });
  it("fails closed with rewards disabled or the wrong network before IO", async () => {
    const f = fixture(), command = makeOrganizerClubPreparationV3(f.selection, f.readiness);
    mock.env.rewardPortalEnabled = false;
    await expect(getOrganizerClubReadinessV3(f.selection)).rejects.toThrow();
    await expect(prepareOrganizerClubClaimV3(command)).rejects.toThrow();
    mock.env.rewardPortalEnabled = true; mock.env.rewardDemo = { mode: "local" };
    await expect(prepareOrganizerClubClaimV3(command)).rejects.toThrow(); expect(mock.api).not.toHaveBeenCalled();
  });
  it("rechecks environment after asynchronous reads and preparation", async () => {
    const f = fixture(), command = makeOrganizerClubPreparationV3(f.selection, f.readiness);
    mock.api.mockImplementationOnce(async () => { mock.env.rewardDemo = null; return f.readiness; });
    await expect(getOrganizerClubReadinessV3(f.selection)).rejects.toThrow();
    mock.env.rewardDemo = { mode: "local-testnet" };
    mock.api.mockImplementationOnce(async () => { mock.env.rewardDemo = null; return f.record; });
    await expect(prepareOrganizerClubClaimV3(command)).rejects.toThrow();
  });
});
