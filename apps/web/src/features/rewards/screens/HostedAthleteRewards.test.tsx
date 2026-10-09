import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
import type {ComponentProps} from 'react';
import type AthleteProfileWallet from '../components/AthleteProfileWallet';
import type SponsorClaims from '../components/SponsorClaims';
import type RewardAccountSummary from '../components/RewardAccountSummary';
import HostedAthleteRewards from './HostedAthleteRewards';
const mocks=vi.hoisted(()=>({awards:vi.fn(),destinations:vi.fn(),wallet:null as ComponentProps<typeof AthleteProfileWallet>|null,claims:null as ComponentProps<typeof SponsorClaims>|null,summary:null as ComponentProps<typeof RewardAccountSummary>|null}));
vi.mock('../data/hostedAthleteAwards',()=>({getHostedAthleteAwards:mocks.awards}));
vi.mock('../data/athleteDestinations',()=>({getOwnRewardDestinations:mocks.destinations}));
vi.mock('../components/ClubOwnerApprovals',()=>({default:()=> <section>Club treasury approvals</section>}));
vi.mock('../components/AthleteProfileWallet',()=>({default:(props:ComponentProps<typeof AthleteProfileWallet>)=>{mocks.wallet=props;return <aside><p>{props.ready?'Wallet ready':'Wallet unavailable'}</p>{props.destinations.map(d=><p key={d.requestId}>{d.address}</p>)}</aside>;}}));
vi.mock('../components/SponsorClaims',()=>({default:(props:ComponentProps<typeof SponsorClaims>)=>{mocks.claims=props;return <section><p>{props.shared?.awards.length?'Copied award':'No copied awards'}</p><button onClick={()=>void props.shared?.refresh().catch(()=>{})}>Refresh</button><button onClick={()=>props.onAccessError?.({status:401})}>Lose access</button></section>;}}));
vi.mock('../components/RewardAccountSummary',()=>({default:(props:ComponentProps<typeof RewardAccountSummary>)=>{mocks.summary=props;return <section>{props.complete?'Complete total':'Incomplete total'} {props.confirmedPaid?.toString()??'No receipt total'}</section>;}}));
const profile='7d000000-0000-4000-8000-000000000006',user='7d000000-0000-4000-8000-000000000001';
const award={approvalId:profile,slot:1,entitlementId:'0x'+'a'.repeat(64),amountWei:'101',athleteProfileId:profile,claims:[]};
const destination={requestId:profile,athleteProfileId:profile,address:'0x'+'b'.repeat(40),chainId:10143,status:'pending_review'};
function mount(){const client=new QueryClient({defaultOptions:{queries:{retry:false}}});const tree=(epoch:string)=><QueryClientProvider client={client}><HostedAthleteRewards key={epoch} userId={user} profileId={profile} viewKey={epoch} hr={false}/></QueryClientProvider>;const view=render(tree('session1'));return{...view,remount:()=>view.rerender(tree('session2'))};}
beforeEach(()=>{mocks.awards.mockReset().mockResolvedValue({items:[award],nextCursor:null});mocks.destinations.mockReset().mockResolvedValue({items:[destination],nextCursor:null});mocks.wallet=null;mocks.claims=null;mocks.summary=null;});
it('direct awards have no legacy destination request or readiness dependency, and paid totals include direct receipts',async()=>{
 mocks.awards.mockResolvedValue({items:[{...award,protocolVersion:5,directClaim:{paid:true}}],nextCursor:null});
 mocks.destinations.mockRejectedValue(Error('The legacy queue must not be queried'));
 mount();await screen.findByText('Copied award');
 expect(mocks.destinations).not.toHaveBeenCalled();expect(mocks.wallet).toBeNull();
 expect(mocks.summary?.confirmedPaid).toBe(101n);expect(mocks.summary?.claimReadiness).toBeUndefined();
 fireEvent.click(screen.getByRole('button',{name:'Refresh',exact:true}));
 await waitFor(()=>expect(mocks.awards).toHaveBeenCalledTimes(2));expect(mocks.destinations).not.toHaveBeenCalled();
});
it('uses copied awards only, retains unclaimed amounts and keeps consent separate from wallet choice',async()=>{
 mount();await screen.findByText('Copied award');expect(mocks.awards).toHaveBeenCalledExactlyOnceWith(null);expect(mocks.destinations).toHaveBeenCalledExactlyOnceWith(null);
 expect(mocks.wallet?.profileId).toBe(profile);expect(mocks.wallet?.destinations).toEqual([destination]);expect(mocks.claims?.role).toBe('recipient');expect(mocks.summary?.confirmedPaid).toBe(0n);
 expect(mocks.claims?.athletePresentation).toBe(true);expect(mocks.summary?.claimReadiness).toEqual({reviewable:0n,waiting:101n});
});
it('keeps totals/history incomplete until explicit pagination completes',async()=>{
 mocks.awards.mockResolvedValueOnce({items:[award],nextCursor:award.entitlementId}).mockResolvedValueOnce({items:[{...award,entitlementId:'0x'+'c'.repeat(64)}],nextCursor:null});
 mocks.destinations.mockResolvedValueOnce({items:[destination],nextCursor:profile}).mockResolvedValueOnce({items:[],nextCursor:null});
 mount();await screen.findByText(/^Incomplete total/);expect(mocks.wallet?.complete).toBe(false);
 fireEvent.click(screen.getByRole('button',{name:'Load more awards'}));await screen.findByText(/^Complete total/);expect(mocks.claims?.shared?.awards).toHaveLength(2);expect(mocks.awards).toHaveBeenLastCalledWith(award.entitlementId);
 fireEvent.click(screen.getByRole('button',{name:'Load more wallet choices'}));await waitFor(()=>expect(mocks.wallet?.complete).toBe(true));expect(mocks.destinations).toHaveBeenLastCalledWith(profile);
});
it('failed refresh retires awards and destinations together, then permits explicit fresh recovery',async()=>{
 mount();await screen.findByText('Copied award');mocks.awards.mockRejectedValueOnce(Error('private internal detail'));
 fireEvent.click(screen.getByRole('button',{name:'Refresh'}));await screen.findByRole('alert');expect(screen.queryByText('Copied award')).not.toBeInTheDocument();expect(screen.queryByText(destination.address)).not.toBeInTheDocument();expect(mocks.wallet?.ready).toBe(false);expect(screen.queryByText('private internal detail')).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Reload rewards and destinations'}));await screen.findByText('Copied award');expect(mocks.wallet?.ready).toBe(true);
});
it('old session responses cannot repopulate a remounted account epoch',async()=>{
 let finish!:(value:unknown)=>void;mocks.awards.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;})).mockResolvedValueOnce({items:[],nextCursor:null});
 const view=mount();view.remount();await screen.findByText('No copied awards');await act(async()=>finish({items:[award],nextCursor:null}));expect(screen.queryByText('Copied award')).not.toBeInTheDocument();expect(mocks.claims?.shared?.awards).toEqual([]);
});
it('claim access loss retires all private rows until a successful explicit refresh',async()=>{
 mount();await screen.findByText('Copied award');fireEvent.click(screen.getByRole('button',{name:'Lose access'}));await screen.findByRole('alert');expect(mocks.wallet?.destinations).toEqual([]);
 fireEvent.click(screen.getByRole('button',{name:'Reload rewards and destinations'}));await screen.findByText('Copied award');
});

it('empty direct-claim workspace does not reintroduce recipient review or fetch legacy destinations',async()=>{
 mocks.awards.mockResolvedValue({items:[],nextCursor:null});
 mocks.destinations.mockRejectedValue(Error('Legacy setup must remain absent'));
 mount();await screen.findByText('No copied awards');
 expect(mocks.destinations).not.toHaveBeenCalled();expect(mocks.wallet).toBeNull();
 expect(mocks.summary?.claimReadiness).toBeUndefined();expect(mocks.summary?.confirmedPaid).toBe(0n);
});
