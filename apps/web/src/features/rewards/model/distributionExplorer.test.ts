import {expect,it} from "vitest";
import {createDefaultRewardProgrammeDraftV2} from "@raceson/domain/rewards/programme-draft-v2";
import {draftDistributionGraph,visibleDistributionBranches} from "./distributionExplorer";
it("conserves every saved budget at each branch, including zero-share pots",()=>{
 const draft={...createDefaultRewardProgrammeDraftV2(),leagueShareBps:10000,roundSharesBps:[0,0,0,0,0]};
 const graph=draftDistributionGraph(draft,false);
 for(const node of graph.nodes){if(node.children.length)expect(node.children.reduce((n,id)=>n+graph.byId.get(id)!.amountWei,0n)).toBe(node.amountWei);}
 expect(graph.byId.get("pot:round-1")?.amountWei).toBe(0n);
 expect(visibleDistributionBranches(graph,"pot:round-1").map(n=>n.id)).toEqual(["pot:round-1","pot:round-1:athlete_standings","pot:round-1:club_standings"]);
 expect(graph.nodes.some(n=>n.label.includes("Šubićevac"))).toBe(false);
});
