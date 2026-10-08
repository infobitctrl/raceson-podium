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
 api.mockResolvedValue(page);render(ui());const table=await screen.findByRole('table',{name:'Awards and claim status'});
 expect(within(table).getByText('Claimed')).toBeVisible();expect(within(table).getByText('Unclaimed')).toBeVisible();expect(within(table).getAllByRole('row')).toHaveLength(3);
 fireEvent.click(screen.getByText('Claims open',{selector:'summary'}));expect(screen.getByText(/Each recipient must claim/)).toBeVisible();expect(screen.getByRole('link',{name:'Claim my rewards →'})).toHaveAttribute('href','/athlete/rewards');
});
it('sorts every column globally after loading bounded pages, and resets pagination',async()=>{
 const all=Array.from({length:30},(_,i)=>({...row(i+1,i===29?'claimed':'unclaimed'),amountWei:String(i+1),kind:i===29?'club':'athlete'}));
 api.mockImplementation(async(_id,_slot,offset)=>({...page,total:30,offset,rows:all.slice(offset,offset+25)}));
 render(ui());await screen.findByText('Athlete reward 1');expect(api).toHaveBeenCalledTimes(2);
 fireEvent.click(screen.getByRole('button',{name:'Next'}));expect(screen.getByText('Club reward 30')).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'Amount'}));
 const rows=()=>within(screen.getByRole('table')).getAllByRole('row').slice(1);
 expect(rows()[0]).toHaveTextContent('Club reward 30');expect(screen.getByRole('columnheader',{name:'Amount'})).toHaveAttribute('aria-sort','descending');
 fireEvent.click(screen.getByRole('button',{name:'Status'}));expect(rows()[0]).toHaveTextContent('Claimed');
 fireEvent.click(screen.getByRole('button',{name:'Reward / category'}));expect(rows()[0]).toHaveTextContent('Athlete reward 1');
 fireEvent.click(screen.getByRole('button',{name:'Reference'}));expect(rows()[0]).toHaveTextContent('Athlete reward 1');
 expect(api).toHaveBeenCalledTimes(2);
});
it('shows loading and retry without inventing reward statuses',async()=>{
 api.mockRejectedValueOnce(Error('offline')).mockResolvedValueOnce(page);render(ui());expect(screen.getByRole('status')).toHaveTextContent('Checking reward status');
 expect(await screen.findByRole('alert')).toHaveTextContent('No payment status is assumed');expect(screen.queryByText('Unclaimed')).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Retry reward status'}));expect(within(await screen.findByRole('table')).getByText('Unclaimed')).toBeVisible();
});
it('does not leak old-pot rows after selection changes or late responses',async()=>{
 let finish:(v:unknown)=>void=()=>{};api.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;})).mockResolvedValueOnce({...page,rows:[row(3)],total:1});
 const view=render(ui());view.rerender(ui(2));await screen.findByText('Athlete reward 3');finish(page);await waitFor(()=>expect(screen.queryByText('Athlete reward 1')).not.toBeInTheDocument());
});
it('shows a meaningful empty allocation state',async()=>{api.mockResolvedValue({...page,total:0,rows:[],availability:'awaiting_approval'});render(ui());expect(await screen.findByText(/Awaiting approved results/)).toBeVisible();expect(screen.queryByRole('table')).not.toBeInTheDocument();});

it('searches and filters the complete ledger, including rewards beyond the first page',async()=>{
 const all=Array.from({length:30},(_,i)=>row(i+1,i===29?'claimed':'unclaimed'));
 api.mockImplementation(async(_id,_slot,offset)=>({...page,total:30,offset,rows:all.slice(offset,offset+25)}));render(ui());await screen.findByRole('table');
 fireEvent.change(screen.getByLabelText('Reward status'),{target:{value:'claimed'}});
 expect(within(screen.getByRole('table')).getByText('Athlete reward 30')).toBeVisible();
 expect(screen.queryByRole('button',{name:'Next'})).not.toBeInTheDocument();
 fireEvent.change(screen.getByLabelText('Search rewards'),{target:{value:'missing-reference'}});
 expect(screen.getByText('0 matching rewards of 30.')).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'Clear filters'}));expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(26);
});
it('fails closed when pages repeat or fail instead of rendering a partial distribution',async()=>{
 api.mockResolvedValue({...page,total:30,rows:Array.from({length:25},(_,i)=>row(i+1))});render(ui());
 expect(await screen.findByRole('alert')).toHaveTextContent('No payment status is assumed');expect(screen.queryByRole('table')).not.toBeInTheDocument();
});
