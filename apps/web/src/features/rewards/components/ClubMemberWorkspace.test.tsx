import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {beforeEach,expect,it,vi} from 'vitest';
import ClubMemberWorkspace from './ClubMemberWorkspace';
const m=vi.hoisted(()=>({read:vi.fn()}));
vi.mock('../data/clubMemberships',()=>({getRewardMemberClubs:m.read}));
vi.mock('./ClubOwnerApprovals',()=>({default:({clubId,onAccessError}:{clubId:string;onAccessError:()=>void})=><section aria-label="Club treasury approvals"><button onClick={onAccessError}>Lose signing access</button>Signing club {clubId}</section>}));
const id=(n:number)=>`73000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const member={clubId:id(1),name:'Member club',role:'member',canSign:false};
const mount=(url='/club/rewards')=>render(<MemoryRouter initialEntries={[url]}><ClubMemberWorkspace hr={false}><p>Manager controls</p></ClubMemberWorkspace></MemoryRouter>);
beforeEach(()=>m.read.mockReset().mockResolvedValue({items:[member],nextCursor:null}));
it('shows membership and athlete link without management or signing rights',async()=>{
 mount();await screen.findByRole('heading',{name:'Member club'});expect(screen.getByRole('link',{name:'My athlete rewards'})).toHaveAttribute('href','/athlete/rewards');
 expect(screen.queryByText('Manager controls')).not.toBeInTheDocument();expect(screen.queryByRole('region',{name:'Club treasury approvals'})).not.toBeInTheDocument();
});
it('switches selected-owner signing context between clubs and excludes ordinary members',async()=>{
 m.read.mockResolvedValue({items:[{...member,canSign:true},{...member,clubId:id(2),name:'Second club'}],nextCursor:null});mount();
 expect(await screen.findByText('Signing club '+id(1))).toBeVisible();fireEvent.change(screen.getByRole('combobox'),{target:{value:id(2)}});
 expect(screen.queryByRole('region',{name:'Club treasury approvals'})).not.toBeInTheDocument();expect(screen.queryByText('Manager controls')).not.toBeInTheDocument();
});
it('does not grant access from a foreign club URL',async()=>{mount('/club/rewards?club='+id(9));await screen.findByText(/This club is not in your loaded memberships/);expect(screen.queryByText('Manager controls')).not.toBeInTheDocument();});
it('clears stale membership and signing controls on refresh failure, then recovers',async()=>{
 m.read.mockResolvedValueOnce({items:[{...member,canSign:true}],nextCursor:null}).mockRejectedValueOnce(Error('offline')).mockResolvedValue({items:[member],nextCursor:null});mount();
 await screen.findByText('Signing club '+id(1));fireEvent.click(screen.getByRole('button',{name:'Refresh memberships'}));await screen.findByRole('alert');expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Refresh memberships'}));await screen.findByRole('combobox');expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
it('retires the entire member view on signing access loss',async()=>{m.read.mockResolvedValue({items:[{...member,canSign:true}],nextCursor:null});mount();fireEvent.click(await screen.findByText('Lose signing access'));expect(screen.getByRole('alert')).toBeVisible();expect(screen.queryByRole('combobox')).not.toBeInTheDocument();});
it('loads additional memberships and exposes manager controls only for manager rows',async()=>{
 m.read.mockResolvedValueOnce({items:[member],nextCursor:id(1)}).mockResolvedValueOnce({items:[{...member,clubId:id(2),name:'Managed club',role:'manager'}],nextCursor:null});mount();
 fireEvent.click(await screen.findByRole('button',{name:'Load more clubs'}));await screen.findByText('Manager controls');expect(m.read).toHaveBeenLastCalledWith(id(1));
});
it('ignores a late response after account workspace unmount',async()=>{
 let finish!:(v:unknown)=>void;m.read.mockImplementationOnce(()=>new Promise(r=>{finish=r;}));const view=mount();await waitFor(()=>expect(m.read).toHaveBeenCalledOnce());view.unmount();m.read.mockResolvedValue({items:[],nextCursor:null});mount();
 await act(async()=>finish({items:[{...member,canSign:true}],nextCursor:null}));expect(await screen.findByText(/No active club membership/)).toBeVisible();expect(screen.queryByText('Signing club '+id(1))).not.toBeInTheDocument();
});
