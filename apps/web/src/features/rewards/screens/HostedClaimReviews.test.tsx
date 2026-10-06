import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
import HostedClaimReviews from './HostedClaimReviews';
const mocks=vi.hoisted(()=>({read:vi.fn(),user:'7d000000-0000-4000-8000-000000000001',epoch:'session1',detail:vi.fn()}));
vi.mock('@/lib/auth',()=>({useAuth:()=>({user:{id:mocks.user},account:{userId:mocks.user},session:{opaque:'test'}})}));
vi.mock('../model/useRewardSessionEpoch',()=>({useRewardSessionEpoch:()=>mocks.epoch}));
vi.mock('../data/hostedClaimReviews',()=>({getHostedClaimReviews:mocks.read,requestHostedClaimReview:()=>{throw Error('unexpected');}}));
vi.mock('../components/SponsorClaims',()=>({ClaimDetail:(props:unknown)=>{mocks.detail(props);return <p>Scoped readiness detail</p>;}}));
const id='7d000000-0000-4000-8000-000000000006';
const item={id,approvalId:id,slot:0,entitlementId:'0x'+'a'.repeat(64),amountWei:'101',address:'0x'+'b'.repeat(40),prepared:false,consented:false,approved:false,paid:false};
function mount(){const client=new QueryClient({defaultOptions:{queries:{retry:false}}});const tree=()=><QueryClientProvider client={client}><HostedClaimReviews approvalId={id} hr={false}/></QueryClientProvider>;const view=render(tree());return{...view,update:()=>view.rerender(tree())};}
beforeEach(()=>{mocks.user='7d000000-0000-4000-8000-000000000001';mocks.epoch='session1';mocks.read.mockReset().mockResolvedValue({items:[item],nextCursor:null});mocks.detail.mockReset();});
it('opens reviewer-only details from an exact approval queue without signing or payment',async()=>{
 mount();fireEvent.click(await screen.findByRole('button',{name:'Review recipient request'}));await screen.findByText('Scoped readiness detail');
 expect(mocks.read).toHaveBeenCalledExactlyOnceWith(id,null);expect(mocks.detail.mock.calls[0][0]).toEqual(expect.objectContaining({id,reviewerOnly:true,role:'operator',chainId:10143}));
});
it('failed refresh retires prior requests and never exposes private internal errors',async()=>{
 mount();await screen.findByRole('button',{name:'Review recipient request'});mocks.read.mockRejectedValueOnce(Error('private identity detail'));
 fireEvent.click(screen.getByRole('button',{name:'Refresh recipient requests'}));await screen.findByRole('alert');expect(screen.queryByText(item.address)).not.toBeInTheDocument();expect(screen.queryByText('private identity detail')).not.toBeInTheDocument();
});
it('an account/session change remounts the request workspace and closes selected private details',async()=>{
 const view=mount();fireEvent.click(await screen.findByRole('button',{name:'Review recipient request'}));await screen.findByText('Scoped readiness detail');
 mocks.epoch='session2';mocks.read.mockResolvedValue({items:[],nextCursor:null});view.update();await screen.findByText('No recipient requests for this award version yet.');expect(screen.queryByText('Scoped readiness detail')).not.toBeInTheDocument();await waitFor(()=>expect(mocks.read).toHaveBeenCalledTimes(2));
});
