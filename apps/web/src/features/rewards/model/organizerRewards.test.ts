import { describe, expect, it } from "vitest";
import { organizerFixture, organizerId as id } from "./organizerFixtures.test-helper";
import { decodeOrganizerDestination, decodeOrganizerPage, decodeOrganizerProgramme, decodeOrganizerReadiness,
  decodeOrganizerReviewInput, decodeOrganizerReviewReply } from "./organizerRewards";

describe("private organizer browser projection", () => {
  it("keeps exact configured budgets and current display data without private evidence in lists", () => {
    const f = organizerFixture(); expect(decodeOrganizerProgramme(f.programme)).toEqual(f.programme);
    expect(decodeOrganizerDestination(f.destination)).toEqual(f.destination);
    expect(decodeOrganizerPage(f.programmes, 31337, null, decodeOrganizerProgramme, p => p.programmeId)).toEqual(f.programmes);
    expect(decodeOrganizerProgramme({ ...f.programme, leagueName: null, seasonName: null }).leagueName).toBeNull();
    expect(() => decodeOrganizerProgramme({ ...f.programme, budgetWei: 100 })).toThrow();
    expect(() => decodeOrganizerDestination({ ...f.destination, dateOfBirth: f.context.dateOfBirth })).toThrow();
  });
  it("requires strictly ordered complete pages and exact chain/programme scope", () => {
    const f = organizerFixture(), decode = (raw: unknown) => decodeOrganizerPage(raw, 31337, id(99), decodeOrganizerDestination, d => d.requestId, id(1));
    const page = { ...f.destinations, programmeId: id(1), items: Array.from({ length: 25 }, (_, i) => ({ ...f.destination, requestId: id(100 + i) })), nextCursor: id(124) };
    expect(decode(page).nextCursor).toBe(id(124));
    for (const patch of [{ chainId: 10143 }, { programmeId: id(99) }, { nextCursor: id(125) },
      { items: page.items.slice(1) }, { items: [...page.items].reverse() }, { items: [page.items[0], page.items[0]], nextCursor: null },
      { items: Array.from({ length: 26 }, (_, i) => ({ ...f.destination, requestId: id(100 + i) })) }]) expect(() => decode({ ...page, ...patch })).toThrow();
  });
  it("binds every selected request field, rejects injected private values and never accepts contradictory reviewed states", () => {
    const f = organizerFixture(); expect(decodeOrganizerReadiness(f.context, f.selection)).toEqual(f.context);
    for (const patch of [{ programmeId: id(99) }, { requestId: id(99) }, { athleteProfileId: id(99) }, { address: `0x${"34".repeat(20)}` },
      { requestedAt: "2026-09-08T09:00:02Z" }, { chainId: 10143 }, { signature: "private" }, { dateOfBirth: "2000-02-30" },
      { latestReview: null, reviewState: "reviewed" }, { latestReview: f.review, reviewState: "unreviewed" },
      { latestReview: f.review, reviewState: "revoked" }, { reviewState: "paid" }])
      expect(() => decodeOrganizerReadiness({ ...f.context, ...patch }, f.selection)).toThrow();
    const getter = { ...f.context }; Object.defineProperty(getter, "birthYear", { enumerable: true, get: () => { throw Error("accessed"); } });
    expect(() => decodeOrganizerReadiness(getter, f.selection)).toThrow("invalid_response");
  });
  it("copies complete explicit attestations and accepts historical revoked replies without calling them new approval", () => {
    const f = organizerFixture(), input = decodeOrganizerReviewInput(f.input); f.input.attestation.identityEvidenceRef = id(99);
    expect(input.attestation.identityEvidenceRef).toBe(id(10));
    for (const patch of [{ expectedRevision: -1 }, { expectedRevision: 2147483646 }, { idempotencyKey: "tiny" }, { attestation: { approved: true } }])
      expect(() => decodeOrganizerReviewInput({ ...f.input, ...patch })).toThrow();
    const review = { ...f.review, revokedAt: "2026-09-08T09:00:02Z", revocationReason: "operator_correction" };
    expect(decodeOrganizerReviewReply({ programmeId: id(1), requestId: id(4), chainId: 31337, review }, f.selection).revokedAt).not.toBeNull();
  });
});
