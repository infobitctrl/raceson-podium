import { createDefaultRewardProgrammeDraftV2, type SavedRewardPlanningDraft } from "@raceson/domain/rewards/programme-draft-v2";
import type { NativeContinuityViewV3 } from "@raceson/domain/rewards/native-finale-continuity-v3";
const id = (n: number) => `8f000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export function nativeContinuityUiFixture() {
  const record: SavedRewardPlanningDraft = { draftId: id(1), organizationId: id(2), seasonId: id(3), chainId: 31337,
    organizationName: "Synthetic demo", seasonName: "Synthetic league", revision: 1, updatedAt: "2026-09-10T04:00:00.000Z", rules: createDefaultRewardProgrammeDraftV2() };
  const data: NativeContinuityViewV3 = { schema: "raceson-native-continuity-review-v3", draftId: record.draftId, organizationId: record.organizationId,
    chainId: 31337, revision: 1, bindingId: id(4), contextHash: "a".repeat(64), review: null, recordedReview: null, reviewState: "missing", sourceReady: true,
    proposedWei: "0", retainedWei: "10000000000000000000000", allocationApproved: false, payableWei: "0",
    options: { athletes: [{ id: id(10), name: "Synthetic Ana" }, { id: id(11), name: "Synthetic Luka" }], clubs: [{ id: id(12), name: "Synthetic club" }],
      historicalAthletes: [{ id: id(20), name: "Historical Ana" }], historicalClubs: [{ id: id(21), name: "Historical club" }],
      categories: ["Short Female", "Short Male", "Short Female U16", "Short Male U16", "Short Senior 65+", "Long Female", "Long Male"].map((name, i) => ({ id: id(30 + i), name, competitionId: id(i < 5 ? 40 : 41) })),
      rows: [{ id: id(50), athleteId: id(10), clubId: id(12), competitionId: id(40), finished: true }, { id: id(51), athleteId: id(11), clubId: id(12), competitionId: id(40), finished: false }] } };
  return { record, bindingId: id(4), data, id };
}
