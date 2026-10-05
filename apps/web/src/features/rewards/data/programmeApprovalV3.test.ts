import { beforeEach, expect, it, vi } from "vitest";
import { createDefaultRewardProgrammeDraftV2, type SavedRewardPlanningDraft } from "@raceson/domain/rewards/programme-draft-v2";
import { emptyRewardSourceMappingV2 } from "@raceson/domain/rewards/source-mapping-v2";
import { programmeApprovalV3 } from "./programmeApprovalV3";
const mock=vi.hoisted(()=>({request:vi.fn(),enabled:true,mode:"local"}));
vi.mock("@/lib/api",()=>({apiRequest:(...args:unknown[])=>mock.request(...args)}));
vi.mock("@/lib/public-env",()=>({publicEnv:{get rewardDemo(){return mock.enabled?{mode:mock.mode}:null},rewardPortalEnabled:true}}));
const id=(n:number)=>`87000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const record=():SavedRewardPlanningDraft=>({draftId:id(1),organizationId:id(2),seasonId:id(3),chainId:31337,organizationName:"Synthetic org",seasonName:"Synthetic season",
  revision:1,updatedAt:"2026-09-10T00:00:00Z",rules:createDefaultRewardProgrammeDraftV2()});
const view=()=>({schema:"raceson-programme-approval-v3",record:record(),workspace:{draftId:id(1),revision:0,rulesRevision:1,catalogueHash:"a".repeat(64),boundCatalogueHash:null,
  mapping:emptyRewardSourceMappingV2(),catalogue:{rounds:[],categories:[]}},contextHash:"c".repeat(64),approval:null,operationsEnabled:false});
const request=()=>({requestId:id(50),expectedApprovalId:null,contextHash:view().contextHash,terms:{funderAddress:`0x${"a".repeat(40)}`,operatorAddress:`0x${"b".repeat(40)}`,reviewPeriods:Array(6).fill(86400)}});
beforeEach(()=>{mock.enabled=true;mock.mode="local";mock.request.mockReset().mockResolvedValue(view())});
it("uses the authenticated no-store endpoint with exact demo programme scope",async()=>{
  expect(await programmeApprovalV3(record())).toEqual(view());
  expect(mock.request).toHaveBeenCalledWith({path:`/v1/organizer/rewards/drafts/${id(1)}/funding-approval`,cache:"no-store"});
});
it("rejects foreign revisions, chain/scope, unexpected private fields and execution permissions",async()=>{
  for(const patch of[{record:{...record(),draftId:id(9)}},{record:{...record(),revision:2}},{record:{...record(),chainId:10143}},
    {privateKey:"private"},{operationsEnabled:true}]){
    mock.request.mockResolvedValueOnce({...view(),...patch});await expect(programmeApprovalV3(record())).rejects.toThrow();
  }
});
it("captures the exact request before awaiting and refuses a mismatched save response",async()=>{
  let resolve!:(value:unknown)=>void;mock.request.mockImplementationOnce(()=>new Promise(r=>{resolve=r}));
  const body=request(),pending=programmeApprovalV3(record(),body);body.terms.reviewPeriods[0]=0;
  expect(mock.request.mock.calls[0][0].body.terms.reviewPeriods[0]).toBe(86400);
  resolve(view());await expect(pending).rejects.toThrow();
  const b=request();mock.request.mockResolvedValueOnce({...view(),workspace:{...view().workspace,revision:1,boundCatalogueHash:"a".repeat(64)},
    approval:{id:b.requestId,rulesRevision:1,mappingRevision:1,contextHash:b.contextHash,terms:b.terms,approvedAt:"2026-09-10T00:01:00Z",current:true}});
  expect((await programmeApprovalV3(record(),b)).approval?.id).toBe(b.requestId);
});
it("disabled and mismatched demo modes stop before network access",async()=>{
  mock.enabled=false;await expect(programmeApprovalV3(record())).rejects.toThrow();mock.enabled=true;mock.mode="local-testnet";
  await expect(programmeApprovalV3(record())).rejects.toThrow();expect(mock.request).not.toHaveBeenCalled();
});
