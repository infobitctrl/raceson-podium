import {fireEvent,render,screen,within,waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {beforeEach,expect,it,vi} from 'vitest';
import PublicRewardTable from './PublicRewardTable';
const api=vi.hoisted(()=>vi.fn());vi.mock('../data/publicCampaign',()=>({readPublicRewards:api}));
const row=(n:number,status='unclaimed')=>({id:'0x'+String(n).padStart(64,'0'),number:n,kind:'athlete',amountWei:'3000000000000000',status});
const page={total:2,offset:0,rows:[row(1,'claimed'),row(2)],availability:'open',blockNumber:'100',blockTimestamp:'1800000000'};
const ui=(slot=1,refresh=0)=><MemoryRouter><PublicRewardTable key={slot} id="campaign" slot={slot} hr={false} refresh={refresh}/></MemoryRouter>;
beforeEach(()=>api.mockReset());
it('links paid athlete and club names to their public recipients without guessing member-club wallets',async()=>{
 const address='0x'+'12'.repeat(20),treasury='0x'+'34'.repeat(20);
 api.mockResolvedValue({...page,chainId:10143,total:3,rows:[
  {...row(1,'claimed'),recipientAddress:address,display:{name:'Paid athlete',club:'Member club',timeMs:null}},
  {...row(2),display:{name:'Unpaid athlete',club:null,timeMs:null}},
  {...row(3,'claimed'),kind:'club',recipientAddress:treasury,display:{name:'Paid club',club:null,timeMs:null}},
 ]});
 render(ui());const athlete=await screen.findByRole('link',{name:'Paid athlete'}),club=screen.getByRole('link',{name:'Paid club'});
 expect(athlete).toHaveAttribute('href',`https://testnet.monadvision.com/address/${address}?tab=Internal+Transaction`);
 expect(club).toHaveAttribute('href',`https://testnet.monadvision.com/address/${treasury}?tab=Internal+Transaction`);
 for(const link of [athlete,club]){expect(link).toHaveAttribute('target','_blank');expect(link).toHaveAttribute('rel','noopener noreferrer');}
 expect(screen.queryByRole('link',{name:'Unpaid athlete'})).not.toBeInTheDocument();
 expect(screen.queryByRole('link',{name:'Member club'})).not.toBeInTheDocument();
});
it('links registered unclaimed athletes and clubs while keeping status and walletless names unchanged',async()=>{
 const address='0x'+'12'.repeat(20),treasury='0x'+'34'.repeat(20);
 api.mockResolvedValue({...page,chainId:10143,total:3,rows:[
  {...row(1),registeredAddress:address,display:{name:'Registered athlete',club:'Member club',timeMs:null}},
  {...row(2),kind:'club',registeredAddress:treasury,display:{name:'Registered club',club:null,timeMs:null}},
  {...row(3),display:{name:'Walletless athlete',club:null,timeMs:null}},
 ]});
 render(ui());const athlete=await screen.findByRole('link',{name:'Registered athlete'}),club=screen.getByRole('link',{name:'Registered club'});
 for(const [link,wallet] of [[athlete,address],[club,treasury]] as const){
  expect(link).toHaveAttribute('href',`https://testnet.monadvision.com/address/${wallet}?tab=Internal+Transaction`);
  expect(link).toHaveAttribute('target','_blank');expect(link).toHaveAttribute('rel','noopener noreferrer');
  expect(link.closest('tr')).toHaveTextContent('Unclaimed');expect(link.closest('tr')).toHaveTextContent('0.003');
 }
 expect(screen.queryByRole('link',{name:'Walletless athlete'})).not.toBeInTheDocument();
 expect(screen.queryByRole('link',{name:'Member club'})).not.toBeInTheDocument();
});
it.each([false,true])('rounds athlete and club rewards while sorting exact amounts (hr=%s)',async hr=>{
 const smaller={...row(2),amountWei:'3495104000000000'},larger={...row(1),amountWei:'3495105000000000'};
 api.mockResolvedValue({...page,total:3,rows:[smaller,larger,{...row(3),kind:'club',amountWei:'999995000000000000'}]});
 render(<MemoryRouter><PublicRewardTable id="campaign" slot={1} hr={hr} refresh={0}/></MemoryRouter>);
 const athletes=await screen.findByRole('table',{name:hr?'Nagrade sportaša':'Athlete rewards'});
 expect(within(athletes).getAllByText(hr?'0,0035':'0.0035')).toHaveLength(2);
 const clubs=screen.getByRole('table',{name:hr?'Nagrade klubova':'Club rewards'});
 expect(within(clubs).getByText('1')).toHaveTextContent('1 test MON');
 fireEvent.click(within(athletes).getByRole('button',{name:hr?'Nagrade':'Rewards'}));
 expect(within(athletes).getAllByRole('rowheader').map(e=>e.textContent)).toEqual(hr?['Nagrada sportaša 1','Nagrada sportaša 2']:['Athlete reward 1','Athlete reward 2']);
 expect(larger.amountWei).toBe('3495105000000000');
});
it('shows every reward with distinct claim status and hides private identities',async()=>{
 api.mockResolvedValue(page);render(ui());const table=await screen.findByRole('table',{name:'Athlete rewards'});
 expect(within(table).getByText('Claimed')).toBeVisible();expect(within(table).getByText('Unclaimed')).toBeVisible();expect(within(table).getAllByRole('row')).toHaveLength(3);
 fireEvent.click(screen.getByText('Claims open',{selector:'summary'}));expect(screen.getByText(/Each recipient must claim/)).toBeVisible();expect(screen.getByRole('link',{name:'Claim my rewards →'})).toHaveAttribute('href','/athlete/rewards');
});
it('keeps clubs in a separate ledger and sorts and paginates the complete athlete ledger',async()=>{
 const all=Array.from({length:31},(_,i)=>({...row(i+1,i===29?'claimed':'unclaimed'),amountWei:String(i+1),kind:i===30?'club':'athlete',display:{name:i===30?'Demo club':'Runner '+(i+1),club:i===30?null:'Running club',timeMs:i===30?null:String((i+1)*1000)},breakdown:[{category:'Open',place:i+1,amountWei:String(i+1)}]}));
 api.mockImplementation(async(_id,_slot,offset)=>({...page,total:31,offset,rows:all.slice(offset,offset+500)}));
 render(ui());await screen.findByText('Runner 1');expect(api).toHaveBeenCalledOnce();
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
 expect(api).toHaveBeenCalledOnce();
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
 api.mockImplementation(async(_id,_slot,offset)=>({...page,total:30,offset,rows:all.slice(offset,offset+500)}));render(ui());await screen.findByRole('table',{name:'Athlete rewards'});
 fireEvent.change(screen.getByLabelText('Athlete rewards · Reward status'),{target:{value:'claimed'}});
 expect(within(screen.getByRole('table',{name:'Athlete rewards'})).getByText('Athlete reward 30')).toBeVisible();
 expect(screen.queryByRole('button',{name:'Next'})).not.toBeInTheDocument();
 fireEvent.change(screen.getByLabelText('Athlete rewards · Search rewards'),{target:{value:'missing-reference'}});
 expect(screen.getByText('0 matching rewards of 30.')).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'Clear filters'}));expect(within(screen.getByRole('table',{name:'Athlete rewards'})).getAllByRole('row')).toHaveLength(26);
});
it('fails closed when a response is incomplete instead of rendering a partial distribution',async()=>{
 api.mockResolvedValue({...page,total:30,rows:Array.from({length:25},(_,i)=>row(i+1))});render(ui());
 expect(await screen.findByRole('alert')).toHaveTextContent('No payment status is assumed');expect(screen.queryByRole('table')).not.toBeInTheDocument();
});

it('defaults to ascending position and combines exact category filters with search and status independently per ledger',async()=>{
 const athletes=Array.from({length:30},(_,i)=>({...row(i+1,i===28?'claimed':'unclaimed'),breakdown:[{category:i===29?'Open masters':'Open',place:30-i,amountWei:'3000000000000000'}]}));
 const clubs=[3,1,2].map((place,i)=>({...row(31+i),kind:'club',breakdown:[{category:'Combined clubs',place,amountWei:'3000000000000000'}]}));
 const all=[...athletes,...clubs];api.mockImplementation(async(_id,_slot,offset)=>({...page,total:all.length,offset,rows:all.slice(offset,offset+500)}));
 render(ui());const table=await screen.findByRole('table',{name:'Athlete rewards'}),club=screen.getByRole('table',{name:'Club rewards'});
 const names=()=>within(table).getAllByRole('rowheader').map(h=>h.textContent);
 const categories=screen.getByRole('group',{name:'Athlete rewards · Category filters'});
 expect(within(table).getByRole('columnheader',{name:'Position'})).toHaveAttribute('aria-sort','ascending');
 expect(names()[0]).toBe('Athlete reward 30');
 expect(within(club).getAllByRole('rowheader').map(h=>h.textContent)).toEqual(['Club reward 32','Club reward 33','Club reward 31']);
 fireEvent.click(screen.getByRole('button',{name:'Next'}));
 fireEvent.click(within(categories).getByRole('button',{name:'Open',exact:true}));
 expect(names()[0]).toBe('Athlete reward 29');expect(names()).toHaveLength(25);
 expect(screen.getByRole('button',{name:'Previous'})).toBeDisabled();
 expect(within(categories).getByRole('button',{name:'Open',exact:true})).toHaveAttribute('aria-pressed','true');
 expect(screen.getByText('29 matching rewards of 30.')).toBeVisible();
 fireEvent.change(screen.getByLabelText('Athlete rewards · Reward status'),{target:{value:'claimed'}});
 expect(names()).toEqual(['Athlete reward 29']);
 fireEvent.change(screen.getByLabelText('Athlete rewards · Search rewards'),{target:{value:'missing'}});
 expect(within(table).queryAllByRole('rowheader')).toHaveLength(0);
 fireEvent.click(screen.getByRole('button',{name:'Clear filters'}));
 expect(names()[0]).toBe('Athlete reward 30');
 expect(within(categories).getByRole('button',{name:'All categories'})).toHaveAttribute('aria-pressed','true');
 expect(within(club).getAllByRole('rowheader')).toHaveLength(3);expect(api).toHaveBeenCalledOnce();
});

it('retains the complete ledger and its verification time while refreshing and after failure',async()=>{
 api.mockResolvedValueOnce(page).mockReturnValueOnce(new Promise(()=>{})).mockRejectedValueOnce(Error('offline'));
 const view=render(ui());await screen.findByRole('table',{name:'Athlete rewards'});
 view.rerender(ui(1,1));
 expect(screen.getByRole('table',{name:'Athlete rewards'})).toBeVisible();
 expect(screen.getByText(/Rewards last verified/)).toHaveTextContent('Showing saved status');
 expect(screen.getByText('Checking reward status…')).toBeVisible();
 view.rerender(ui(1,2));expect(await screen.findByRole('alert')).toHaveTextContent('last verified rewards');
 expect(screen.getByRole('table',{name:'Athlete rewards'})).toBeVisible();
});
