vi.mock('@/lib/auth',()=>({useAuth:()=>({account:{hasOrganizerAccess:access.organizer},user:access.user?{id:access.user}:null})}));
const access=vi.hoisted(()=>({organizer:false,user:''}));
vi.mock('../components/PublicRewardTable',()=>({default:({title,subtitle}:{title:string;subtitle:string})=> <div><h3>{title}</h3><p>{subtitle}</p>Individual rewards table</div>}));

import {fireEvent,render,screen,within} from '@testing-library/react';
import {MemoryRouter,Route,Routes,useLocation} from 'react-router-dom';
import {beforeEach,expect,it,vi} from 'vitest';
import {I18nProvider} from '@/shared/i18n/I18nProvider';
import {ApiError} from '@/lib/api';
import PublicSponsorCampaign from './PublicSponsorCampaign';
const api=vi.hoisted(()=>vi.fn());vi.mock('../data/publicCampaign',()=>({readPublicCampaign:api,readPublicRewards:async()=>({total:0,rows:[]})}));
const pot=(slot:number,name:string)=>({slot,name,amountWei:'5000000000000000000',state:1,paused:false,allocatedWei:'0',paidWei:'0',remainingWei:'5000000000000000000',returnedWei:'0',claimDeadline:'0',groups:[{name:'Standings',amountWei:'5000000000000000000'}]});
const campaign={id:'campaign',name:'Synthetic league',chainId:10143,budgetWei:'10000000000000000000',address:'0x'+'11'.repeat(20),fundingHash:'0x'+'aa'.repeat(32),blockNumber:'100',blockTimestamp:'1800000000',pots:[pot(0,'League'),pot(1,'Round 1')]};
const LocationProbe=()=> <output aria-label="Current URL">{useLocation().search}</output>;
const ui=(query='')=> <I18nProvider initialLocale="en"><MemoryRouter initialEntries={['/rewards/campaigns/campaign/public'+query]}><LocationProbe/><Routes><Route path="/rewards/campaigns/:id/public" element={<PublicSponsorCampaign/>}/></Routes></MemoryRouter></I18nProvider>;
beforeEach(()=>{api.mockReset();access.organizer=false;access.user='';});
it('shows a funded campaign to guests and lets them inspect each pot without claiming awards are paid',async()=>{
 api.mockResolvedValue(campaign);render(ui());await screen.findByRole('heading',{name:'Synthetic league'});
 expect(screen.getByText('Confirmed funding')).toBeVisible();expect(screen.getAllByText('Awaiting results review').length).toBeGreaterThan(0);
 expect(screen.getByRole('heading',{name:'Payment progress'})).toBeVisible();
 expect(screen.getByRole('img',{name:/Payment progress.*Paid: 0 test MON; Held in contract: 5 test MON; Returned: 0 test MON/})).toBeVisible();
 expect(screen.queryByRole('heading',{name:'Confirmed payments'})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:/Round 1/}));
 expect(within(screen.getByRole('region',{name:'Selected prize pot'})).getByText('Round 1')).toBeVisible();
 expect(screen.queryByRole('button',{name:/deposit|wallet|claim/i})).not.toBeInTheDocument();
});
it('retains labeled verified data on refresh failure and supports retry',async()=>{
 api.mockResolvedValueOnce(campaign).mockRejectedValueOnce(Error('rpc offline')).mockResolvedValueOnce(campaign);render(ui());await screen.findByText('Confirmed funding');
 fireEvent.click(screen.getByRole('button',{name:'Refresh status'}));expect(await screen.findByRole('alert')).toHaveTextContent('last verified status');expect(screen.getByRole('heading',{name:'Synthetic league'})).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'Refresh status'}));await screen.findByRole('button',{name:'Refresh status'});
});
it('does not show unpublished campaigns and recovers after retry',async()=>{
 api.mockRejectedValueOnce(new ApiError('missing',{status:404})).mockResolvedValueOnce(campaign);render(ui());expect(await screen.findByRole('alert')).toHaveTextContent('has not completed setup');
 fireEvent.click(screen.getByRole('button',{name:'Try again'}));await screen.findByText('Confirmed funding');
});

it('keeps results review and controller signing links bound to the selected pot',async()=>{
 access.organizer=true;api.mockResolvedValue(campaign);render(ui());await screen.findByText('Confirmed funding');
 fireEvent.click(screen.getByText('RacesOn team · confirm results'));
 expect(screen.getByRole('link',{name:/Review & sign in Rewards Control/})).toHaveAttribute('href','/rewards/control?campaign=campaign&pot=0');
 fireEvent.click(screen.getByRole('button',{name:/Round 1/}));
 expect(screen.getByRole('link',{name:/Review & sign in Rewards Control/})).toHaveAttribute('href','/rewards/control?campaign=campaign&pot=1');
 expect(screen.getByRole('link',{name:'Review official results'})).toHaveAttribute('href','/rewards/manage/campaigns/campaign?pot=1');
 fireEvent.click(screen.getByText('Receipts & verification'));expect(screen.getByText(/Approval is separate from payment/)).toBeVisible();
});

it('sorts category budgets numerically and keeps category colors attached after reordering',async()=>{
 const groups=[{name:'Zulu',amountWei:'900000000000000000'},{name:'Alpha',amountWei:'100000000000000000'},{name:'Middle',amountWei:'0'}];
 api.mockResolvedValue({...campaign,pots:[{...pot(0,'League'),groups}]});render(ui());await screen.findByText('Confirmed funding');
 expect(screen.getByText('Saved category budgets',{selector:'summary span'}).closest('details')).toHaveAttribute('open');
 const table=screen.getByRole('table',{name:'Saved category budgets'});
 const rows=()=>within(table).getAllByRole('row').slice(1).map(row=>within(row).getAllByRole('cell')[0].textContent);
 const swatch=within(table).getByText('Zulu').querySelector('i')!;
 const color=swatch.style.background;
 expect(rows()).toEqual(['Zulu','Alpha','Middle']);
 fireEvent.click(within(table).getByRole('button',{name:'Budget'}));expect(rows()).toEqual(['Middle','Alpha','Zulu']);
 expect(within(table).getByRole('columnheader',{name:'Budget'})).toHaveAttribute('aria-sort','ascending');
 fireEvent.click(within(table).getByRole('button',{name:'Category'}));expect(rows()).toEqual(['Alpha','Middle','Zulu']);
 expect(within(table).getByText('Zulu').querySelector('i')!.style.background).toBe(color);
 fireEvent.click(within(table).getByRole('button',{name:'Category'}));expect(rows()).toEqual(['Zulu','Middle','Alpha']);
 expect(within(table).getByText('0.9 test MON')).toBeVisible();
});

it.each(['?pot=999','?pot=','?pot=01','?pot=bad','?pot=0&pot=1'])('does not substitute a different pot for invalid selection %s',async query=>{
 access.organizer=true;api.mockResolvedValue(campaign);render(ui(query));
 expect(await screen.findByRole('alert')).toHaveTextContent('Prize pot not found');
 expect(screen.getByText('Confirmed funding')).toBeVisible();
 expect(screen.getByLabelText('Current URL')).toHaveTextContent(query);
 expect(screen.queryByRole('region',{name:'Selected prize pot'})).not.toBeInTheDocument();
 expect(screen.queryByRole('heading',{name:'Payment progress'})).not.toBeInTheDocument();
 expect(screen.queryByText('RacesOn team · confirm results')).not.toBeInTheDocument();
 expect(screen.queryByRole('link',{name:'Review official results'})).not.toBeInTheDocument();
 expect(screen.queryByRole('link',{name:/Review & sign/})).not.toBeInTheDocument();
 expect(within(screen.getByRole('group',{name:'Prize pots'})).getAllByRole('button').every(b=>b.getAttribute('aria-pressed')==='false')).toBe(true);
});
it('recovers an invalid link only after an explicit pot choice and preserves other query values',async()=>{
 access.organizer=true;api.mockResolvedValue(campaign);render(ui('?pot=999&from=campaigns'));await screen.findByRole('alert');
 fireEvent.click(screen.getByRole('button',{name:/Round 1/}));
 expect(screen.queryByRole('alert')).not.toBeInTheDocument();
 expect(screen.getByLabelText('Current URL')).toHaveTextContent('?pot=1&from=campaigns');
 expect(within(screen.getByRole('region',{name:'Selected prize pot'})).getByText('Round 1')).toBeVisible();
 fireEvent.click(screen.getByText('RacesOn team · confirm results'));
 expect(screen.getByRole('link',{name:'Review official results'})).toHaveAttribute('href','/rewards/manage/campaigns/campaign?pot=1');
 expect(screen.getByRole('link',{name:/Review & sign/})).toHaveAttribute('href','/rewards/control?campaign=campaign&pot=1');
 expect(api).toHaveBeenCalledTimes(1);
});
it('opens a valid deep-linked pot directly',async()=>{
 api.mockResolvedValue(campaign);render(ui('?pot=1'));
 const region=await screen.findByRole('region',{name:'Selected prize pot'});
 expect(within(region).getByText('Round 1')).toBeVisible();
 expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('does not reload public accounting when the sponsor branding identity changes',async()=>{
 api.mockResolvedValue(campaign);const view=render(ui());await screen.findByText('Confirmed funding');
 access.user='synthetic-sponsor';view.rerender(ui());
 expect(screen.getByRole('heading',{name:'Synthetic league'})).toBeVisible();
 expect(screen.getByRole('img',{name:/Payment progress of the selected prize pool/})).toBeVisible();
 expect(api).toHaveBeenCalledTimes(1);
});
