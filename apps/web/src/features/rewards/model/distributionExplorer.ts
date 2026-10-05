import type { PublicRewardProgramme, PublicRewardPot } from "@raceson/domain/rewards/public-report";
import type { RewardProgrammeDraftV2 } from "@raceson/domain/rewards/programme-draft-v2";
import { previewRewardProgrammeDraftV2 } from "@raceson/domain/rewards/programme-draft-v2";

export type DistributionBranch = {
  id: string; parentId: string | null; label: string; amountWei: bigint;
  tone: "league" | "race" | "total"; children: string[]; potIds: string[]; pool?: boolean; poolKey?: string;
};
export type DistributionGraph = { rootId: string; nodes: DistributionBranch[]; byId: Map<string, DistributionBranch> };
const familyLabel = (key: string, hr: boolean) => ({ athlete_standings: hr ? "Plasman sportaša" : "Athlete standings",
  club_standings: hr ? "Plasman klubova" : "Club standings", participation: hr ? "Prijeđena udaljenost" : "Distance participation",
  participation_metres: hr ? "Prijeđena udaljenost" : "Distance participation" })[key] ?? key;

/** Public pools are budgets, never inferred recipient awards. */
export function reportDistributionGraph(programme: PublicRewardProgramme, hr: boolean, potId?: string): DistributionGraph {
  const pots = potId ? programme.pots.filter(p => p.id === potId) : programme.pots;
  const nodes: DistributionBranch[] = [];
  const add = (id: string, parentId: string | null, label: string, amountWei: bigint, tone: DistributionBranch["tone"], selected: PublicRewardPot[], pool = false) => {
    nodes.push({ id, parentId, label, amountWei, tone, children: [], potIds: selected.map(p => p.id), pool });
    nodes.find(n => n.id === parentId)?.children.push(id);
  };
  const rootId = potId ? `pot:${potId}` : "programme";
  if (!potId) {
    add(rootId, null, hr ? "Cijeli program" : "Whole programme", pots.reduce((n,p) => n + BigInt(p.budgetWei), 0n), "total", pots);
    const rounds = pots.filter(p => p.slot !== 6);
    if (rounds.length) add("rounds", rootId, hr ? "Kola" : "Rounds", rounds.reduce((n,p) => n + BigInt(p.budgetWei), 0n), "race", rounds);
  }
  for (const p of [...pots].sort((a,b) => (b.slot === 6 ? 1 : 0) - (a.slot === 6 ? 1 : 0))) {
    const id = `pot:${p.id}`, tone = p.slot === 6 ? "league" : "race";
    add(id, potId ? null : p.slot === 6 ? rootId : "rounds", p.name, BigInt(p.budgetWei), tone, [p]);
    for (const pool of p.pools) {
      add(`${id}:${pool.key}`, id, familyLabel(pool.key, hr), BigInt(pool.budgetWei), tone, [p], true);
      nodes[nodes.length-1].poolKey=pool.key;
    }
  }
  // Keep programme → league / rounds ordering consistent with the calculator.
  if (!potId) nodes[0].children.sort((a,b) => Number(a === "rounds") - Number(b === "rounds"));
  return { rootId, nodes, byId: new Map(nodes.map(n => [n.id,n])) };
}
export function draftDistributionGraph(draft: RewardProgrammeDraftV2, hr: boolean): DistributionGraph {
  const preview = previewRewardProgrammeDraftV2(draft);
  const programme: PublicRewardProgramme = { id: "preview", name: "", host: "", chainId:10143, source:"synthetic", status:"distributing", pots: [
    ...preview.rounds.map(r => ({ id: `round-${r.slot}`, slot:r.slot, name:`${hr ? "Kolo" : "Round"} ${r.slot}`, budgetWei:String(r.amountWei), approvedAt:"", rows:[], pools:r.families.map(f => ({key:f.key,budgetWei:String(f.amount)})) })),
    { id:"league",slot:6,name:hr?"Liga":"League pot",budgetWei:String(preview.leagueBudgetWei),approvedAt:"",rows:[],pools:preview.leagueFamilies.map(f=>({key:f.key,budgetWei:String(f.amount)})) },
  ] };
  return reportDistributionGraph(programme,hr);
}
export function distributionPath(graph: DistributionGraph, id: string) {
  const path: DistributionBranch[] = []; let node = graph.byId.get(id);
  while(node) { path.unshift(node); node=node.parentId?graph.byId.get(node.parentId):undefined; }
  return path;
}
export function visibleDistributionBranches(graph: DistributionGraph, selected: string) {
  const node = graph.byId.get(selected) ?? graph.byId.get(graph.rootId)!;
  const focus = node.children.length ? node : graph.byId.get(node.parentId ?? graph.rootId)!;
  return [focus,...focus.children.flatMap(id => {const child=graph.byId.get(id)!;return [child,...child.children.map(key=>graph.byId.get(key)!)];})];
}
