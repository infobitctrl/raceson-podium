import {beforeEach,expect,it,vi} from 'vitest';
import {createGuidedSetup} from '@raceson/domain/rewards/guided-setup-editor';
import {readHostedSponsorCampaign} from './hostedSponsorCampaign';
const request=vi.hoisted(()=>vi.fn());
vi.mock('@/lib/api',()=>({apiRequest:request}));
const id='72000000-0000-4000-8000-000000000001';
function response(){return {record:{id,revision:2,chainId:10143,updatedAt:'2026-10-05T20:00:00.000Z',configuration:createGuidedSetup(()=>crypto.randomUUID())},fundedWei:'0',approvedWei:'0',payableWei:'0'};}
beforeEach(()=>request.mockReset());
it('reads the exact owner-scoped copy revision without acquiring execution authority',async()=>{
 request.mockResolvedValue(response());expect((await readHostedSponsorCampaign(id)).record.revision).toBe(2);expect(request).toHaveBeenCalledWith({path:`/v1/rewards/demo-copy/sponsor-setups/${id}`,cache:'no-store'});
});
it.each(['fundedWei','approvedWei','payableWei'])('rejects unexpected %s instead of presenting planning as execution',(field)=>{request.mockResolvedValue({...response(),[field]:'1'});return expect(readHostedSponsorCampaign(id)).rejects.toThrow('invalid_hosted_campaign_state');});
it('rejects another campaign and local-chain records',async()=>{
 const value=response();request.mockResolvedValue({...value,record:{...value.record,id:'72000000-0000-4000-8000-000000000002'}});await expect(readHostedSponsorCampaign(id)).rejects.toThrow();request.mockResolvedValue({...value,record:{...value.record,chainId:31337}});await expect(readHostedSponsorCampaign(id)).rejects.toThrow();
});
