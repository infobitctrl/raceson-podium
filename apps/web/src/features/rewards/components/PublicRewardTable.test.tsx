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
 expect(within(table).getByText('Claimed')).toBeVisible();expect(within(table).getByText('Not claimed')).toBeVisible();expect(within(table).getAllByRole('row')).toHaveLength(3);
 fireEvent.click(screen.getByText('Claims open',{selector:'summary'}));expect(screen.getByText(/Each recipient must claim/)).toBeVisible();expect(screen.getByRole('link',{name:'Claim my rewards →'})).toHaveAttribute('href','/athlete/rewards');
});
it('sorts via bounded global query, resets pagination and keeps exact pot scope',async()=>{
 api.mockResolvedValue({...page,total:30,rows:Array.from({length:25},(_,i)=>row(i+1))});render(ui());await screen.findByText('Athlete reward 1');
 fireEvent.click(screen.getByRole('button',{name:'Next'}));await waitFor(()=>expect(api.mock.lastCall?.slice(0,5)).toEqual(['campaign',1,25,'reward','asc']));
 await screen.findByRole('button',{name:'Amount'});fireEvent.click(screen.getByRole('button',{name:'Amount'}));await waitFor(()=>expect(api.mock.lastCall?.slice(0,5)).toEqual(['campaign',1,0,'amount','desc']));
 await screen.findByLabelText('Sort ledger');
 expect(screen.getByLabelText('Sort ledger')).toHaveValue('amount-desc');
 fireEvent.change(screen.getByLabelText('Sort ledger'),{target:{value:'amount-asc'}});
 await waitFor(()=>expect(api.mock.lastCall?.slice(0,5)).toEqual(['campaign',1,0,'amount','asc']));
});
it('shows loading and retry without inventing reward statuses',async()=>{
 api.mockRejectedValueOnce(Error('offline')).mockResolvedValueOnce(page);render(ui());expect(screen.getByRole('status')).toHaveTextContent('Checking reward status');
 expect(await screen.findByRole('alert')).toHaveTextContent('No payment status is assumed');expect(screen.queryByText('Not claimed')).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Retry reward status'}));expect(within(await screen.findByRole('table')).getByText('Not claimed')).toBeVisible();
});
it('does not leak old-pot rows after selection changes or late responses',async()=>{
 let finish:(v:unknown)=>void=()=>{};api.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;})).mockResolvedValueOnce({...page,rows:[row(3)],total:1});
 const view=render(ui());view.rerender(ui(2));await screen.findByText('Athlete reward 3');finish(page);await waitFor(()=>expect(screen.queryByText('Athlete reward 1')).not.toBeInTheDocument());
});
it('shows a meaningful empty allocation state',async()=>{api.mockResolvedValue({...page,total:0,rows:[],availability:'awaiting_approval'});render(ui());expect(await screen.findByText(/Awaiting approved results/)).toBeVisible();expect(screen.queryByRole('table')).not.toBeInTheDocument();});

it('filters loaded rows without hiding pagination or claiming a global search',async()=>{
 api.mockResolvedValue({...page,total:30});render(ui());await screen.findByRole('table');
 fireEvent.change(screen.getByLabelText('Status on this page'),{target:{value:'claimed'}});
 expect(within(screen.getByRole('table')).getByText('Athlete reward 1')).toBeVisible();
 expect(within(screen.getByRole('table')).queryByText('Athlete reward 2')).not.toBeInTheDocument();
 fireEvent.change(screen.getByLabelText('Search this page'),{target:{value:'missing-reference'}});
 expect(screen.getByRole('status')).toHaveTextContent('0 matching rewards on this page of 2. Filters do not search other pages.');
 expect(screen.getByRole('button',{name:'Next'})).toBeEnabled();expect(api).toHaveBeenCalledTimes(1);
 fireEvent.click(screen.getByRole('button',{name:'Clear filters'}));
 expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(3);
});
