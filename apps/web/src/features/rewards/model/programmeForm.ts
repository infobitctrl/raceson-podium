import { decodeRewardProgrammeDraftV2, type RewardProgrammeDraftV2 } from "@raceson/domain/rewards/programme-draft-v2";

export type ProgrammeForm = {
  budgetMon: string; league: string; rounds: string[]; raceFamilies: string[];
  leagueFamilies: string[]; raceWeights: string[]; leagueWeights: string[];
};
export function programmeForm(draft: RewardProgrammeDraftV2): ProgrammeForm {
  return { budgetMon: draft.budgetMon, league: String(draft.leagueShareBps / 100),
    rounds: draft.roundSharesBps.map(n => String(n / 100)),
    raceFamilies: [draft.raceFamilySharesBps.athleteStandings, draft.raceFamilySharesBps.clubStandings].map(n => String(n / 100)),
    leagueFamilies: [draft.leagueFamilySharesBps.athleteStandings, draft.leagueFamilySharesBps.clubStandings, draft.leagueFamilySharesBps.participationMetres].map(n => String(n / 100)),
    raceWeights: draft.raceRankWeights.map(String), leagueWeights: draft.leagueRankWeights.map(String) };
}
function percent(value: string): number {
  if (typeof value !== "string" || !/^(0|[1-9]\d{0,2})(\.\d{1,2})?$/.test(value)) throw new Error("invalid_preview_percentage");
  const [whole, fraction = ""] = value.split(".");
  const bps = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (bps > 10_000) throw new Error("invalid_preview_percentage");
  return bps;
}
function weight(value: string): number {
  if (typeof value !== "string" || !/^[1-9]\d{0,6}$/.test(value)) throw new Error("invalid_preview_weight");
  return Number(value);
}
export function draftFromProgrammeForm(form: ProgrammeForm): RewardProgrammeDraftV2 {
  return decodeRewardProgrammeDraftV2({
    version: 2, network: "monad-testnet", reviewSeconds: 86_400, budgetMon: form.budgetMon,
    leagueShareBps: percent(form.league), roundSharesBps: form.rounds.map(percent),
    raceFamilySharesBps: { athleteStandings: percent(form.raceFamilies[0]), clubStandings: percent(form.raceFamilies[1]) },
    leagueFamilySharesBps: { athleteStandings: percent(form.leagueFamilies[0]), clubStandings: percent(form.leagueFamilies[1]), participationMetres: percent(form.leagueFamilies[2]) },
    raceRankWeights: form.raceWeights.map(weight), leagueRankWeights: form.leagueWeights.map(weight),
  });
}
