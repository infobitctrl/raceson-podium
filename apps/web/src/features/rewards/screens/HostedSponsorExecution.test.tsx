vi.mock('@/lib/auth',()=>({useAuth:()=>({user:{id:'fixture-sponsor'},session:{access_token:'fixture',refresh_token:'fixture',user:{id:'fixture-sponsor'},expires_at:1900000000,token_type:'bearer'}})}));
vi.mock('../data/campaignBranding',()=>({readCampaignBranding:async()=>[],saveCampaignBranding:vi.fn()}));
import {act,render,screen,waitFor,fireEvent} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {beforeEach,expect,it,vi} from 'vitest';
import {createGuidedSetup} from '@raceson/domain/rewards/guided-setup-editor';
import HostedSponsorExecution from './HostedSponsorExecution';
const mocks=vi.hoisted(()=>({launch:vi.fn(),funding:vi.fn()}));
vi.mock('../data/hostedSponsorLaunch',()=>({hostedSponsorLaunch:mocks.launch}));
vi.mock('../components/SponsorFunding',()=>({default:(props)=>{mocks.funding(props);return <p>Explicit contract creation and deposit controls</p>;}}));
vi.mock('./HostedAllocationPreview',()=>({default:({revision})=><p>Allocation revision {revision}</p>}));
const id='7c000000-0000-4000-8000-000000000003',launchId='7c000000-0000-4000-8000-000000000004';
function fixture(){
 const configuration=createGuidedSetup(()=>crypto.randomUUID());configuration.name='Source-bound campaign';configuration.budgetMon='100';
 const setup={id,revision:2,chainId:10143,configuration,updatedAt:'2026-10-05T20:00:00.000Z'};
 const launch={id:launchId,setup,configurationHash:'a'.repeat(64),createdAt:setup.updatedAt,state:'prepared'};
 const binding={version:'copy-launch-v1',setupId:id,launchId,revision:2,configurationHash:launch.configurationHash,sourceFingerprint:'b'.repeat(64)};
 return {view:{setup,launch},binding};
}
const view=()=> <MemoryRouter><HostedSponsorExecution id={id} hr={false}/></MemoryRouter>;
beforeEach(()=>{mocks.launch.mockReset();mocks.funding.mockReset();});
it('reopens an immutable launch without requesting creation or another freeze',async()=>{
 const f=fixture();mocks.launch.mockResolvedValue(f);render(view());await screen.findByRole('heading',{name:'Source-bound campaign'});
 expect(mocks.launch).toHaveBeenCalledExactlyOnceWith(id);expect(mocks.funding.mock.calls[0][0].copyBinding).toEqual(f.binding);
 expect(screen.getByText('Deposited prize funds').nextElementSibling).toHaveTextContent('0 test MON');
 expect(screen.getByRole('link',{name:'View rules'})).toHaveAttribute('href',`/rewards/create?setup=${id}`);
});
it('first visit freezes the confirmed revision only and leaves funds zero',async()=>{
 const f=fixture();mocks.launch.mockResolvedValueOnce({view:{...f.view,launch:null},binding:null}).mockResolvedValueOnce(f);render(view());
 await screen.findByRole('heading',{name:'Source-bound campaign'});expect(mocks.launch).toHaveBeenCalledTimes(2);
 expect(mocks.launch.mock.calls[1]).toEqual([id,{requestId:expect.any(String),expectedRevision:2}]);
 expect(screen.getByText('Deposited prize funds').nextElementSibling).toHaveTextContent('0 test MON');
});
it('lost freeze reply retries by reading the saved launch before another write',async()=>{
 const f=fixture();mocks.launch.mockResolvedValueOnce({view:{...f.view,launch:null},binding:null}).mockRejectedValueOnce(Error('lost reply')).mockResolvedValueOnce(f);
 render(view());fireEvent.click(await screen.findByRole('button',{name:'Retry'}));await screen.findByRole('heading',{name:'Source-bound campaign'});
 expect(mocks.launch.mock.calls.filter(call=>call.length===2)).toHaveLength(1);expect(mocks.launch.mock.calls[2]).toEqual([id]);
});
it('ignores a late account-scoped read after the workspace is unmounted',async()=>{
 let resolve;mocks.launch.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));const page=render(view());
 await waitFor(()=>expect(mocks.launch).toHaveBeenCalledOnce());page.unmount();await act(async()=>resolve(fixture()));expect(mocks.funding).not.toHaveBeenCalled();
});
