import { createRewardAllocationRehearsalV3 } from "./allocation-rehearsal-v3.js";
import { decodeStoredRewardSnapshot, type SyntheticRewardSnapshotV3 } from "./published-preview-v2.js";

export const syntheticPilotIdV3 = (n: number) => {
  if (!Number.isSafeInteger(n) || n < 1 || n > 999999999999) throw new Error("invalid_synthetic_pilot_id");
  return `8a000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
};

/** Reuses the exact compact calculation cohort, not a second set of athletes.
 * Source publication times are simulated at capture, never historical complaint
 * clocks. The seed must not insert review/approval/claim/identity records. */
export function createSyntheticPilotV3(capturedAt: string) {
  if (!Number.isFinite(Date.parse(capturedAt)) || new Date(capturedAt).toISOString() !== capturedAt)
    throw new Error("invalid_synthetic_pilot_time");
  const id = syntheticPilotIdV3, fixture = createRewardAllocationRehearsalV3("four_rounds", "compact_20");
  const { source, rules, mapping, scoringTables } = fixture;
  const athletes = [...new Set(source.rounds.flatMap(round => round.results.map(row => row.athleteId)))].sort();
  const clubs = [...new Set(source.rounds.flatMap(round => round.results.map(row => row.clubId!)))].sort();
  const athleteName = (athleteId: string) => `Test Athlete ${String(athletes.indexOf(athleteId) + 1).padStart(2, "0")} · Synthetic`;
  const clubName = (clubId: string) => `Test Club ${clubs.indexOf(clubId) + 1} · Synthetic`;
  const names = ["Female U16", "Male U16", "Female", "Male", "Senior 65+", "Female", "Male", "Clubs"];
  const categories = source.categories.map((category, c) => ({ ...category, competitionId: id(c < 5 ? 60 : c < 7 ? 61 : 62),
    competitionName: `${c < 5 ? "Short" : c < 7 ? "Long" : "Clubs"} · Synthetic`, name: names[c]!, eligibility: { demoOnly: true } }));
  const results: SyntheticRewardSnapshotV3["results"] = [];
  const rounds = source.rounds.slice(0, 4).map(round => {
    const races = [0, 1].map(course => {
      const competitionId = id(60 + course), raceId = id(300 + round.slot * 2 + course);
      const publicationId = id(400 + round.slot * 2 + course);
      const rows = round.results.filter(row => categories.find(category => category.id === row.categoryId)!.competitionId === competitionId);
      const ranked = rows.filter(row => row.status === "finished").map(row => {
        const table = source.standings.find(table => table.slot === round.slot && table.categoryId === row.categoryId)!;
        const rank = table.rows.find(standing => standing.beneficiaryId === row.athleteId)!.rank;
        return { id: row.id, time: rank * 60000 + categories.findIndex(category => category.id === row.categoryId) * 1000 };
      }).sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
      results.push(...rows.map(row => {
        const place = ranked.findIndex(entry => entry.id === row.id);
        return { id: row.id, publicationId, publicationState: "official" as const, publishedAt: capturedAt, runId: id(500 + round.slot),
          athleteId: row.athleteId, athleteName: athleteName(row.athleteId), raceId, classificationIds: [row.categoryId!],
          participationStatus: row.status, finishTimeMs: place < 0 ? null : ranked[place]!.time, rankOverall: place < 0 ? null : place + 1,
          clubId: row.clubId, clubName: clubName(row.clubId!) };
      }));
      return { id: raceId, competitionId, name: `${course ? "Long" : "Short"} · Synthetic`, distanceMetres: course ? "10000" : "5000",
        publicationId, publicationState: "official", resultCount: rows.length };
    });
    return { id: round.roundId!, editionId: id(200 + round.slot), slot: round.slot, name: `Round ${round.slot} · Synthetic pilot`,
      date: capturedAt.slice(0, 10), status: "completed", races };
  });
  const snapshot = decodeStoredRewardSnapshot({ version: 3, sourceOrigin: "urn:raceson:synthetic:compact-20:v3",
    sourceLeagueId: source.sourceLeagueId, sourceSeasonId: source.sourceSeasonId, capturedAt,
    catalogue: { categories, rounds }, results,
    clubs: clubs.map(clubId => ({ clubId, name: clubName(clubId), rounds: rounds.map(round => ({ slot: round.slot, sourceRoundId: round.id,
      points: scoringTables.find(table => table.slot === round.slot && table.categoryId === id(8))!.rows.find(row => row.beneficiaryId === clubId)!.points })) })) });
  if (snapshot.version !== 3) throw new Error("invalid_synthetic_pilot_source");
  return { draftId: id(52), rules, mapping, snapshot, finale: { seriesId: id(53), editionId: id(54), shortRaceId: id(55), longRaceId: id(56) } };
}
