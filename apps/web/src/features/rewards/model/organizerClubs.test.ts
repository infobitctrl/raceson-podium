import { describe, expect, it, vi } from "vitest";
import { clubAddress, clubId } from "./clubFixtures.test-helper";
import { organizerClubFixture, clubReviewTestHash } from "./organizerClubFixtures.test-helper";
import { decodeClubObservation, decodeClubObserveInput, decodeOperatorClubContext, decodeOperatorClubRequest, decodeOperatorClubReview, makeClubReviewInput } from "./organizerClubs";
describe("private organizer club review documents", () => {
  it("decodes only named public projection fields and preserves unreviewed nominations", () => {
    const f = organizerClubFixture(); expect(decodeOperatorClubRequest(f.nomination)).toEqual(f.nomination);
    expect(decodeOperatorClubContext(f.context, f.selection)).toEqual(f.context);
    expect(decodeOperatorClubReview(f.review)).toEqual(f.review);
    for (const extra of ["sessionId", "authorityEvidenceRef", "idempotencyKey", "signature", "secret"]) {
      expect(() => decodeOperatorClubContext({ ...f.context, [extra]: "not public" }, f.selection)).toThrow();
      expect(() => decodeOperatorClubRequest({ ...f.nomination, [extra]: "not public" })).toThrow();
    }
  });
  it("copies nested configuration and rejects getters, symbols, inherited fields and invalid labels", () => {
    const f = organizerClubFixture(), decoded = decodeOperatorClubContext(f.context, f.selection);
    f.context.candidate.owners[0] = clubAddress(99); expect(decoded.candidate.owners[0]).toBe(clubAddress(20));
    const getter = vi.fn(() => "side effect");
    expect(() => decodeOperatorClubRequest({ ...f.nomination, get clubName() { return getter(); } })).toThrow();
    expect(getter).not.toHaveBeenCalled();
    expect(() => decodeOperatorClubRequest({ ...f.nomination, [Symbol("private")]: true })).toThrow();
    expect(() => decodeOperatorClubRequest(Object.create(f.nomination))).toThrow();
    for (const clubName of ["", " name ", "a".repeat(257), 1]) expect(() => decodeOperatorClubRequest({ ...f.nomination, clubName })).toThrow();
  });
  it("rejects cross-programme, nomination, club, chain, address and inconsistent review state", () => {
    const f = organizerClubFixture();
    for (const patch of [{ programmeId: clubId(90) }, { requestId: clubId(90) }, { clubId: clubId(90) }, { chainId: 10143 },
      { candidate: { ...f.candidate, safeAddress: clubAddress(90) } }, { reviewState: "reviewed" }, { reviewState: "revoked" },
      { reviewState: "request_withdrawn" }, { latestReview: { ...f.review, reviewedAt: "2026-09-08T01:00:00Z" } }]) {
      expect(() => decodeOperatorClubContext({ ...f.context, ...patch }, f.selection)).toThrow();
    }
    expect(() => decodeOperatorClubContext({ ...f.context, reviewState: "reviewed", latestReview: { ...f.review, identityFingerprintSha256: "b".repeat(64) } }, f.selection)).toThrow();
    expect(decodeOperatorClubContext({ ...f.context, reviewState: "identity_hold", nominationStatus: "identity_hold" }, f.selection).reviewState).toBe("identity_hold");
  });
  it("accepts exact initialization-only observations and rejects expanded trust, altered scope and bad block order", () => {
    const f = organizerClubFixture(); expect(decodeClubObservation(f.preview, f.selection, f.observeInput)).toEqual(f.preview);
    for (const patch of [{ scope: "fully_verified" }, { executionHistoryReviewRequired: false }, { expectedRevision: 1 },
      { factoryAddress: f.candidate.safeAddress }, { deploymentTransactionHash: clubReviewTestHash(90) }, { initializerHash: "0x0" },
      { reviewedBlock: { ...f.preview.reviewedBlock, number: "99" } }, { reviewedBlock: { ...f.preview.reviewedBlock, timestamp: "1" } },
      { deploymentBlock: { ...f.preview.deploymentBlock, number: "0100" } }]) {
      expect(() => decodeClubObservation({ ...f.preview, ...patch }, f.selection, f.observeInput)).toThrow();
    }
  });
  it("compares same-height blocks by values regardless of JSON field insertion order", () => {
    const f = organizerClubFixture(), b = f.preview.deploymentBlock;
    const preview = { ...f.preview, reviewedBlock: { timestamp: b.timestamp, hash: b.hash, number: b.number } };
    expect(decodeClubObservation(preview, f.selection, f.observeInput).reviewedBlock).toEqual(b);
    expect(() => decodeClubObservation({ ...preview, reviewedBlock: { ...b, hash: clubReviewTestHash(99) } }, f.selection, f.observeInput)).toThrow();
  });
  it("requires explicit actual-record references and copies the complete review decision", () => {
    const f = organizerClubFixture(), input = makeClubReviewInput(f.selection, f.preview, f.refs, clubId(44));
    expect(input).toEqual(f.input); expect(input.confirmReview).toBe(true);
    f.preview.candidate.owners[0] = clubAddress(99); f.preview.reviewedBlock.number = "999"; f.refs.controlEvidenceRef = clubId(90);
    expect(input.evidence.candidate.owners[0]).toBe(clubAddress(20)); expect(input.evidence.reviewedBlock.number).toBe("120");
    expect(input.evidence.controlEvidenceRef).toBe(clubId(41));
    const fresh = organizerClubFixture();
    expect(() => makeClubReviewInput(fresh.selection, fresh.preview, { ...fresh.refs, recoveryEvidenceRef: "not-a-record" }, clubId(44))).toThrow();
    expect(() => decodeClubObserveInput({ ...fresh.observeInput, expectedRevision: 2147483646 })).toThrow();
  });
});
