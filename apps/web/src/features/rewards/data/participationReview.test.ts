import {beforeEach,expect,it,vi} from "vitest";
import {createDefaultRewardProgrammeDraftV2} from "@raceson/domain/rewards/programme-draft-v2";
import {decodeStoredRewardSnapshot} from "@raceson/domain/rewards/published-preview-v2";
import {decodeRewardSourceMappingV2} from "@raceson/domain/rewards/source-mapping-v2";
import {deriveLeagueParticipationMetrics} from "@raceson/domain/rewards/league-participation-metrics";
import {publishedSnapshot,publishedMapping,id} from "../../../../../../apps/api/test/fixtures/published-reward-v2.mjs";
import {requestParticipationReview} from "./participationReview";
import type {SetupEventSelection} from "../components/RewardSetupEvent";
const request=vi.hoisted(()=>vi.fn());
vi.mock("@/lib/api",()=>({apiRequest:request}));
vi.mock("@/lib/public-env",()=>({publicEnv:{rewardDemo:true,rewardPortalEnabled:true}}));
function fixture() {
  const snapshot=decodeStoredRewardSnapshot(publishedSnapshot()),sourceHash="b".repeat(64);
  const selection:SetupEventSelection={record:{draftId:id(30),organizationId:id(31),seasonId:id(32),chainId:31337,organizationName:"Synthetic",seasonName:"Synthetic",revision:1,updatedAt:"2026-09-09T12:00:00Z",rules:createDefaultRewardProgrammeDraftV2()},
    workspace:{draftId:id(30),revision:1,rulesRevision:1,catalogueHash:"a".repeat(64),boundCatalogueHash:"a".repeat(64),mapping:decodeRewardSourceMappingV2(publishedMapping()),catalogue:snapshot.catalogue}};
  return {selection,sourceHash,raw:{...structuredClone(selection),snapshot,sourceHash,metrics:deriveLeagueParticipationMetrics(snapshot,sourceHash),review:null,history:[],recordedReview:null}};
}
beforeEach(()=>request.mockReset());
it("loads source-bound review privately and refuses changed totals or planning selection",async()=>{
  const f=fixture();request.mockResolvedValue(f.raw);
  expect((await requestParticipationReview(f.selection,f.sourceHash)).review).toBeNull();
  expect(request).toHaveBeenCalledWith({path:`/v1/organizer/rewards/drafts/${id(30)}/participation-review`,cache:"no-store"});
  f.raw.metrics.summary.rawFinishes++;await expect(requestParticipationReview(f.selection,f.sourceHash)).rejects.toThrow();
  const g=fixture();g.raw.record.revision++;request.mockResolvedValue(g.raw);await expect(requestParticipationReview(g.selection,g.sourceHash)).rejects.toThrow();
});
it("does not accept a different source hash or unrelated write acknowledgement",async()=>{
  const f=fixture();request.mockResolvedValue(f.raw);await expect(requestParticipationReview(f.selection,"c".repeat(64))).rejects.toThrow();
  const change={requestId:id(50),expectedReviewId:null,review:{version:1 as const,sourceHash:f.sourceHash,duplicates:[],confirmedUnaffiliatedResultIds:[]},reason:"Initial review"};
  await expect(requestParticipationReview(f.selection,f.sourceHash,change)).rejects.toThrow();
  const r={id:id(50),previousReviewId:null,revision:1,review:change.review,reason:change.reason,reviewedAt:"2026-09-21T12:00:00Z",reviewedByUserId:id(40),current:true};
  request.mockResolvedValue({...f.raw,review:r,history:[r],recordedReview:r});
  expect((await requestParticipationReview(f.selection,f.sourceHash,change)).recordedReview?.id).toBe(change.requestId);
});

it("recovers an exact saved acknowledgment after programme changes while fresh reads require the new selection",async()=>{
  const f=fixture(),change={requestId:id(50),expectedReviewId:null,review:{version:1 as const,sourceHash:f.sourceHash,duplicates:[],confirmedUnaffiliatedResultIds:[]},reason:"Reviewed"};
  const r={id:id(50),previousReviewId:null,revision:1,review:change.review,reason:change.reason,reviewedAt:"2026-09-21T12:00:00Z",reviewedByUserId:id(40),current:true};
  f.raw.record.revision++;f.raw.workspace.rulesRevision++;
  request.mockResolvedValue({...f.raw,review:r,history:[r],recordedReview:r});
  expect((await requestParticipationReview(f.selection,f.sourceHash,change)).recordedReview?.id).toBe(change.requestId);
  request.mockResolvedValue({...f.raw,review:r,history:[r]});await expect(requestParticipationReview(f.selection,f.sourceHash)).rejects.toThrow();
});
