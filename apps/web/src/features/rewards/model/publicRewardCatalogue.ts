import { rewardProgrammeRounds } from "./programmeOverview";
/** Announced budgets only. No private allocation endpoint is used as a public feed. */
export const publicRewardProgramme = {
  id: "sibenik-2026", name: "Šibenik Trail League", season: "2026", budget: 100000,
  status: "planned" as const,
};
export const publicRewardPots = [
  { id: "league", name: "League", nameHr: "Liga", budget: 50000, kind: "league" as const, round: null },
  ...rewardProgrammeRounds.map(r => ({ id:r.id, name:r.name, nameHr:r.name, budget:10000, kind:"race" as const, round:r.number })),
];
