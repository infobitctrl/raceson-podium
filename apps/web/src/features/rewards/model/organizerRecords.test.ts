import { describe, expect, it } from "vitest";
import { recordWorkspaceFixture } from "../../../../../api/test/fixtures/reward-record-workspace.mjs";
import { buildRecordApproval, emptyRecordComparison, mergeRecordResults, mergeRecordRaces } from "./organizerRecords";

describe("record comparison draft", () => {
  it("starts with no implied human decisions and builds an exact reviewed request", async () => {
    const h = await recordWorkspaceFixture(), { targetRaceId, baselineSourceId } = h.draft;
    expect(() => buildRecordApproval(h.priorView, targetRaceId, "M", baselineSourceId, emptyRecordComparison())).toThrow("record_comparison_required");
    expect(buildRecordApproval(h.priorView, targetRaceId, "M", baselineSourceId, h.f.comparison)).toEqual(h.draft);
    expect(() => buildRecordApproval(h.priorView, targetRaceId, "F", baselineSourceId, h.f.comparison)).toThrow("record_baseline_required");
    expect(() => buildRecordApproval({ ...h.priorView, prior: { ...h.priorView.prior!, openCaseCount: 1 } }, targetRaceId, "M", baselineSourceId, h.f.comparison)).toThrow("record_open_cases");
  });
  it("requires full frozen result pages and rejects changed revision/source or overlapping pages", async () => {
    const h = await recordWorkspaceFixture(), p = h.priorView.prior!;
    const first = { ...h.priorView, prior: { ...p, items: p.items.slice(0, 2), nextCursor: p.items[1].sourceId } };
    const second = { ...h.priorView, prior: { ...p, items: p.items.slice(2) } };
    expect(() => buildRecordApproval(first, h.draft.targetRaceId, "M", h.draft.baselineSourceId, h.f.comparison)).toThrow("record_load_all");
    expect(mergeRecordResults(first, second)).toEqual(h.priorView);
    expect(() => mergeRecordResults(first, { ...second, latestApprovals: [h.latest] })).toThrow();
    expect(() => mergeRecordResults(first, first)).toThrow();
    expect(() => mergeRecordResults(first, { ...second, snapshotId: h.draft.priorSnapshotId })).toThrow();
    const page = { ...h.racePage, chainId: 31337 as const }; expect(() => mergeRecordRaces(page, page)).toThrow();
  });
});
