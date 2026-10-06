import {beforeEach,expect,it,vi} from 'vitest';
import {decodeHostedClaimQueue,getHostedClaimReviews,requestHostedClaimReview} from './hostedClaimReviews';
const mocks=vi.hoisted(()=>({request:vi.fn()}));
vi.mock('@/lib/api',()=>({apiRequest:mocks.request}));
vi.mock('@/lib/public-env',()=>({publicEnv:{hostedOperations:true,rewardPortalEnabled:true}}));
const id='7d000000-0000-4000-8000-000000000001',hash='a'.repeat(64);
const row={id,approvalId:id,slot:0,entitlementId:'0x'+hash,amountWei:'101',address:'0x'+'b'.repeat(40),prepared:false,consented:false,approved:false,paid:false};
const view={schema:'raceson-sponsor-claim-view-v4',claimId:id,approvalId:id,chainId:10143,role:'operator',current:false,status:'held',sourceStamp:hash,profileFingerprint:hash,operatorAddress:'0x'+'c'.repeat(40),address:row.address,claim:null,context:null,signing:null,transaction:null,receipt:null};
beforeEach(()=>mocks.request.mockReset());
it('uses bounded approval paging and rejects mixed scope, duplicated rows and false paid sequencing',async()=>{
 mocks.request.mockResolvedValue({items:[row],nextCursor:null});expect((await getHostedClaimReviews(id)).items).toEqual([row]);expect(mocks.request).toHaveBeenCalledExactlyOnceWith({path:'/v1/rewards/demo-copy/claim-reviews?approvalId='+id,cache:'no-store'});
 for(const items of [[row,row],[{...row,approvalId:'7d000000-0000-4000-8000-000000000002'}],[{...row,paid:true}]])expect(()=>decodeHostedClaimQueue({items,nextCursor:null},id,null)).toThrow();
});
it('readiness transport never accepts native signing calldata or an unrelated claim',async()=>{
 mocks.request.mockResolvedValueOnce(view);expect((await requestHostedClaimReview(id)).status).toBe('held');
 for(const patch of [{signing:{}},{transaction:{chainId:10143,from:view.operatorAddress,to:row.address,value:'0',data:'0x1234'}},{claimId:'7d000000-0000-4000-8000-000000000002'},{chainId:31337}]){mocks.request.mockResolvedValueOnce({...view,...patch});await expect(requestHostedClaimReview(id)).rejects.toThrow();}
});
