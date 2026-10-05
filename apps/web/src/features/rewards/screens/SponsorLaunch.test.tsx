import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {MemoryRouter, Route, Routes} from 'react-router-dom';
import {beforeEach, expect, it, vi} from 'vitest';
import {I18nProvider} from '@/shared/i18n/I18nProvider';
import {ApiError} from '@/lib/api';
import {createGuidedSetup, addGuidedGroup} from '@raceson/domain/rewards/guided-setup-editor';
import type {SponsorLaunchView} from '@raceson/domain/rewards/sponsor-launch';
import SponsorLaunch from './SponsorLaunch';
const mocks=vi.hoisted(()=>({api:vi.fn(),auth:{user:{id:'owner'},account:{userId:'owner',hasOrganizerAccess:false,hasAthleteAccess:false},session:{access_token:'first'},isLoading:false}}));
vi.mock('@/lib/auth',()=>({useAuth:()=>mocks.auth}));
vi.mock('../data/publicDirectory',()=>({readPublicDirectory:async()=>({items:[]})}));
vi.mock('../data/sponsorLaunch',()=>({sponsorLaunch:mocks.api}));
vi.mock('../components/SponsorFunding',()=>({default:({allocation}:{allocation:import('react').ReactNode})=> <><div>Funding checks</div>{allocation}</>}));
vi.mock('../components/SponsorAllocationRing',()=>({default:()=> <div>Pot chart</div>}));
const id=(n:number)=>`73000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function fixture():SponsorLaunchView{let n=10;const next=()=>id(n++);let configuration=createGuidedSetup(next);
 configuration=addGuidedGroup(configuration,configuration.guided!.pots[0].nodeId,'club_metres',next,null);
 configuration.root.children.forEach((p,i)=>p.shareBps=i===0?10000:0);configuration.root.children[0].children[0].shareBps=10000;
 configuration.context={draftId:id(80),catalogueHash:'c'.repeat(64),roundId:null,editionId:null,programmeName:'Synthetic league',eventName:'All rounds'};
 return {setup:{id:id(1),chainId:10143,revision:3,updatedAt:'2026-09-23T08:00:00.000Z',configuration},launch:null};}
const prepared=(v:SponsorLaunchView):SponsorLaunchView=>({...v,launch:{id:id(2),setup:structuredClone(v.setup),configurationHash:'a'.repeat(64),createdAt:v.setup.updatedAt,state:'prepared'}});
const ui=(hr=false)=><I18nProvider initialLocale={hr?'hr':'en'}><MemoryRouter initialEntries={[`/rewards/campaigns/${id(1)}`]}><Routes><Route path='/rewards/campaigns/:id' element={<SponsorLaunch/>}/></Routes></MemoryRouter></I18nProvider>;
beforeEach(()=>{mocks.api.mockReset();mocks.auth.user={id:'owner'};mocks.auth.account={userId:'owner',hasOrganizerAccess:false,hasAthleteAccess:false};mocks.auth.session={access_token:'first'};});
it('lets a sponsor prepare, reload and inspect a saved launch without pretending it is funded',async()=>{
 const initial=fixture(),saved=prepared(initial);mocks.api.mockResolvedValueOnce(initial).mockResolvedValueOnce(saved).mockResolvedValueOnce(saved);
 const page=render(ui());await waitFor(()=>expect(mocks.api).toHaveBeenCalledTimes(2));
 await screen.findByText('Funding checks');expect(screen.getByText('Rewards saved')).toBeVisible();
 expect(screen.getByText('Funding checks')).toBeVisible();expect(screen.queryByRole('button',{name:'Deposit'})).not.toBeInTheDocument();
 expect(mocks.api.mock.calls[1][1]).toMatchObject({expectedRevision:3});
 fireEvent.click(screen.getByText('Category budgets'));expect(screen.getByRole('heading',{name:'League'})).toBeVisible();expect(screen.queryByRole('button',{name:/Round 1/})).not.toBeInTheDocument();
 page.unmount();render(ui());await screen.findByText('Funding checks');expect(mocks.api).toHaveBeenCalledTimes(3);
});
function torakFixture():SponsorLaunchView{
 const v=fixture(),c=v.setup.configuration;
 c.name='ŠiTrail · Torak Trail';
 c.sponsorSelection={sourceLeagueId:id(81),sourceSeasonId:id(82),eventEditionId:id(83)};
 const league=c.root.children[0],torak=c.root.children[2];
 torak.name='Torak Trail 2026';torak.shareBps=10000;league.shareBps=0;
 torak.children=league.children;league.children=[];
 c.guided!.groups[0].type='athlete_standings';c.guided!.groups[0].method='ranked';
 c.guided!.pots[2].roundId=id(84);
 torak.children[0].rule={basis:'race_position',sharesBps:[10000],source:{draftId:c.context!.draftId,catalogueHash:c.context!.catalogueHash,roundId:id(84),categoryId:id(85)}};
 return v;
}
it('shows only Torak rewards on a single-event launch and reopens the saved scope',async()=>{
 const v=prepared(torakFixture()),original=JSON.stringify(v);mocks.api.mockResolvedValue(v);
 const page=render(ui());await screen.findByText('Funding checks');
 expect(screen.getByRole('button',{name:/Torak Trail 2026/})).toHaveAttribute('aria-pressed','true');
 fireEvent.click(screen.getByText('Category budgets'));expect(screen.getByRole('heading',{name:'Torak Trail 2026'})).toBeVisible();
 expect(screen.queryByRole('button',{name:/League|Round/})).not.toBeInTheDocument();
 fireEvent.click(screen.getByText('Campaign settings & sponsor'));expect(screen.getByRole('link',{name:'Campaign setup'})).toHaveAttribute('href',`/rewards/create?step=5&setup=${id(1)}`);
 expect(JSON.stringify(v)).toBe(original);page.unmount();render(ui());await screen.findByText('Funding checks');
 expect(screen.getByRole('button',{name:/Torak Trail 2026/})).toHaveAttribute('aria-pressed','true');
});
it('keeps allocated league and race pots selectable',async()=>{
 const v=torakFixture(),c=v.setup.configuration;
 c.root.children[0].shareBps=4000;c.root.children[2].shareBps=6000;
 const next=()=>id(99);v.setup.configuration=addGuidedGroup(c,c.root.children[0].id,'club_metres',next,null);
 v.setup.configuration.root.children[0].children[0].shareBps=10000;
 mocks.api.mockResolvedValue(prepared(v));render(ui());await screen.findByText('Funding checks');
 expect(screen.getByRole('button',{name:/League/})).toHaveAttribute('aria-pressed','true');
 fireEvent.click(screen.getByRole('button',{name:/Torak Trail 2026/}));
 expect(screen.getByRole('heading',{name:'Torak Trail 2026'})).toBeVisible();
 expect(screen.queryByRole('button',{name:/Round 1/})).not.toBeInTheDocument();
});
it('uses the frozen launch allocation when the current draft selects another race',async()=>{
 const v=prepared(torakFixture());v.setup=structuredClone(v.setup);v.setup.revision++;
 v.setup.configuration.root.children[2].shareBps=0;v.setup.configuration.root.children[1].shareBps=10000;
 mocks.api.mockResolvedValue(v);render(ui());await screen.findByText(/This launch still preserves version 3/);
 expect(screen.getByRole('button',{name:/Torak Trail 2026/})).toHaveAttribute('aria-pressed','true');
 expect(screen.queryByRole('button',{name:/Round 1/})).not.toBeInTheDocument();
});
it('recovers a lost preparation response using exactly the original request',async()=>{
 const initial=fixture();mocks.api.mockResolvedValueOnce(initial).mockRejectedValueOnce(Error('lost response')).mockResolvedValueOnce(prepared(initial));
 render(ui());await waitFor(()=>expect(mocks.api).toHaveBeenCalledTimes(2));await screen.findByText(/We could not confirm preparation/);
 expect(screen.getByRole('button',{name:'Refresh status'})).toBeDisabled();fireEvent.click(screen.getByRole('button',{name:'Try again'}));
 await screen.findByText('Funding checks');expect(mocks.api.mock.calls[2]).toEqual(mocks.api.mock.calls[1]);
});
it('preserves the frozen version when the editable setup has changed',async()=>{
 const v=prepared(fixture());v.setup={...v.setup,revision:4,configuration:{...v.setup.configuration,budgetMon:'17'}};mocks.api.mockResolvedValue(v);
 render(ui());await screen.findByText(/This launch still preserves version 3/);expect(screen.getByRole('button',{name:'Use latest saved setup'})).toBeVisible();
 expect(screen.getByRole('link',{name:'Review changes'})).toHaveAttribute('href',expect.stringContaining('step=5'));
});
it('clears private launch information on revoked access and does not accept a late prior-session reply',async()=>{
 const initial=fixture();let finish!:(v:SponsorLaunchView)=>void;mocks.api.mockResolvedValueOnce(initial).mockImplementationOnce(()=>new Promise(resolve=>finish=resolve)).mockRejectedValueOnce(new ApiError('revoked',{status:401}));
 const page=render(ui());await waitFor(()=>expect(mocks.api).toHaveBeenCalledTimes(2));
 mocks.auth.user={id:'second'};mocks.auth.account={userId:'second',hasOrganizerAccess:false,hasAthleteAccess:false};mocks.auth.session={access_token:'second'};page.rerender(ui());
 await act(async()=>finish(prepared(initial)));await screen.findByRole('heading',{name:'Sign in to manage this campaign'});expect(screen.queryByText('Saved rules prepared')).not.toBeInTheDocument();
});
it('renders Croatian launch controls and blocks incomplete preparation',async()=>{
 const v=fixture();v.setup.configuration.root.children[0].children[0].shareBps=9999;mocks.api.mockResolvedValue(v);
 render(ui(true));await screen.findByText('Najprije dovršite raspodjelu fondova.');expect(mocks.api).toHaveBeenCalledTimes(1);expect(screen.getByText('Najprije dovršite raspodjelu fondova.')).toBeVisible();
});

it('prevents freezing an unbound launch and exposes recovery for an existing one',async()=>{
 const v=fixture();v.setup.configuration.context=null;mocks.api.mockResolvedValueOnce(v).mockResolvedValueOnce(prepared(v));
 const page=render(ui());await screen.findByText(/This campaign needs its official reward categories/);expect(mocks.api).toHaveBeenCalledTimes(1);
 expect(screen.getByRole('link',{name:'Open campaign setup'})).toHaveAttribute('href',`/rewards/events?setup=${id(1)}`);page.unmount();render(ui());
 expect(await screen.findByRole('button',{name:'Create corrected draft'})).toBeVisible();expect(screen.getByText('Funding checks')).toBeVisible();
});

it.each([403,404])('offers privacy-preserving recovery for unavailable access (%s)',async status=>{
 mocks.api.mockRejectedValue(new ApiError('not found',{status}));render(ui());
 await screen.findByRole('heading',{name:'Campaign unavailable'});
 expect(screen.getByRole('link',{name:'Open my campaigns'})).toHaveAttribute('href','/rewards/manage');
 expect(screen.queryByRole('button',{name:'Try again'})).not.toBeInTheDocument();
 expect(screen.queryByText('Funding checks')).not.toBeInTheDocument();expect(mocks.api).toHaveBeenCalledTimes(1);
});
it('preserves the exact campaign return URL after session expiry',async()=>{
 mocks.api.mockRejectedValue(new ApiError('expired',{status:401}));render(ui());
 const link=await screen.findByRole('link',{name:'Sign in to continue'});
 expect(link).toHaveAttribute('href',`/auth?next=${encodeURIComponent(`/rewards/campaigns/${id(1)}`)}`);
 expect(screen.queryByRole('button',{name:'Try again'})).not.toBeInTheDocument();
});
it('retries a temporary read failure without sending a prepare request',async()=>{
 const v=prepared(fixture());mocks.api.mockRejectedValueOnce(new ApiError('temporarily unavailable',{status:503})).mockResolvedValueOnce(v);
 render(ui());await screen.findByRole('heading',{name:'Campaign could not be loaded'});
 fireEvent.click(screen.getByRole('button',{name:'Try again'}));await screen.findByText('Funding checks');
 expect(mocks.api.mock.calls).toEqual([[id(1)],[id(1)]]);
});
it('renders Croatian unavailable-campaign recovery',async()=>{
 mocks.api.mockRejectedValue(new ApiError('missing',{status:404}));render(ui(true));
 await screen.findByRole('heading',{name:'Kampanja nije dostupna'});
 expect(screen.getByRole('link',{name:'Otvori moje kampanje'})).toHaveAttribute('href','/rewards/manage');
});
