import { createSyntheticPilotV3 } from "./synthetic-pilot-v3.js";
import { decodeStoredRewardSnapshot } from "./published-preview-v2.js";

export const privyPilotIdV3 = (n: number) => {
  if (!Number.isSafeInteger(n) || n < 1 || n > 999999999999) throw new Error("invalid_privy_pilot_id");
  return `9a000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
};

/** A NEW finite synthetic cohort, not a relabelled saved compact programme.
 * No real sporting, age, recovery or wallet evidence is asserted by this data. */
export function createPrivyTestnetPilotV3(capturedAt: string) {
  const base = createSyntheticPilotV3(capturedAt);
  const pilot = JSON.parse(JSON.stringify(base).replaceAll("8a000000-0000-4000-8000-", "9a000000-0000-4000-8000-")) as typeof base;
  const id = privyPilotIdV3;
  const counts = [1, 1, 2, 2, 1, 1, 2];
  const selected = counts.flatMap((count, category) => Array.from({ length: count }, (_, n) => id(1000 + category * 30 + n)));
  // First test account is linked only to the explicit adult-category fixture,
  // not either U16 fixture. Category selection is NOT real-world age evidence.
  const firstAthleteId = id(1060);
  const athletes = [firstAthleteId, ...selected.filter(value => value !== firstAthleteId)].map((athleteId, index) => ({
    id: athleteId, name: `Test Athlete ${String(index + 1).padStart(2, "0")} · Synthetic Privy pilot`,
    clubId: id(5000 + index % 4),
  }));
  const byId = new Map(athletes.map(a => [a.id, a]));
  pilot.snapshot.sourceOrigin = "urn:raceson:synthetic:privy-10:v3";
  pilot.snapshot.results = pilot.snapshot.results.filter(row => byId.has(row.athleteId)).map(row => ({ ...row,
    athleteName: byId.get(row.athleteId)!.name, clubId: byId.get(row.athleteId)!.clubId,
    clubName: `Test Club ${Number(byId.get(row.athleteId)!.clubId.slice(-12)) - 4999} · Synthetic Privy pilot`,
  }));
  for (const round of pilot.snapshot.catalogue.rounds) {
    round.name = `Round ${round.slot} · Synthetic Privy pilot`;
    for (const race of round.races) {
      const rows = pilot.snapshot.results.filter(row => row.raceId === race.id);
      race.resultCount = rows.length;
      const finishers = rows.filter(row => row.participationStatus === "finished").sort((a, b) => a.finishTimeMs! - b.finishTimeMs! || a.id.localeCompare(b.id));
      for (const row of rows) row.rankOverall = row.participationStatus === "finished" ? finishers.indexOf(row) + 1 : null;
    }
  }
  // Recompute club points from this ten-person cohort; never retain scores
  // earned by removed athletes. Count the best three members per club/round.
  pilot.snapshot.clubs = Array.from({ length: 4 }, (_, index) => ({ clubId: id(5000 + index),
    name: `Test Club ${index + 1} · Synthetic Privy pilot`, rounds: pilot.snapshot.catalogue.rounds.map(round => {
      const points: number[] = [];
      for (const [categoryIndex, category] of pilot.snapshot.catalogue.categories.slice(0, 7).entries()) {
        const finishers = pilot.snapshot.results.filter(row => row.classificationIds.includes(category.id)
          && row.participationStatus === "finished" && round.races.some(race => race.id === row.raceId))
          .sort((a, b) => a.finishTimeMs! - b.finishTimeMs! || a.id.localeCompare(b.id));
        finishers.forEach((row, rank) => { if (row.clubId === id(5000 + index)) points.push(categoryIndex < 5 ? 100 - 3 * rank : 150 - 4 * rank); });
      }
      return { slot: round.slot, sourceRoundId: round.id, points: points.sort((a, b) => b - a).slice(0, 3).reduce((a, b) => a + b, 0) };
    }) }));
  const snapshot = decodeStoredRewardSnapshot(pilot.snapshot);
  if (snapshot.version !== 3 || snapshot.sourceOrigin !== "urn:raceson:synthetic:privy-10:v3") throw new Error("invalid_privy_pilot_source");
  return { ...pilot, snapshot, chainId: 10143 as const, athletes, firstAthleteId };
}
