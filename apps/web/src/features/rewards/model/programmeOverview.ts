import { createDefaultRewardProgrammeDraftV2, previewRewardProgrammeDraftV2, type RewardProgrammeDraftV2 } from "@raceson/domain/rewards/programme-draft-v2";
import type { TranslationKey } from "@/shared/i18n/messages";

/** Navigation slugs only, never verified event or beneficiary IDs. */
export const rewardProgrammeRounds = [
  { id: "vrpolje", name: "Vrpolje", number: 1 },
  { id: "torak", name: "Torak", number: 2 },
  { id: "trtarski-krug", name: "Trtarski Krug", number: 3 },
  { id: "raslina", name: "Raslina", number: 4 },
  { id: "subicevac", name: "Šubićevac Trail", number: 5 },
] as const;
export type ProgrammeNode = {
  id: string; parentId: string | null; name?: string;
  labelKey: TranslationKey; ruleKey: TranslationKey; evidenceKey: TranslationKey;
  kind: "programme" | "pot" | "round" | "family";
  pot: "race" | "league" | null; roundNumber: number | null;
  amountWei: bigint; children: string[]; rankWeights?: readonly number[];
};
const familyKeys = {
  athlete_standings: "athleteStandings", club_standings: "clubStandings", participation_metres: "participation",
} as const;

/** Both layouts use the v2 domain preview. No invented funding, results or identities. */
export function buildProgrammeOverview(draft: RewardProgrammeDraftV2 = createDefaultRewardProgrammeDraftV2()) {
  const preview = previewRewardProgrammeDraftV2(draft);
  const nodes: ProgrammeNode[] = [];
  nodes.push({ id: "programme", parentId: null, labelKey: "rewards.programme.pot",
    ruleKey: "rewards.planner.rule.programme", evidenceKey: "rewards.programme.evidence.programme",
    kind: "programme", pot: null, roundNumber: null, amountWei: preview.budgetWei, children: ["race", "league"] });
  nodes.push({ id: "race", parentId: "programme", labelKey: "rewards.programme.racePot",
    ruleKey: "rewards.planner.rule.race", evidenceKey: "rewards.planner.evidence.round",
    kind: "pot", pot: "race", roundNumber: null, amountWei: preview.raceBudgetWei, children: rewardProgrammeRounds.map(r => r.id) });
  nodes.push({ id: "league", parentId: "programme", labelKey: "rewards.programme.leaguePot",
    ruleKey: "rewards.planner.rule.league", evidenceKey: "rewards.planner.evidence.league",
    kind: "pot", pot: "league", roundNumber: null, amountWei: preview.leagueBudgetWei,
    children: preview.leagueFamilies.map(f => "league:" + f.key) });
  const addFamily = (parentId: string, pot: "race" | "league", roundNumber: number | null,
    family: { key: string; amount: bigint }) => {
    const key = familyKeys[family.key as keyof typeof familyKeys];
    nodes.push({ id: parentId + ":" + family.key, parentId, labelKey: ("rewards.planner." + key) as TranslationKey,
      ruleKey: ("rewards.planner.rule." + key) as TranslationKey,
      evidenceKey: pot === "league" ? "rewards.planner.evidence.league" : "rewards.planner.evidence.round",
      kind: "family", pot, roundNumber, amountWei: family.amount, children: [],
      rankWeights: family.key === "participation_metres" ? undefined : pot === "race" ? draft.raceRankWeights : draft.leagueRankWeights });
  };
  for (const round of rewardProgrammeRounds) {
    const allocation = preview.rounds[round.number - 1]!;
    nodes.push({ id: round.id, parentId: "race", name: round.name, labelKey: "rewards.programme.round",
      ruleKey: "rewards.planner.rule.round", evidenceKey: round.number === 5 ? "rewards.planner.evidence.replacement" : "rewards.planner.evidence.round",
      kind: "round", pot: "race", roundNumber: round.number, amountWei: allocation.amountWei,
      children: allocation.families.map(f => round.id + ":" + f.key) });
    for (const family of allocation.families) addFamily(round.id, "race", round.number, family);
  }
  for (const family of preview.leagueFamilies) addFamily("league", "league", null, family);
  return { source: "draft_preview" as const, budgetWei: preview.budgetWei, nodes,
    byId: new Map(nodes.map(n => [n.id, n])), observedFundingWei: null, observedPaidWei: null,
    contractAddresses: [], awards: [], roundFiveEventId: null, roundFiveDate: "2026-10-03",
    reviewSeconds: preview.reviewSeconds };
}
export type ProgrammeOverview = ReturnType<typeof buildProgrammeOverview>;
export function programmeSelection(search: URLSearchParams, model: ProgrammeOverview) {
  const values = search.getAll("node");
  return values.length === 1 && model.byId.has(values[0]) ? values[0] : "programme";
}
export function programmePresentation(search: URLSearchParams): "standalone" | "portal" {
  return search.getAll("view").length === 1 && search.get("view") === "portal" ? "portal" : "standalone";
}
export function programmePath(id: string, model: ProgrammeOverview): ProgrammeNode[] {
  const path: ProgrammeNode[] = [];
  let next = model.byId.get(id);
  while (next) { path.unshift(next); next = next.parentId ? model.byId.get(next.parentId) : undefined; }
  return path;
}
