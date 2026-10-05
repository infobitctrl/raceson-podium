import { describe, expect, it } from "vitest";
import { sportingFixture } from "../../../../../api/test/fixtures/reward-sporting.mjs";
import { emptySportingDraft, buildSportingReview, suggestSportingRanks, sportingGroupKey } from "./organizerSportingDraft";
import { decodeRewardSportingSource, decodeRewardSportingPreview } from "@raceson/domain/rewards";

describe("sporting draft and private browser projections", () => {
  it("requires explicit decisions, ranks all eligible members and keeps unknown/walletless weights", async () => {
    const f = await sportingFixture(), source = f.view.source!, draft = emptySportingDraft();
    expect(() => buildSportingReview(source, draft)).toThrow("reference"); draft.reference = "synthetic-reviewed-case";
    expect(() => buildSportingReview(source, draft)).toThrow("memberships");
    const unknown = source.items[4]; draft.memberships[unknown.sourceId] = { classification: unknown.possibleClassificationIds[1], evidence: "synthetic-age-evidence" };
    expect(() => buildSportingReview(source, draft)).toThrow("ranks"); draft.ranks = suggestSportingRanks(source, draft);
    expect(() => buildSportingReview(source, draft)).toThrow("records");
    for (const race of source.rounds[0].races) for (const gender of ["M", "F"]) draft.records[`${race.id}:${gender}`] = { choice: "none", approval: null };
    const review = buildSportingReview(source, draft); expect(review.roundReviews[0].podiums).toHaveLength(7);
    expect(review.roundReviews[0].podiums.flatMap(p => p.entries)).toHaveLength(6);
    const preview = await f.preview({ snapshotId: source.snapshotId, expectedRevision: 0, review });
    expect(preview.selectedFinishCount).toBe(6); expect(preview.excludedFinishCount).toBe(1);
    expect(BigInt(preview.allocatedWei) + BigInt(preview.unallocatedWei)).toBe(1200n * 10n ** 18n);
  });
  it("requires all pages and explicit duplicate adjudication, without unrelated league age or podium decisions", async () => {
    const f = await sportingFixture("league"), source = f.view.source!, draft = emptySportingDraft();
    expect(() => buildSportingReview(source, draft)).toThrow("load_all");
    const { getOrganizerSportingSource } = await import("../../../../../api/dist/features/rewards/organizer-sporting-service.js");
    const page = await getOrganizerSportingSource(f.identity, f.selection, { snapshotId: source.snapshotId, afterId: source.nextCursor }, f.rpc);
    source.items.push(...page.source!.items); source.nextCursor = null;
    const review = buildSportingReview(source, draft); expect(review.roundReviews).toEqual([]);
    const duplicate = { ...source.items[0], sourceId: "78000000-0000-4000-8000-000000009999" }; source.items.push(duplicate); source.resultCount++;
    expect(() => buildSportingReview(source, draft)).toThrow("duplicates");
    draft.selections[sportingGroupKey(duplicate)] = { selected: duplicate.sourceId, evidence: "synthetic-resolution-1" };
    expect(buildSportingReview(source, draft).adjudications[0].sourceIds).toHaveLength(2);
    draft.selections[sportingGroupKey(duplicate)].selected = "exclude";
    expect(buildSportingReview(source, draft).adjudications[0].selectedSourceId).toBeNull();
  });
  it("suggests competition ties 1,1,3 and refuses unresolved sporting cases", async () => {
    const f = await sportingFixture(), source = f.view.source!, draft = emptySportingDraft();
    source.items[1].finishTimeMs = source.items[0].finishTimeMs;
    const ranks = suggestSportingRanks(source, draft), male = source.items[0].classificationIds[0];
    expect(Object.values(ranks[male])).toEqual(["1", "1", "3", "4"]);
    source.rounds[0].openCaseIds.push(source.snapshotId); expect(() => buildSportingReview(source, draft)).toThrow("open_cases");
  });
  it("rejects private fields, mismatched maps, unsafe getters, amount drift and bad pagination", async () => {
    const f = await sportingFixture();
    for (const mutate of [v => v.context = {}, v => v.source.items[0].dateOfBirth = "1990-01-01", v => v.source.rounds[0].races.pop(),
      v => v.source.items[0].distanceMetres = "1", v => v.source.items[0].sourceId = v.source.items[1].sourceId]) {
      const v = structuredClone(f.view); mutate(v); expect(() => decodeRewardSportingSource(v, f.selection, null)).toThrow();
    }
    const v = structuredClone(f.view); let called = false; Object.defineProperty(v, "source", { enumerable: true, get() { called = true; return null; } });
    expect(() => decodeRewardSportingSource(v, f.selection, null)).toThrow(); expect(called).toBe(false);
    const request = { snapshotId: f.f.snapshotId, expectedRevision: 0, review: f.f.review }, preview = await f.preview(request);
    expect(() => decodeRewardSportingPreview({ ...preview, allocatedWei: "1" }, { ...f.selection, ...request }, "race")).toThrow();
  });
});
