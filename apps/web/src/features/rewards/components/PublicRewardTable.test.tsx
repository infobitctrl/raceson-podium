import {fireEvent,render,screen,within,waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {beforeEach,expect,it,vi} from 'vitest';
import PublicRewardTable from './PublicRewardTable';
const api=vi.hoisted(()=>vi.fn());vi.mock('../data/publicCampaign',()=>({readPublicRewards:api}));
const row=(n:number,status='unclaimed')=>({id:'0x'+String(n).padStart(64,'0'),number:n,kind:'athlete',amountWei:'3000000000000000',status});
const page={total:2,offset:0,rows:[row(1,'claimed'),row(2)],availability:'open',blockNumber:'100',blockTimestamp:'1800000000'};
const ui=(slot=1,refresh=0)=><MemoryRouter><PublicRewardTable key={slot} id="campaign" slot={slot} hr={false} refresh={refresh}/></MemoryRouter>;
beforeEach(()=>api.mockReset());
it('shows every reward with distinct claim status and hides private identities',async()=>{
 api.mockResolvedValue(page);render(ui());const table=await screen.findByRole('table',{name:'Athlete rewards'});
 expect(within(table).getByText('Claimed')).toBeVisible();expect(within(table).getByText('Unclaimed')).toBeVisible();expect(within(table).getAllByRole('row')).toHaveLength(3);
 fireEvent.click(screen.getByText('Claims open',{selector:'summary'}));expect(screen.getByText(/Each recipient must claim/)).toBeVisible();expect(screen.getByRole('link',{name:'Claim my rewards →'})).toHaveAttribute('href','/athlete/rewards');
});
it('keeps clubs in a separate ledger and sorts and paginates the complete athlete ledger',async()=>{
 const all=Array.from({length:31},(_,i)=>({...row(i+1,i===29?'claimed':'unclaimed'),amountWei:String(i+1),kind:i===30?'club':'athlete',display:{name:i===30?'Demo club':'Runner '+(i+1),club:i===30?null:'Running club',timeMs:i===30?null:String((i+1)*1000)},breakdown:[{category:'Open',place:i+1,amountWei:String(i+1)}]}));
 api.mockImplementation(async(_id,_slot,offset)=>({...page,total:31,offset,rows:all.slice(offset,offset+25)}));
 render(ui());await screen.findByText('Runner 1');expect(api).toHaveBeenCalledTimes(2);
 const table=screen.getByRole('table',{name:'Athlete rewards'}),club=screen.getByRole('table',{name:'Club rewards'});
 expect(within(club).getByText('Demo club')).toBeVisible();expect(within(table).queryByText('Demo club')).not.toBeInTheDocument();
 expect(within(table).getAllByRole('columnheader').map(h=>h.textContent)).toEqual(['#','Category','Position','Athlete name','Club','Time','Rewards','Status']);
 fireEvent.click(screen.getByRole('button',{name:'Next'}));expect(within(table).getByText('Runner 30')).toBeVisible();
 fireEvent.click(within(table).getByRole('button',{name:'Rewards'}));
 const rows=()=>within(table).getAllByRole('row').slice(1);
 expect(rows()[0]).toHaveTextContent('Runner 30');expect(within(table).getByRole('columnheader',{name:'Rewards'})).toHaveAttribute('aria-sort','descending');
 for(const h of within(table).getAllByRole('columnheader')){fireEvent.click(within(h).getByRole('button'));expect(h).not.toHaveAttribute('aria-sort','none');}
 fireEvent.change(screen.getByLabelText('Athlete rewards · Search rewards'),{target:{value:'Runner 30'}});
 expect(rows()).toHaveLength(1);expect(rows()[0]).toHaveTextContent('00:00:30.000');expect(within(club).getByText('Demo club')).toBeVisible();
 expect(api).toHaveBeenCalledTimes(2);
});
it('shows loading and retry without inventing reward statuses',async()=>{
 api.mockRejectedValueOnce(Error('offline')).mockResolvedValueOnce(page);render(ui());expect(screen.getByRole('status')).toHaveTextContent('Checking reward status');
 expect(await screen.findByRole('alert')).toHaveTextContent('No payment status is assumed');expect(screen.queryByText('Unclaimed')).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Retry reward status'}));expect(within(await screen.findByRole('table',{name:'Athlete rewards'})).getByText('Unclaimed')).toBeVisible();
});
it('does not leak old-pot rows after selection changes or late responses',async()=>{
 let finish:(v:unknown)=>void=()=>{};api.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;})).mockResolvedValueOnce({...page,rows:[row(3)],total:1});
 const view=render(ui());view.rerender(ui(2));await screen.findByText('Athlete reward 3');finish(page);await waitFor(()=>expect(screen.queryByText('Athlete reward 1')).not.toBeInTheDocument());
});
it('shows a meaningful empty allocation state',async()=>{api.mockResolvedValue({...page,total:0,rows:[],availability:'awaiting_approval'});render(ui());expect(await screen.findByText(/Awaiting approved results/)).toBeVisible();expect(screen.queryByRole('table')).not.toBeInTheDocument();});

it('searches and filters the complete ledger, including rewards beyond the first page',async()=>{
 const all=Array.from({length:30},(_,i)=>row(i+1,i===29?'claimed':'unclaimed'));
 api.mockImplementation(async(_id,_slot,offset)=>({...page,total:30,offset,rows:all.slice(offset,offset+25)}));render(ui());await screen.findByRole('table',{name:'Athlete rewards'});
 fireEvent.change(screen.getByLabelText('Athlete rewards · Reward status'),{target:{value:'claimed'}});
 expect(within(screen.getByRole('table',{name:'Athlete rewards'})).getByText('Athlete reward 30')).toBeVisible();
 expect(screen.queryByRole('button',{name:'Next'})).not.toBeInTheDocument();
 fireEvent.change(screen.getByLabelText('Athlete rewards · Search rewards'),{target:{value:'missing-reference'}});
 expect(screen.getByText('0 matching rewards of 30.')).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'Clear filters'}));expect(within(screen.getByRole('table',{name:'Athlete rewards'})).getAllByRole('row')).toHaveLength(26);
});
it('fails closed when pages repeat or fail instead of rendering a partial distribution',async()=>{
 api.mockResolvedValue({...page,total:30,rows:Array.from({length:25},(_,i)=>row(i+1))});render(ui());
 expect(await screen.findByRole('alert')).toHaveTextContent('No payment status is assumed');expect(screen.queryByRole('table')).not.toBeInTheDocument();
});
