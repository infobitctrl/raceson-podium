export const nativeId = n => `8e000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export function nativeFinaleFixture() {
  const id = nativeId, time = "2026-09-10T04:00:00.000Z";
  return { observedAt: "2026-09-10T05:00:00.000Z", document: { schema: "raceson-native-finale-source-v3", draftId: id(1),
    chainId: 31337, organizationId: id(2), recordRevision: 1, binding: { id: id(3), editionId: id(4), races: [{ competitionId: id(5), raceId: id(6) }] },
    edition: { id: id(4), status: "completed", isPractice: true, removed: false }, races: [{ raceId: id(6), competitionId: id(5),
      status: "completed", removed: false, resultsMode: "standard", distanceMetres: "5000",
      review: { schema: "raceson-result-review-v3", categoryId: id(6), organizationId: id(2), state: "final", revision: 1,
        reviewSeconds: 0, policyId: id(7), configuredAt: "2026-09-10T03:00:00.000Z", locked: true, held: false,
        startedAt: time, startedByPublicationId: id(8), endsAt: time, latestPublicationId: id(8), finalPublicationId: id(8),
        officialPublishedAt: time, allocationApproved: false },
      publication: { id: id(8), raceId: id(6), runId: id(9), state: "official", publishedAt: time },
      run: { id: id(9), raceId: id(6), status: "succeeded", completedAt: "2026-09-10T03:59:00.000Z" }, expectedResultCount: 1,
      rows: [{ id: id(10), raceId: id(6), runId: id(9), athleteId: id(11), clubId: id(12), registrationMatches: true,
        participationStatus: "finished", resultStatus: "official", finishTimeMs: "1800000", rankOverall: 1, clubPoints: "25.00" }] }] } };
}
