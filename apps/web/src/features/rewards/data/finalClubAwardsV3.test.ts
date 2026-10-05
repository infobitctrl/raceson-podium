import {beforeEach,expect,it,vi} from "vitest";
import {getFinalClubAwardsV3} from "./finalClubAwardsV3";
import {clubReviewTestId as id,clubReviewTestAddress as address} from "./organizerClubReviewV3.fixture";
const m=vi.hoisted(()=>({api:vi.fn(),env:{rewardPortalEnabled:true,rewardDemo:{mode:"local-testnet"} as {mode:string}|null}}));
vi.mock("@/lib/api",()=>({apiRequest:m.api}));vi.mock("@/lib/public-env",()=>({publicEnv:m.env}));
const record={draftId:id(1),chainId:10143 as const};
function data(slot:5|6=5){const common={...record,slot,contextHash:"a".repeat(64),documentHash:"b".repeat(64),stageReady:false,payableWei:"0"};
  return {approval:{schema:"raceson-final-allocation-approval-view-v3",...common,calculation:null,reasons:[],approval:{id:id(2),previousApprovalId:null,
    contextHash:common.contextHash,documentHash:common.documentHash,approvedAt:"2026-09-15T12:00:00Z",approvedByUserId:id(9),current:true},
    recorded:null,historicalAcknowledgement:false,allocationApproved:true},upload:{schema:"raceson-final-allocation-upload-view-v3",...common,enabledPot:slot===5?0:1,
    approvalId:id(2),current:true,campaignAddress:address(3),budgetWei:"100",allocatedWei:"50",unallocatedWei:"50",entitlementCount:"4",
    prepared:{id:id(4),packageHash:"c".repeat(64),preparedAt:"2026-09-15T12:00:00Z"}}};}
beforeEach(()=>{m.api.mockReset();m.env.rewardDemo={mode:"local-testnet"};m.env.rewardPortalEnabled=true;});
it.each([5,6] as const)("discovers exact existing upload for slot %s using GET only",async slot=>{
  const f=data(slot);m.api.mockResolvedValueOnce(f.approval).mockResolvedValueOnce(f.upload);
  expect(await getFinalClubAwardsV3(record,slot)).toEqual({current:true,context:{...record,slot,approvalId:id(2),uploadId:id(4),campaignAddress:address(3)}});
  expect(m.api.mock.calls.map(([r])=>r.path)).toEqual([`/v1/organizer/rewards/drafts/${id(1)}/final-allocation-approval/${slot}`,`/v1/organizer/rewards/drafts/${id(1)}/final-allocation-upload/${slot}/${id(2)}`]);
  expect(m.api.mock.calls.every(([r])=>r.cache==="no-store"&&!r.method&&!r.body)).toBe(true);
});
it("absence and stale approval do not manufacture a new allocation",async()=>{
  const f=data();m.api.mockResolvedValueOnce({...f.approval,approval:null,allocationApproved:false});expect(await getFinalClubAwardsV3(record,5)).toBeNull();expect(m.api).toHaveBeenCalledTimes(1);
  m.api.mockResolvedValueOnce({...f.approval,approval:{...f.approval.approval,current:false},allocationApproved:false}).mockResolvedValueOnce({...f.upload,current:false});
  expect((await getFinalClubAwardsV3(record,5))?.current).toBe(false);
});
it.each([{slot:6},{chainId:143},{draftId:id(90)},{approvalId:id(90)},{enabledPot:1},{documentHash:"c".repeat(64)},
  {unallocatedWei:"51"},{payableWei:"50"},{signature:"private"}])("rejects foreign or payment-like upload %j",async patch=>{
  const f=data();m.api.mockResolvedValueOnce(f.approval).mockResolvedValueOnce({...f.upload,...patch});await expect(getFinalClubAwardsV3(record,5)).rejects.toThrow();
});
it("rejects wrong environment before and after IO",async()=>{
  m.env.rewardDemo={mode:"local"};await expect(getFinalClubAwardsV3(record,5)).rejects.toThrow();expect(m.api).not.toHaveBeenCalled();
  m.env.rewardDemo={mode:"local-testnet"};m.api.mockImplementation(async()=>{m.env.rewardDemo=null;return data().approval;});await expect(getFinalClubAwardsV3(record,5)).rejects.toThrow();
});
