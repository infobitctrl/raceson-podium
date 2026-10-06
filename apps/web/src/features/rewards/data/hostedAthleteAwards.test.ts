import {beforeEach,expect,it,vi} from 'vitest';
import {getHostedAthleteAwards} from './hostedAthleteAwards';
const mocks=vi.hoisted(()=>({request:vi.fn(),enabled:true}));
vi.mock('@/lib/api',()=>({apiRequest:mocks.request}));
vi.mock('@/lib/public-env',()=>({publicEnv:{rewardPortalEnabled:true,get hostedOperations(){return mocks.enabled;}}}));
const id='7d000000-0000-4000-8000-000000000001';
const award={approvalId:id,slot:0,entitlementId:'0x'+'a'.repeat(64),amountWei:'101',athleteProfileId:id,claims:[]};
beforeEach(()=>{mocks.enabled=true;mocks.request.mockReset().mockResolvedValue({items:[award],nextCursor:null});});
it('reads the exact hosted page with no client-selected identity or network',async()=>{
 expect((await getHostedAthleteAwards()).items).toEqual([award]);expect(mocks.request).toHaveBeenCalledExactlyOnceWith({path:'/v1/rewards/demo-copy/athlete-awards',cache:'no-store'});
 mocks.enabled=false;await expect(getHostedAthleteAwards()).rejects.toThrow('rewards_disabled');
});
it('rejects duplicate/unordered rows and a premature or reused continuation cursor',async()=>{
 for(const page of [{items:[award,award],nextCursor:null},{items:[award],nextCursor:award.entitlementId},{items:[{...award,amountWei:'-1'}],nextCursor:null}]){
  mocks.request.mockResolvedValueOnce(page);await expect(getHostedAthleteAwards()).rejects.toThrow();
 }
 await expect(getHostedAthleteAwards(award.entitlementId)).rejects.toThrow('invalid_claim');
});
