import {beforeEach,expect,it,vi} from 'vitest';
import {readReviewStatus} from './reviewStatus';
const mock=vi.hoisted(()=>vi.fn());vi.mock('@/lib/api',()=>({apiRequest:mock}));
const id='7c000000-0000-4000-8000-000000000001',launchId='7c000000-0000-4000-8000-000000000002';
const status={setupId:id,revision:2,launchId,fundingState:'funded',claimState:'not_open',reviewState:'approved',blockNumber:'123'};
beforeEach(()=>{mock.mockReset();});
it('reads scoped status without posting a command',async()=>{
 mock.mockResolvedValue(status);expect(await readReviewStatus(id,2)).toEqual(status);
 expect(mock).toHaveBeenCalledWith({path:`/v1/rewards/demo-copy/reviews/${id}/status`,cache:'no-store'});
});
it.each([{setupId:launchId},{revision:1},{claimState:'ready'},{fundingState:'needs_chain_check'}])('rejects stale, foreign or invalid status %j',async patch=>{
 mock.mockResolvedValue({...status,...patch});await expect(readReviewStatus(id,2)).rejects.toThrow();
});
