import { beforeEach, expect, it, vi } from "vitest";
import { createDefaultRewardProgrammeDraftV2, type SavedRewardPlanningDraft } from "@raceson/domain/rewards/programme-draft-v2";
import { emptyProgrammeFundingV3 } from "@raceson/domain/rewards/programme-funding-v3";
import { readProgrammeFundingV3 } from "./programmeFundingV3";
const mock=vi.hoisted(()=>({request:vi.fn(),enabled:true,mode:"local"}));
vi.mock("@/lib/api",()=>({apiRequest:(...args:unknown[])=>mock.request(...args)}));
vi.mock("@/lib/public-env",()=>({publicEnv:{get rewardDemo(){return mock.enabled?{mode:mock.mode}:null},rewardPortalEnabled:true}}));
const id=(n:number)=>`86000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const record=():SavedRewardPlanningDraft=>({draftId:id(5),organizationId:id(2),seasonId:id(4),chainId:31337,organizationName:"Synthetic organization",
  seasonName:"Synthetic league",revision:1,updatedAt:"2026-09-09T12:00:00Z",rules:createDefaultRewardProgrammeDraftV2()});
beforeEach(()=>{mock.enabled=true;mock.mode="local";mock.request.mockReset().mockResolvedValue(emptyProgrammeFundingV3(record()))});
it("reads authenticated no-store funding bound to exact rules and scope without fabricating zero",async()=>{
  expect(await readProgrammeFundingV3(record())).toEqual(emptyProgrammeFundingV3(record()));
  expect(mock.request).toHaveBeenCalledWith({path:`/v1/organizer/rewards/drafts/${id(5)}/funding`,cache:"no-store"});
});
it("rejects wrong scope, revision, budget, private data, operations or unverified balances",async()=>{
  for(const patch of[{draftId:id(6)},{rulesRevision:2},{chainId:10143},{budgetWei:"1"},{rpcUrl:"private"},{operationsEnabled:true},
    {observation:{depositedWei:"0"}},{status:"verified"}]){
    mock.request.mockResolvedValueOnce({...emptyProgrammeFundingV3(record()),...patch});await expect(readProgrammeFundingV3(record())).rejects.toThrow();
  }
});
it("disabled or different-chain demo fails before network access",async()=>{
  mock.enabled=false;await expect(readProgrammeFundingV3(record())).rejects.toThrow();
  mock.enabled=true;mock.mode="testnet";await expect(readProgrammeFundingV3(record())).rejects.toThrow();expect(mock.request).not.toHaveBeenCalled();
});
