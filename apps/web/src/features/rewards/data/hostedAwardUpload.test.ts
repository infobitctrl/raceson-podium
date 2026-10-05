import {beforeEach,expect,it,vi} from 'vitest';
import {readHostedAwardUpload,readHostedAwardHandoff} from './hostedAwardUpload';
const mocks=vi.hoisted(()=>({api:vi.fn()}));vi.mock('@/lib/api',()=>({apiRequest:mocks.api}));
const id=(n:number)=>`7c000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const scope={id:id(1),slot:0,approvalId:id(2)},base={schema:'raceson-sponsor-upload-view-v4',approvalId:scope.approvalId,slot:0,contextHash:'c'.repeat(64),documentHash:'d'.repeat(64),current:true,sourceKind:'historical_copy',budgetWei:'101',allocatedWei:'100',unallocatedWei:'1',recipientCount:1,campaignAddress:null,prepared:null,executionStatus:'not_observed',stageReady:false,payableWei:'0'};
const handoff={schema:'raceson-sponsor-lifecycle-view-v4',approvalId:scope.approvalId,slot:0,current:true,publicationHash:'e'.repeat(64),publication:null,pot:null,transaction:null,receipts:[]};
beforeEach(()=>mocks.api.mockReset());
it('reads only the exact approval with no cache and verifies integer conservation',async()=>{
 mocks.api.mockResolvedValue(base);expect(await readHostedAwardUpload(scope)).toEqual(base);
 expect(mocks.api).toHaveBeenCalledWith({path:`/v1/rewards/demo-copy/reviews/${scope.id}/allocations/0/${scope.approvalId}/upload`,method:'GET',cache:'no-store'});
 for(const patch of [{approvalId:id(3)},{slot:1},{budgetWei:'102'},{sourceKind:'native'},{stageReady:true},{payableWei:'1'},{privateDocument:{}}]){
  mocks.api.mockResolvedValue({...base,...patch});await expect(readHostedAwardUpload(scope)).rejects.toThrow();
 }
});
it('preparation acknowledgement must match the request UUID and exact context/document digest',async()=>{
 const change={requestId:id(4),contextHash:base.contextHash,documentHash:base.documentHash},prepared={id:change.requestId,packageHash:'e'.repeat(64),preparedAt:'2026-10-05T12:00:00.000Z'};
 mocks.api.mockResolvedValue({...base,prepared});await readHostedAwardUpload(scope,change);
 expect(mocks.api.mock.calls[0][0].body).toEqual(change);
 for(const patch of [{prepared:null},{prepared:{...prepared,id:id(5)}},{contextHash:'a'.repeat(64)},{documentHash:'b'.repeat(64)}]){
  mocks.api.mockResolvedValue({...base,prepared,...patch});await expect(readHostedAwardUpload(scope,change)).rejects.toThrow();
 }
});
it('results handoff cannot expose signing calldata or chain observations and binds the publication UUID',async()=>{
 mocks.api.mockResolvedValue(handoff);await readHostedAwardHandoff(scope);
 for(const patch of [{approvalId:id(3)},{slot:1},{pot:{state:1,paused:false,paidWei:'0',allocatedWei:'0',claimDeadline:'0',entitlementCount:'0'}}]){
  mocks.api.mockResolvedValue({...handoff,...patch});await expect(readHostedAwardHandoff(scope)).rejects.toThrow();
 }
 const change={action:'publication' as const,requestId:id(4),documentHash:handoff.publicationHash};
 mocks.api.mockResolvedValue({...handoff,publication:{id:id(5),timing:{reviewPeriod:'0',reviewStartedAt:'1',officialPublishedAt:'1',publicationEvidenceHash:'0x'+'a'.repeat(64)}}});
 await expect(readHostedAwardHandoff(scope,change)).rejects.toThrow();
});
