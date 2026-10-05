import { beforeEach, expect, it, vi } from "vitest";
import { resultReviewV3 } from "./resultReviewV3";
const mock=vi.hoisted(()=>({request:vi.fn(),enabled:true}));
vi.mock("@/lib/api",()=>({apiRequest:(...args:unknown[])=>mock.request(...args)}));
vi.mock("@/lib/public-env",()=>({publicEnv:{get rewardDemo(){return mock.enabled?{mode:"local"}:null},rewardPortalEnabled:true}}));
const id=(n:number)=>`85000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const record=()=>({schema:"raceson-result-review-v3",categoryId:id(1),organizationId:id(2),observedAt:"2026-09-09T12:00:00Z",
  state:"unconfigured",revision:0,reviewSeconds:null,policyId:null,configuredAt:null,locked:false,held:false,
  startedAt:null,startedByPublicationId:null,endsAt:null,latestPublicationId:null,finalPublicationId:null,officialPublishedAt:null,allocationApproved:false});
beforeEach(()=>{mock.enabled=true;mock.request.mockReset().mockResolvedValue(record())});
it("uses the shared authenticated no-store API and binds category and organization",async()=>{
  expect(await resultReviewV3(id(1),id(2))).toEqual(record());
  expect(mock.request).toHaveBeenCalledWith({path:`/v1/organizer/rewards/result-review/${id(1)}`,cache:"no-store"});
  for(const patch of[{categoryId:id(3)},{organizationId:id(3)},{allocationApproved:true},{privateEvidence:"secret"}]){
    mock.request.mockResolvedValueOnce({...record(),...patch});await expect(resultReviewV3(id(1),id(2))).rejects.toThrow();
  }
});
it("disabled demo fails before network access",async()=>{
  mock.enabled=false;await expect(resultReviewV3(id(1),id(2))).rejects.toThrow();expect(mock.request).not.toHaveBeenCalled();
});
