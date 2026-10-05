import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
import HostedAthleteDestination from './HostedAthleteDestination';
import type {ComponentProps} from 'react';
import type AthleteProfileWallet from './AthleteProfileWallet';
const mocks=vi.hoisted(()=>({read:vi.fn(),props:null as ComponentProps<typeof AthleteProfileWallet>|null}));
vi.mock('../data/athleteDestinations',()=>({getOwnRewardDestinations:mocks.read}));
vi.mock('./AthleteProfileWallet',()=>({default:(props:ComponentProps<typeof AthleteProfileWallet>)=>{mocks.props=props;return <div>{props.ready?props.destinations.map(d=><p key={d.requestId}>{d.address}</p>):null}<button disabled={props.refreshing} onClick={()=>void props.onRefresh()}>Refresh</button><button disabled={props.refreshing} onClick={props.onMore}>More</button><span>{props.complete?'Complete':'Incomplete'}</span></div>;}}));
const profile='7d000000-0000-4000-8000-000000000006';
const destination={requestId:'7d000000-0000-4000-8000-000000000005',athleteProfileId:profile,address:'0x'+'a'.repeat(40),chainId:10143 as const,status:'pending_review' as const,requestedAt:'2026-10-06T01:00:00Z',withdrawnAt:null};
beforeEach(()=>{mocks.read.mockReset();mocks.props=null;});
it('loads choices without creating or signing a wallet and requires complete history',async()=>{
 mocks.read.mockResolvedValueOnce({items:[destination],nextCursor:destination.requestId}).mockResolvedValueOnce({items:[],nextCursor:null});
 render(<HostedAthleteDestination profileId={profile} hr={false}/>);
 expect(await screen.findByText(destination.address)).toBeVisible();expect(mocks.read).toHaveBeenCalledExactlyOnceWith(null);expect(mocks.props?.profileId).toBe(profile);expect(mocks.props?.complete).toBe(false);
 fireEvent.click(screen.getByRole('button',{name:'More'}));await screen.findByText('Complete');expect(mocks.read).toHaveBeenLastCalledWith(destination.requestId);expect(mocks.props?.destinations).toEqual([destination]);
});
it('failed refresh retires all old destinations and allows an explicit fresh read',async()=>{
 mocks.read.mockResolvedValueOnce({items:[destination],nextCursor:null}).mockRejectedValueOnce(Error('private detail')).mockResolvedValueOnce({items:[],nextCursor:null});
 render(<HostedAthleteDestination profileId={profile} hr={false}/>);await screen.findByText(destination.address);
 fireEvent.click(screen.getByRole('button',{name:'Refresh'}));await screen.findByRole('button',{name:'Reload destinations'});
 expect(screen.queryByText(destination.address)).not.toBeInTheDocument();expect(screen.queryByText('private detail')).not.toBeInTheDocument();expect(mocks.props?.failed).toBe(true);expect(mocks.props?.complete).toBe(false);
 fireEvent.click(screen.getByRole('button',{name:'Reload destinations'}));await waitFor(()=>expect(mocks.props?.ready).toBe(true));expect(mocks.props?.destinations).toEqual([]);
});
it('an old account/session response cannot populate its remounted successor',async()=>{
 let finish!:(value:unknown)=>void;mocks.read.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;})).mockResolvedValueOnce({items:[],nextCursor:null});
 const view=render(<HostedAthleteDestination key="session-1" profileId={profile} hr={false}/>);
 view.rerender(<HostedAthleteDestination key="session-2" profileId={profile} hr={false}/>);
 await waitFor(()=>expect(mocks.props?.ready).toBe(true));await act(async()=>finish({items:[destination],nextCursor:null}));expect(screen.queryByText(destination.address)).not.toBeInTheDocument();expect(mocks.props?.destinations).toEqual([]);
});
