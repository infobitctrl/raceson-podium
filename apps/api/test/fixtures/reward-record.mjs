import { calculationFixture, rewardId as id } from "./reward-calculation.mjs";
export function recordFixture() {
  const f = calculationFixture();
  f.source.mappings[0].startAt = "2026-06-01T10:00:00Z";
  const m = f.source.mappings[0];
  const source = { schemaVersion: 1, organizationId: id(1), latestPublicationId: id(60006),
    race: { id: id(60001), eventEditionId: id(60000), status: "completed", eventStatus: "completed",
      isPractice: false, organizerDeletedAt: null, editionDeletedAt: null, resultsMode: "standard",
      startAt: "2025-06-01T08:00:00Z", distanceMetres: "5000.00", courseFormat: "standard", lapCount: 1 },
    track: { snapshotId: id(60004), templateId: id(60002), versionId: id(60003), distanceMetres: "5000.00" },
    publication: { ...m.publication, id: id(60006), raceId: id(60001), runId: id(60005),
      publishedAt: "2025-06-01T10:00:00.000001+00:00", createdAt: "2025-06-01T10:00:00Z" },
    run: { id: id(60005), raceId: id(60001), status: "succeeded", completedAt: "2025-06-01T09:00:00Z" },
    rows: f.source.rows.filter((row) => row.raceId === m.raceId).map((row, index) => ({
      id: id(60020 + index), raceId: id(60001), publicationId: id(60006), resultRunId: id(60005), registrationId: id(60010 + index),
      sourceAthleteId: row.sourceAthleteId, canonicalAthleteId: row.canonicalAthleteId, identityPath: [...row.identityPath],
      identityCycle: false, unresolvedMergeId: null, gender: row.gender, registrationAthleteId: row.registrationAthleteId,
      registrationRaceId: id(60001), participationStatus: row.participationStatus, resultStatus: row.resultStatus,
      finishTimeMs: row.finishTimeMs === null ? null : String(1800000 + index * 100000),
    })), adjudicationCases: [],
  };
  const priorSnapshot = { snapshotId: id(60040), campaignId: f.campaignId, targetSnapshotId: f.snapshotId, priorRaceId: id(60001),
    capturedAt: "2026-06-01T13:00:00+00:00", sourceFingerprintSha256: "cd".repeat(32), source };
  const comparison = { priorDirection: "forward", targetDirection: "forward", priorTimingMethod: "manual", targetTimingMethod: "manual",
    priorTimingBasis: "gun", targetTimingBasis: "gun",
    priorPrecisionMs: "1000", targetPrecisionMs: "1000", courseEquivalent: true, historyReviewed: true, exceptionsReviewed: true,
    rationale: "Synthetic official compared course geometry, direction, timing and full prior record history. Not a real approval." };
  return { ...f, priorSnapshot, comparison,
    input: { campaignId: f.campaignId, targetSnapshotId: f.snapshotId, targetRaceId: m.raceId, priorRaceId: id(60001),
      baselineSourceId: id(60020), gender: "M", comparison, idempotencyKey: "synthetic-record-capture" } };
}
