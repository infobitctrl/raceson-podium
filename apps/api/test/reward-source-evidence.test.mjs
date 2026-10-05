import assert from "node:assert/strict";
import test from "node:test";
import {
  adaptRewardSourceEvidence, reviewRewardRoundEvidence, parseRewardSourceTimestamp,
  assertRewardSourceReviewElapsed,
  calculateRoundRewards, calculateLeagueRewards, RewardCalculationError,
} from "../../../packages/domain/dist/rewards/index.js";

// Synthetic private evidence with the actual 2026 seven-division rule shapes.
// No live athlete, official approval, wallet or signature is manufactured here.
function fixture() {
  const classifications = [
    ["short-u16-f", "short", "F", null, 1599n], ["short-u16-m", "short", "M", null, 1599n],
    ["short-adult-f", "short", "F", 1600n, 6499n], ["short-adult-m", "short", "M", 1600n, 6499n],
    ["short-senior", "short", null, 6500n, null], ["long-f", "long", "F", 100n, null], ["long-m", "long", "M", 100n, null],
  ].map(([id, competitionId, gender, minimumAgeHundredths, maximumAgeHundredths]) => ({ id, competitionId, gender, minimumAgeHundredths, maximumAgeHundredths }));
  const config = {
    organizationId: "org", leagueId: "league", seasonId: "season", year: 2026,
    rounds: [{ id: "round-1", number: 1, eventEditionId: "edition", races: ["short", "long"].map((id) => ({
      id, mappingId: `mapping-${id}`, competitionId: id, distanceMetres: id === "short" ? 5470n : 10830n,
      trackVersionId: `track-${id}`, courseFormat: "standard", lapCount: 1,
    })) }],
    competitions: ["short", "long"].map((id) => ({ id, scoringTarget: "individual", resultBasis: "finish_place" })), classifications,
  };
  const source = {
    schemaVersion: 1, season: { id: "season", organizationId: "org", leagueId: "league", year: 2026 },
    rounds: [{ id: "round-1", number: 1, eventEditionId: "edition", status: "completed", isPractice: false,
      organizerDeletedAt: null, eventStatus: "completed" }],
    competitions: config.competitions.map((row) => ({ ...row, seasonId: "season", status: "active" })),
    classifications: classifications.map((row) => ({ id: row.id, competitionId: row.competitionId, status: "active", eligibility: {
      ...(row.gender === null ? {} : { gender: row.gender }),
      ...(row.minimumAgeHundredths === null ? {} : { minimumAge: Number(row.minimumAgeHundredths) / 100 }),
      ...(row.maximumAgeHundredths === null ? {} : { maximumAge: Number(row.maximumAgeHundredths) / 100 }),
    } })),
    mappings: config.rounds[0].races.map((race) => ({ id: race.mappingId, roundId: "round-1", competitionId: race.id,
      raceId: race.id, status: "mapped", publicationId: `publication-${race.id}`, latestPublicationId: `publication-${race.id}`,
      raceEditionId: "edition", raceStatus: "completed", resultsMode: "standard", organizerDeletedAt: null,
      distanceMetres: `${race.distanceMetres}.000`, startAt: null, courseFormat: "standard", lapCount: 1,
      trackVersionId: race.trackVersionId, trackMetres: race.distanceMetres.toString(),
      publication: { id: `publication-${race.id}`, raceId: race.id, runId: `run-${race.id}`, state: "official",
        publishedAt: "2026-06-10T12:00:00.000001+00:00", signatureState: "legacy_unsigned" },
      run: { id: `run-${race.id}`, raceId: race.id, status: "succeeded", completedAt: "2026-06-10T11:59:00+00:00" },
    })), adjudicationCases: [], rows: [],
  };
  const row = (id, raceId = "short", updates = {}) => ({ id, mappingId: `mapping-${raceId}`, roundId: "round-1", raceId,
    publicationId: `publication-${raceId}`, resultRunId: `run-${raceId}`, registrationId: `registration-${id}`,
    sourceAthleteId: id, canonicalAthleteId: id, identityPath: [id], identityCycle: false, unresolvedMergeId: null,
    athleteStatus: "active", gender: "M", registrationAthleteId: id, registrationRaceId: raceId, registrationStatus: "confirmed",
    participationStatus: "finished", registrationBirthYear: 1990, profileBirthYear: 1990, profileDateBirthYear: null,
    representedClubId: "club-old", canonicalClubId: "club", clubIdentityPath: ["club-old", "club"],
    clubIdentityCycle: false, unresolvedClubMergeId: null, resultStatus: "official", finishTimeMs: "1000000", clubPointsHundredths: "7500.00",
    rankOverall: null, rankGender: null, rankAgeCategory: null, ...updates,
  });
  source.rows = [row("athlete-a"), row("athlete-b", "long", { gender: "F" }), row("athlete-c", "short", {
    registrationBirthYear: null, profileBirthYear: null, profileDateBirthYear: null, finishTimeMs: "900000",
  }), row("dns", "short", { participationStatus: "dns", finishTimeMs: null })];
  const snapshot = { snapshotId: "snapshot-1", sourceFingerprintSha256: "ab".repeat(32), source };
  return { config, source, snapshot, row };
}
const adapt = (value) => adaptRewardSourceEvidence(value.snapshot, value.config);
function review(value) {
  return { snapshotId: value.snapshotId, sourceFingerprintSha256: value.sourceFingerprintSha256, approvalId: "synthetic-review",
    memberships: [{ sourceId: "athlete-c", classificationIds: ["short-adult-m"], evidenceId: "synthetic-membership-review" }],
    podiums: value.rounds[0].classificationIds.map((classificationId) => ({ classificationId, approvalId: "synthetic-podium-review", entries:
      classificationId === "short-adult-m" ? [{ sourceId: "athlete-c", rank: 1 }, { sourceId: "athlete-a", rank: 2 }]
        : classificationId === "long-f" ? [{ sourceId: "athlete-b", rank: 1 }] : [],
    })),
  };
}
const records = () => ["short", "long"].flatMap((raceId) => ["M", "F"].map((gender) => ({ id: `${raceId}-${gender}`, raceId, gender, baseline: null })));
const calculate = (prepared, extra = {}) => calculateRoundRewards({ programmeId: "programme", roundId: "round-1", budgetWei: 120000n, records: records(), ...prepared, ...extra });
const fails = (code, run) => assert.throws(run, (error) => error instanceof RewardCalculationError && error.code === code);

test("raw SQL shapes convert exactly, preserve merged clubs and missing-age league shares", () => {
  const data = fixture(); const before = structuredClone({ snapshot: data.snapshot, config: data.config }); const evidence = adapt(data);
  assert.deepEqual({ snapshot: data.snapshot, config: data.config }, before);
  assert.equal(evidence.finishes[0].distanceMetres, 5470n);
  assert.equal(evidence.finishes[0].clubPoints, 7500n);
  assert.equal(evidence.finishes[0].representedClubId, "club");
  assert.deepEqual(evidence.uncertainMemberships, [{ sourceId: "athlete-c", classificationIds: ["short-adult-m", "short-senior", "short-u16-m"] }]);
  const allocation = calculateLeagueRewards({ programmeId: "p", scopeId: "epoch", roundIds: ["round-1"], budgetWei: 40000n, finishes: evidence.finishes });
  const athlete = allocation.awards.find((award) => award.beneficiaryId === "athlete-c");
  assert.equal(athlete.calculation.weight, 5470n);
  assert.equal(athlete.calculation.totalWeight, 21770n);
  assert.equal(allocation.awards.find((award) => award.beneficiaryId === "club").calculation.weight, 3n);
  assert.deepEqual(allocation.excludedSourceIds, ["dns"]);
  assert.equal(evidence.rounds[0].latestPublicationAt, BigInt(Date.parse("2026-06-10T12:00:00Z") / 1000) + 1n);
  assert.equal(evidence.rounds[0].sourceReviewEndsAt - evidence.rounds[0].latestPublicationAt, 259200n);
});

test("Raslina-like missing starts permit reviewed podium/club rewards with record reserves intact", () => {
  const evidence = adapt(fixture()); const before = structuredClone(evidence);
  const prepared = reviewRewardRoundEvidence(evidence, "round-1", review(evidence));
  const allocation = calculate(prepared);
  assert.equal(allocation.awards.some((award) => award.beneficiaryId === "athlete-c" && award.family === "podium"), true);
  assert.equal(allocation.awards.some((award) => award.family === "club_performance"), true);
  assert.equal(allocation.explanations.filter((row) => row.family === "record").reduce((sum, row) => sum + row.unallocatedWei, 0n), 20000n);
  assert.deepEqual(allocation.excludedSourceIds, ["dns"]);
  assert.deepEqual(evidence, before);
  const baseline = { approvalId: "prior-review", publicationId: "prior-publication", establishedAtMs: 1000n,
    finishTimeMs: 2000000n, courseComparisonKey: "course:track-short:standard:1:5470" };
  const divisions = records(); divisions[0].baseline = baseline;
  fails("record_requires_verified_race_start", () => calculate(prepared, { records: divisions, raceStartsAtMs: 2000n }));
  const raceStartTimes = new Map([["short", 2000n], ["long", null]]);
  assert.equal(calculate(prepared, { records: divisions, raceStartTimes }).awards.some((award) => award.family === "record"), true);
  divisions[0].baseline.establishedAtMs = 2000n;
  fails("record_baseline_must_precede_race", () => calculate(prepared, { records: divisions, raceStartTimes }));
});

test("unknown and conflicting age evidence never becomes a silent category exclusion", () => {
  const data = fixture(); data.source.rows[0].profileBirthYear = 2012;
  const evidence = adapt(data);
  assert.equal(evidence.uncertainMemberships.length, 2);
  fails("reward_membership_review_incomplete", () => reviewRewardRoundEvidence(evidence, "round-1", review(evidence)));
  const known = fixture(); known.source.rows[0].registrationBirthYear = 2011; known.source.rows[0].profileBirthYear = 2011;
  assert.deepEqual(adapt(known).finishes[0].classificationIds, ["short-u16-m"]);
  known.source.rows[0].registrationBirthYear = 2010; known.source.rows[0].profileBirthYear = 2010;
  assert.deepEqual(adapt(known).finishes[0].classificationIds, ["short-adult-m"]);
  known.source.rows[0].registrationBirthYear = 1961; known.source.rows[0].profileBirthYear = 1961;
  assert.deepEqual(adapt(known).finishes[0].classificationIds, ["short-senior"]);
});

test("review requires all seven divisions and every selected eligible member, including slower finishers", () => {
  const evidence = adapt(fixture());
  const run = (change, code) => { const manifest = review(evidence); change(manifest); fails(code, () => reviewRewardRoundEvidence(evidence, "round-1", manifest)); };
  run((r) => { r.podiums.pop(); }, "reward_podium_review_incomplete");
  run((r) => { r.podiums.find((p) => p.classificationId === "short-adult-m").entries.pop(); }, "reward_podium_members_missing");
  run((r) => { r.memberships = []; }, "reward_membership_review_incomplete");
  run((r) => { r.memberships[0].classificationIds = ["long-f"]; }, "invalid_reviewed_reward_membership");
  run((r) => { r.memberships[0].classificationIds = ["short-adult-m", "short-u16-m"]; }, "invalid_reviewed_reward_membership");
  run((r) => { r.podiums.find((p) => p.classificationId === "short-adult-m").entries[1].rank = 3; }, "inconsistent_podium_rank_structure");
  run((r) => { r.sourceFingerprintSha256 = "cd".repeat(32); }, "stale_reward_sporting_review");
  run((r) => { r.snapshotId = "other-snapshot"; }, "stale_reward_sporting_review");
});

test("duplicate athlete-rounds require source-exact adjudication and remain in exclusion audit", () => {
  const data = fixture(); data.source.rows.push(data.row("duplicate", "long", {
    sourceAthleteId: "athlete-a", canonicalAthleteId: "athlete-a", identityPath: ["athlete-a"], registrationAthleteId: "athlete-a",
  }));
  const evidence = adapt(data); const manifest = review(evidence);
  fails("duplicate_athlete_round_requires_review", () => reviewRewardRoundEvidence(evidence, "round-1", manifest));
  manifest.adjudications = [{ roundId: "round-1", athleteId: "athlete-a", sourceIds: ["athlete-a", "duplicate"],
    selectedSourceId: "athlete-a", approvalId: "synthetic-duplicate-review" }];
  const prepared = reviewRewardRoundEvidence(evidence, "round-1", manifest);
  assert.deepEqual(calculate(prepared).excludedSourceIds, ["dns", "duplicate"]);
  manifest.adjudications[0].sourceIds = ["athlete-a"];
  fails("stale_adjudication_sources", () => reviewRewardRoundEvidence(evidence, "round-1", manifest));
});

test("mapping, classification, course, publication and registration drift fail closed", () => {
  const cases = [
    [(s) => { s.season.id = "foreign"; }, "reward_source_scope_mismatch"],
    [(s) => { s.mappings.pop(); }, "reward_source_mappings_mismatch"],
    [(s) => { s.classifications.pop(); }, "reward_source_classifications_mismatch"],
    [(s) => { s.classifications[0].eligibility.maximumAge = 16; }, "reward_classification_configuration_changed"],
    [(s) => { s.classifications[0].eligibility.minAge = 1; }, "unsupported_reward_classification_rule"],
    [(s) => { s.competitions[0].seasonId = "foreign"; }, "reward_competition_configuration_changed"],
    [(s) => { s.mappings[0].trackVersionId = "new-track"; }, "reward_course_configuration_changed"],
    [(s) => { s.mappings[0].latestPublicationId = "new-publication"; }, "reward_publication_not_ready"],
    [(s) => { s.mappings[0].run.status = "running"; }, "reward_publication_not_ready"],
    [(s) => { s.rows[0].registrationRaceId = "foreign"; }, "reward_row_provenance_mismatch"],
    [(s) => { s.rows[0].registrationAthleteId = "foreign"; }, "reward_registration_identity_mismatch"],
    [(s) => { s.rounds[0].status = "scheduled"; }, "reward_round_not_ready"],
    [(s) => { s.mappings[0].distanceMetres = "5470.1"; }, "unsupported_decimal_precision"],
    [(s) => { s.rows[0].clubPointsHundredths = 7500; }, "reward_source_integer_string_required"],
  ];
  for (const [change, code] of cases) { const data = fixture(); change(data.source); fails(code, () => adapt(data)); }
});

test("canonical paths accept verified merges, reject cycles/depth truncation and do not filter inactive owners", () => {
  const data = fixture(); Object.assign(data.source.rows[0], {
    sourceAthleteId: "old-athlete", registrationAthleteId: "old-athlete", identityPath: ["old-athlete", "athlete-a"], athleteStatus: "inactive",
  });
  assert.equal(adapt(data).finishes[0].athleteId, "athlete-a");
  for (const change of [
    { identityPath: ["old-athlete", "old-athlete", "athlete-a"] }, { unresolvedMergeId: "next-athlete" },
    { clubIdentityCycle: true }, { clubIdentityPath: ["wrong", "club"] }, { unresolvedClubMergeId: "next-club" },
  ]) { const broken = structuredClone({ snapshot: data.snapshot, config: data.config }); Object.assign(broken.snapshot.source.rows[0], change); fails("unresolved_reward_identity", () => adapt(broken)); }
});

test("appeals and pending recomputations block reviewed round construction, not private previews", () => {
  const data = fixture(); data.source.adjudicationCases = [{ id: "case-1", raceId: "short", state: "appealed", recomputeRequired: false }];
  const evidence = adapt(data);
  assert.deepEqual(evidence.rounds[0].openCaseIds, ["case-1"]);
  fails("reward_round_has_unresolved_adjudication", () => reviewRewardRoundEvidence(evidence, "round-1", review(evidence)));
  data.source.adjudicationCases[0].state = "closed"; data.source.adjudicationCases[0].recomputeRequired = true;
  assert.deepEqual(adapt(data).rounds[0].openCaseIds, ["case-1"]);
  data.source.adjudicationCases[0].recomputeRequired = false;
  assert.deepEqual(adapt(data).rounds[0].openCaseIds, []);
});

test("UTC timestamp parser preserves microseconds and rejects silent date normalization", () => {
  assert.equal(parseRewardSourceTimestamp("2026-06-10T12:00:00.123456+00:00") % 1_000_000n, 123456n);
  for (const value of ["2026-02-30T12:00:00Z", "2026-06-10", "2026-06-10T12:00:00+02:00", "2026-06-10T24:00:00Z", "2026-06-10T12:00:00.0000001Z", null]) {
    fails("invalid_reward_source_timestamp", () => parseRewardSourceTimestamp(value));
  }
});

test("publication review uses the latest relevant publication and never opens a fractional second early", () => {
  const data = fixture(); const evidence = adapt(data); const deadline = evidence.rounds[0].sourceReviewEndsAt;
  fails("reward_publication_review_not_elapsed", () => assertRewardSourceReviewElapsed(evidence, ["round-1"], deadline - 1n));
  assertRewardSourceReviewElapsed(evidence, ["round-1"], deadline);
  fails("invalid_reward_review_scope", () => assertRewardSourceReviewElapsed(evidence, ["round-1", "round-1"], deadline));
  data.source.mappings[1].publication.publishedAt = "2026-06-11T12:00:00.000001+00:00";
  fails("reward_publication_review_not_elapsed", () => assertRewardSourceReviewElapsed(adapt(data), ["round-1"], deadline));
});

test("unknown gender retains league contributions but cannot silently lose a possible record bonus", () => {
  const data = fixture(); data.source.rows[0].gender = null;
  const evidence = adapt(data);
  assert.equal(evidence.finishes[0].gender, "U");
  const manifest = review(evidence);
  manifest.memberships.push({ sourceId: "athlete-a", classificationIds: ["short-adult-m"], evidenceId: "synthetic-gender-review" });
  const prepared = reviewRewardRoundEvidence(evidence, "round-1", manifest);
  const divisions = records(); divisions[0].baseline = { approvalId: "baseline-review", publicationId: "prior", establishedAtMs: 1000n,
    finishTimeMs: 2000000n, courseComparisonKey: "course:track-short:standard:1:5470" };
  fails("record_gender_requires_review", () => calculate(prepared, { records: divisions, raceStartTimes: new Map([["short", 2000n]]) }));
  assert.equal(calculateLeagueRewards({ programmeId: "p", scopeId: "epoch", roundIds: ["round-1"], budgetWei: 40000n,
    finishes: evidence.finishes }).awards.some((award) => award.beneficiaryId === "athlete-a"), true);
});

test("source/manifest array ordering never changes sporting output", () => {
  const data = fixture(); const original = adapt(data);
  for (const property of ["rounds", "mappings", "competitions", "classifications", "rows"]) data.source[property].reverse();
  data.config.classifications.reverse(); data.config.rounds[0].races.reverse();
  assert.deepEqual(adapt(data), original);
  const first = review(original); const second = structuredClone(first); second.podiums.reverse();
  second.podiums.forEach((podium) => podium.entries.reverse());
  assert.deepEqual(calculate(reviewRewardRoundEvidence(original, "round-1", first)), calculate(reviewRewardRoundEvidence(original, "round-1", second)));
});
