// Synthetic SQL-shaped private evidence only. No real runner, sporting approval,
// testnet account, wallet, key or source signature is claimed by these fixtures.
export const rewardId = (n) => `78000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const rewardWire = (value) => JSON.parse(JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item));
export function calculationFixture(pot = "race", roundNumber = 1, budget = 100000000000000000001n) {
  const id = rewardId;
  const classificationRules = [
    [0, "F", null, "1599"], [0, "M", null, "1599"], [0, "F", "1600", "6499"],
    [0, "M", "1600", "6499"], [0, null, "6500", null], [1, "F", "100", null], [1, "M", "100", null],
  ];
  const configuration = { organizationId: id(1), leagueId: id(2), seasonId: id(3), year: 2026,
    competitions: [0, 1].map((n) => ({ id: id(20 + n), scoringTarget: "individual", resultBasis: "elapsed_time" })),
    classifications: classificationRules.map(([n, gender, minimumAgeHundredths, maximumAgeHundredths], index) => ({
      id: id(30 + index), competitionId: id(20 + n), gender, minimumAgeHundredths, maximumAgeHundredths,
    })),
    rounds: [1, 2, 3, 4, 5].map((number) => ({ id: id(100 + number), number, eventEditionId: id(200 + number),
      races: [0, 1].map((n) => ({ id: id(300 + number * 2 + n), mappingId: id(400 + number * 2 + n), competitionId: id(20 + n),
        distanceMetres: n ? "15000" : "5000", trackVersionId: id(500 + number * 2 + n), courseFormat: "standard", lapCount: 1 })) })),
  };
  const rounds = configuration.rounds.filter((round) => pot === "league" || round.number === roundNumber);
  const rows = rounds.flatMap((round) => [0, 1, 2, 3, 4, 5, 6].map((n) => {
    const race = round.races[n === 5 ? 1 : 0]; const athlete = id(1000 + n); const club = n <= 4 ? id(2000) : null;
    return { id: id(3000 + round.number * 10 + n), mappingId: race.mappingId, roundId: round.id, raceId: race.id,
      publicationId: id(600 + round.number * 2 + (n === 5 ? 1 : 0)), resultRunId: id(700 + round.number * 2 + (n === 5 ? 1 : 0)),
      registrationId: id(4000 + round.number * 10 + n), sourceAthleteId: athlete, canonicalAthleteId: athlete,
      identityPath: [athlete], identityCycle: false, unresolvedMergeId: null, athleteStatus: "active", gender: n === 4 ? "F" : "M",
      registrationAthleteId: athlete, registrationRaceId: race.id, registrationStatus: "confirmed",
      participationStatus: n === 6 ? "dns" : "finished", registrationBirthYear: n === 4 ? null : 1990,
      profileBirthYear: n === 4 ? null : 1990, profileDateBirthYear: null,
      representedClubId: club, canonicalClubId: club, clubIdentityPath: club ? [club] : null,
      clubIdentityCycle: false, unresolvedClubMergeId: null, resultStatus: "official",
      finishTimeMs: n === 6 ? null : String(1000000 + n * 100000), rankOverall: n === 6 ? null : n + 1,
      rankGender: null, rankAgeCategory: null, clubPointsHundredths: n === 6 ? null : String(10000 - n * 100),
    };
  }));
  const source = { schemaVersion: 1,
    season: { id: id(3), leagueId: id(2), organizationId: id(1), year: 2026, status: "active", leagueStatus: "active", organizerRules: {} },
    competitions: configuration.competitions.map((row) => ({ ...row, seasonId: id(3), status: "active" })),
    classifications: configuration.classifications.map((row) => ({ id: row.id, competitionId: row.competitionId,
      name: "Synthetic division", status: "active", eligibility: {
        ...(row.gender === null ? {} : { gender: row.gender }),
        ...(row.minimumAgeHundredths === null ? {} : { minimumAge: Number(row.minimumAgeHundredths) / 100 }),
        ...(row.maximumAgeHundredths === null ? {} : { maximumAge: Number(row.maximumAgeHundredths) / 100 }),
      } })),
    rounds: rounds.map((round) => ({ id: round.id, number: round.number, eventEditionId: round.eventEditionId,
      status: "completed", eventStatus: "completed", isPractice: false, organizerDeletedAt: null, startDate: "2026-06-01", timezone: "Europe/Zagreb" })),
    mappings: rounds.flatMap((round) => round.races.map((race, n) => ({ id: race.mappingId, roundId: round.id, raceId: race.id,
      competitionId: race.competitionId, status: "mapped", sourceVersionId: null, raceEditionId: round.eventEditionId,
      raceStatus: "completed", resultsMode: "standard", organizerDeletedAt: null, distanceMetres: race.distanceMetres,
      startAt: null, courseFormat: "standard", lapCount: 1, trackSnapshotId: id(800 + round.number * 2 + n),
      trackVersionId: race.trackVersionId, trackTemplateId: id(900 + round.number * 2 + n), trackMetres: race.distanceMetres,
      publicationId: id(600 + round.number * 2 + n), latestPublicationId: id(600 + round.number * 2 + n),
      publication: { id: id(600 + round.number * 2 + n), raceId: race.id, runId: id(700 + round.number * 2 + n), state: "official",
        publishedAt: "2026-06-01T12:00:00.000001+00:00", createdAt: "2026-06-01T12:00:00Z", supersedesId: null,
        manifestDigest: null, signatureState: "legacy_unsigned", signedDigest: null },
      run: { id: id(700 + round.number * 2 + n), raceId: race.id, status: "succeeded", completedAt: "2026-06-01T11:00:00Z" },
    }))), adjudicationCases: [], rows,
  };
  const review = { schemaVersion: 1, adjudications: [], roundReviews: pot === "league" ? [] : rounds.map((round) => ({
    roundId: round.id, memberships: [{ sourceId: id(3000 + round.number * 10 + 4), classificationIds: [id(32)], evidenceId: "synthetic-membership" }],
    podiums: configuration.classifications.map((rule, index) => ({ classificationId: rule.id, approvalId: `synthetic-podium-${index}`,
      entries: (index === 3 ? [0, 1, 2, 3] : index === 2 ? [4] : index === 6 ? [5] : [])
        .map((n, index) => ({ sourceId: id(3000 + round.number * 10 + n), rank: index + 1 })) })),
    records: round.races.flatMap((race) => ["M", "F"].map((gender) => ({ id: `${race.id}:${gender}`, raceId: race.id, gender, baseline: null }))),
  })) };
  const raceBudget = budget * 3n / 5n; const perRound = raceBudget / 5n + (BigInt(roundNumber) <= raceBudget % 5n ? 1n : 0n);
  const campaignId = id(pot === "race" ? 40 + roundNumber : 46); const snapshotId = id(pot === "race" ? 70 + roundNumber : 76);
  const reviewId = id(pot === "race" ? 80 + roundNumber : 86); const actorId = id(4);
  const context = { schemaVersion: 1,
    programme: { id: id(10), organizationId: id(1), seasonId: id(3), operatorUserId: actorId,
      environment: "local_simulation", chainId: 31337, budgetWei: String(budget), configuration },
    campaign: { id: campaignId, pot, scopeKey: pot === "race" ? id(100 + roundNumber) : "rounds-1-5",
      roundIds: rounds.map((round) => round.id).sort(), budgetWei: String(pot === "race" ? perRound : budget - raceBudget) },
    snapshot: { snapshotId, capturedAt: "2026-06-01T13:00:00+00:00", sourceFingerprintSha256: "ab".repeat(32), source },
    review: { id: reviewId, revision: 1, reviewedAt: "2026-06-01T14:00:00+00:00", reviewedByUserId: actorId, body: review },
  };
  return { context, review, configuration, source, actorId, campaignId, snapshotId, reviewId,
    session: { accessToken: "synthetic-session-not-a-real-token", account: { userId: actorId } } };
}
