import {ApiError} from "@/lib/api";
import {createGuidedSetup,addGuidedGroup} from "@raceson/domain/rewards/guided-setup-editor";
import {act,fireEvent,render,screen,waitFor,within} from "@testing-library/react";
import {MemoryRouter,useLocation,Route,Routes} from "react-router-dom";
import {beforeEach,expect,it,vi} from "vitest";
import {I18nProvider} from "@/shared/i18n/I18nProvider";
import SponsorCampaignEntry from "./SponsorCampaignEntry";
import {sponsorLink,sponsorDemoSource} from "../model/sponsorOpportunities";
import {sponsorPreparedSource} from "../model/sponsorPreparedSource";
import {publishedSnapshot,id} from "../../../../../../apps/api/test/fixtures/published-reward-v2.mjs";
const mocks=vi.hoisted(()=>({signedIn:false,session:{access_token:"test-only"},save:vi.fn(),read:vi.fn(),sources:vi.fn(),resolve:vi.fn()}));
vi.mock("../data/sponsorSource",()=>({resolveSponsorSource:mocks.resolve}));
vi.mock("@/lib/auth",()=>({useAuth:()=>({isLoading:false,user:mocks.signedIn?{id:"athlete"}:null,session:mocks.signedIn?mocks.session:null,account:{userId:"athlete",hasOrganizerAccess:false}})}));
vi.mock("../data/planningDrafts",()=>({listPlanningDrafts:mocks.sources,readPlanningDraft:mocks.sources}));
vi.mock("../data/sourceMapping",()=>({readSourceMapping:mocks.sources}));
vi.mock("../data/distributionSetups",()=>({saveRewardSetup:mocks.save,readRewardSetup:mocks.read,listRewardSetups:vi.fn()}));
vi.mock("recharts",async original=>({...await original<typeof import("recharts")>(),ResponsiveContainer:({children}:{children:React.ReactNode})=><div>{children}</div>}));
function LocationProbe(){const location=useLocation();return <output aria-label="Current route">{location.pathname}</output>;}
const view=(url="/rewards/create?opportunity=league")=><I18nProvider initialLocale="en"><MemoryRouter initialEntries={[url]}><Routes><Route path="/rewards/create" element={<SponsorCampaignEntry/>}/><Route path="*" element={null}/></Routes><LocationProbe/></MemoryRouter></I18nProvider>;
beforeEach(()=>{sessionStorage.clear();mocks.signedIn=false;mocks.save.mockReset();mocks.read.mockReset();mocks.sources.mockReset();mocks.resolve.mockReset();});
const step=(name:string)=>fireEvent.click(screen.getByRole('navigation',{name:'Campaign sections'}).querySelector(`button:nth-child(${name==='budget'?1:name==='rules'?2:3})`)!);
const enable=async(name:string)=>fireEvent.click(await screen.findByRole('checkbox',{name:new RegExp('^'+name+'(?: Individual| Club)?$')}));
const draft=()=>fireEvent.click(screen.getByText('Draft reward categories'));
const budget=(value='100')=>{step('budget');fireEvent.change(screen.getByLabelText('Total budget · test MON'),{target:{value}});};
const leagueOnly=()=>fireEvent.change(screen.getByLabelText('League %'),{target:{value:'100'}});
const source=()=>{const catalogue=publishedSnapshot().catalogue,context={draftId:id(90),catalogueHash:'a'.repeat(64),roundId:null,editionId:null,programmeName:'Selected league',eventName:'Selected league'};mocks.resolve.mockResolvedValue({schema:'raceson-sponsor-source-v4',...sponsorDemoSource,eventEditionId:null,context,catalogue,selectedRoundId:null,selectedSlot:null,categoryPresets:{}});return {catalogue,context};};
function saveRecords(){let record:unknown;mocks.save.mockImplementation(async(setupId,request)=>(record={id:setupId,revision:1,configuration:request.configuration}));mocks.read.mockImplementation(async()=>record);}
it('connects the selected event and official category when saving a sponsor draft',async()=>{
 mocks.signedIn=true;const {catalogue,context}=source();saveRecords();render(view(sponsorLink()));budget();step('rules');
 const category=catalogue.categories[0];await enable(`${category.competitionName} · ${category.name}`);
 fireEvent.click(screen.getByRole('button',{name:'Save draft'}));await waitFor(()=>expect(mocks.save).toHaveBeenCalledOnce());
 const saved=mocks.save.mock.calls[0][1].configuration;expect(saved.budgetMon).toBe('100');expect(saved.context).toEqual(context);
 expect(saved.root.children[0].children[0].rule.source).toEqual({draftId:context.draftId,catalogueHash:context.catalogueHash,roundId:null,categoryId:category.id});expect(mocks.sources).not.toHaveBeenCalled();
});
it('preserves guest budget and inline prize choices through sign-in',async()=>{
 const page=render(view());budget('25000');step('rules');draft();await enable('Short course · Women');
 fireEvent.change(screen.getByLabelText('Short course · Women prize positions'),{target:{value:'5'}});
 const link=screen.getByRole('link',{name:/Sign in/});const next=new URL(link.getAttribute('href')!,'http://local').searchParams.get('next')!;fireEvent.click(link);
 expect(mocks.save).not.toHaveBeenCalled();page.unmount();mocks.signedIn=true;render(view(next));
 fireEvent.click(await screen.findByRole('button',{name:'Short course · Women Individual'}));expect(screen.getByLabelText('Short course · Women prize positions')).toHaveValue(5);budget('25000');expect(screen.getByLabelText('Total budget · test MON')).toHaveValue('25000');expect(mocks.sources).not.toHaveBeenCalled();
});
it('saves athlete-owned draft economics without inventing official sources',async()=>{
 mocks.signedIn=true;saveRecords();render(view());budget();fireEvent.change(screen.getByLabelText('League %'),{target:{value:'40'}});step('rules');fireEvent.change(screen.getByLabelText('Reward pot'),{target:{value:'5'}});draft();await enable('Long course · Men');
 fireEvent.click(screen.getByRole('button',{name:'Save draft'}));await screen.findAllByText(/Saved to your account/);
 const c=mocks.save.mock.calls[0][1].configuration;expect(c.context).toBeNull();expect(c.root.children.map((n:{shareBps:number})=>n.shareBps)).toEqual([4000,1200,1200,1200,1200,1200]);expect(c.root.children[5].children[0].rule.source).toBeNull();expect(c.guided.groups[0].eligibilityApproved).toBe(false);
 await waitFor(()=>expect(mocks.read).toHaveBeenCalled());await screen.findByRole('checkbox',{name:'Include Long course · Men'});step('review');expect(screen.getByRole('button',{name:'Continue to funding'})).toBeDisabled();
});
it('toggles independent categories with preserved normalized shares',async()=>{
 render(view());budget();step('rules');draft();await enable('Short course · Women');await enable('Long course · Men');
 expect(screen.getByLabelText('Short course · Women budget %')).toHaveValue(50);expect(screen.getByLabelText('Long course · Men budget %')).toHaveValue(50);
 fireEvent.click(screen.getByRole('checkbox',{name:'Include Long course · Men'}));expect(screen.getByLabelText('Short course · Women budget %')).toHaveValue(100);await enable('Long course · Men');expect(screen.getByLabelText('Long course · Men budget %')).toHaveValue(50);
});
it('keeps club and contribution categories available with independent rules',async()=>{
 render(view());budget();step('rules');await enable('Club standings');await enable('Completed rounds');await enable('Athlete kilometres');await enable('Club kilometres');
 for(const name of ['Club standings','Athlete finishes','Athlete kilometres','Club kilometres'])expect(screen.getByRole('checkbox',{name:`Include ${name}`})).toBeChecked();
 fireEvent.click(screen.getByRole('checkbox',{name:'Include Athlete kilometres'}));expect(screen.queryByRole('checkbox',{name:'Include Athlete kilometres'})).not.toBeInTheDocument();expect(screen.getByRole('checkbox',{name:'Include Club kilometres'})).toBeChecked();expect(mocks.sources).not.toHaveBeenCalled();
});
it('keeps locked category allocations fixed while balancing other shares',async()=>{
 render(view());budget();step('rules');draft();await enable('Short course · Women');await enable('Long course · Men');
 fireEvent.change(screen.getByLabelText('Short course · Women budget %'),{target:{value:'40'}});
 const first=within(screen.getByRole('region',{name:'Short course · Women'}));fireEvent.click(first.getByText('Advanced reward settings'));
 await waitFor(()=>expect(first.getByRole('button',{name:'Lock Short course · Women'})).toBeVisible());fireEvent.click(first.getByRole('button',{name:'Lock Short course · Women'}));
 expect(first.getByRole('checkbox',{name:'Include Short course · Women'})).toBeDisabled();await enable('Club standings');expect(screen.getByLabelText('Long course · Men budget %')).toHaveValue(30);expect(screen.getByLabelText('Club standings budget %')).toHaveValue(30);
});
it('saves balanced unbound economics as a draft without launching',async()=>{
 mocks.signedIn=true;saveRecords();render(view());budget();leagueOnly();step('rules');draft();await enable('Short course · Women');step('review');fireEvent.click(screen.getByRole('button',{name:'Save rules and continue to funding'}));
 await screen.findByText('Draft saved. Connect the official event and reward categories before launch.');expect(screen.queryByRole('link',{name:'Continue to launch'})).not.toBeInTheDocument();expect(mocks.save.mock.calls[0][1].configuration.stage).toBe('draft');expect(mocks.sources).not.toHaveBeenCalled();
});
it('copies rules only to explicitly selected rounds',async()=>{
 mocks.signedIn=true;saveRecords();render(view());budget();step('rules');fireEvent.change(screen.getByLabelText('Reward pot'),{target:{value:'1'}});draft();await enable('Short course · Women');fireEvent.change(screen.getByLabelText('Short course · Women prize positions'),{target:{value:'5'}});
 fireEvent.click(screen.getByText('Apply rules to more categories or rounds'));const scope=within(screen.getByRole('region',{name:'Races using this distribution'}));expect(scope.getAllByRole('checkbox')).toHaveLength(5);fireEvent.click(scope.getByRole('checkbox',{name:/Šubićevac Trail/}));fireEvent.click(scope.getByRole('button',{name:'Apply to 4 races'}));
 fireEvent.click(screen.getByRole('button',{name:'Save draft'}));await waitFor(()=>expect(mocks.save).toHaveBeenCalledOnce());const c=mocks.save.mock.calls[0][1].configuration;expect(c.root.children.map((p:{children:unknown[]})=>p.children.length)).toEqual([0,1,1,1,1,0]);expect(c.root.children[2].children[0].rule.sharesBps).toHaveLength(5);expect(c.guided.groups.every((g:{eligibilityApproved:boolean})=>!g.eligibilityApproved)).toBe(true);
});
it('requires authentication before reading a private saved campaign',()=>{
 const target='/rewards/create?setup=72000000-0000-4000-8000-000000000001&step=3';render(view(target));expect(screen.getByRole('heading',{name:'Sign in to open your saved setup'})).toBeVisible();expect(mocks.read).not.toHaveBeenCalled();expect(new URL(screen.getByRole('link',{name:'Sign in & open programme'}).getAttribute('href')!,'http://local').searchParams.get('next')).toBe(target);
});
it('cannot launch balanced saved rules with an unavailable official catalogue',async()=>{
 mocks.signedIn=true;let seq=6000;const next=()=>id(seq++);let c=createGuidedSetup(next);c=addGuidedGroup(c,c.guided!.pots[0].nodeId,'athlete_standings',next,null);c.root.children.forEach((p,i)=>p.shareBps=i?0:10000);c.root.children[0].children[0].shareBps=10000;c.sponsorSelection={...sponsorDemoSource,eventEditionId:'f26fe1b0-ea95-b5c6-772d-739d54377d9d'};mocks.read.mockResolvedValue({id:id(800),revision:1,configuration:c});mocks.resolve.mockRejectedValue(new ApiError('Missing',{status:404,code:'reward_sponsor_source_not_found'}));render(view(`/rewards/create?setup=${id(800)}&step=5`));await screen.findByText(/This event’s sponsorship catalogue is not available yet/);expect(screen.getByRole('button',{name:'Continue to funding'})).toBeDisabled();fireEvent.click(screen.getByRole('button',{name:'Check again'}));await waitFor(()=>expect(mocks.resolve).toHaveBeenCalledTimes(2));expect(mocks.save).not.toHaveBeenCalled();
});
it.each([false,true])('finishes connected rules with exact terms and safely retries a lost response (%s)',async(lost)=>{
 mocks.signedIn=true;const {catalogue}=source();saveRecords();if(lost)mocks.save.mockRejectedValueOnce(Error('Lost response'));render(view(sponsorLink()));budget();leagueOnly();fireEvent.change(screen.getByLabelText('Claim window (days)'),{target:{value:'30'}});fireEvent.click(screen.getByRole('radio',{name:/Back to.*sponsor wallet/i}));step('rules');const category=catalogue.categories[0];await enable(`${category.competitionName} · ${category.name}`);step('review');fireEvent.click(screen.getByRole('button',{name:'Save rules and continue to funding'}));if(lost)fireEvent.click(await screen.findByRole('button',{name:'Retry save'}));await waitFor(()=>expect(screen.getByLabelText('Current route')).toHaveTextContent('/rewards/campaigns/'));expect(mocks.save).toHaveBeenCalledTimes(lost?2:1);if(lost)expect(mocks.save.mock.calls[1]).toEqual(mocks.save.mock.calls[0]);expect(mocks.save.mock.calls[0][1].configuration.policy).toMatchObject({claimWindowDays:30,treasuryReturn:'original_sender',fewerFinishers:'selected_return'});
});
it('limits track sponsorship to its official categories and preserves it through saved reload',async()=>{
 mocks.signedIn=true;const {catalogue,context}=source(),round=catalogue.rounds[3],track=round.races[0];const selection={...sponsorDemoSource,eventEditionId:'f26fe1b0-ea95-b5c6-772d-739d54377d9d',raceId:track.id};mocks.resolve.mockResolvedValue({schema:'raceson-sponsor-source-v4',...selection,context,catalogue,selectedRoundId:round.id,selectedSlot:4,categoryPresets:{}});saveRecords();const page=render(view(`${sponsorLink('round-4')}&raceId=${track.id}`));budget('123.45');step('rules');const category=catalogue.categories.find(c=>c.target==='individual'&&c.competitionId===track.competitionId)!;const label=`${category.competitionName} · ${category.name}`;await enable(label);fireEvent.change(screen.getByLabelText(`${label} prize positions`),{target:{value:'5'}});for(const cat of catalogue.categories.filter(c=>c.competitionId!==track.competitionId))expect(screen.queryByRole('checkbox',{name:`${cat.competitionName} · ${cat.name} Individual`})).not.toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'Save draft'}));await screen.findAllByText(/Saved to your account/);const saved=mocks.save.mock.calls[0][1].configuration;expect(saved.sponsorSelection).toEqual(selection);expect(saved.root.children.map((p:{shareBps:number})=>p.shareBps)).toEqual([0,0,0,0,10000,0]);expect(saved.root.children[4].children[0].rule.source.categoryId).toBe(category.id);const savedId=mocks.save.mock.calls[0][0];page.unmount();render(view(`/rewards/create?setup=${savedId}&step=3`));fireEvent.click(await screen.findByRole('button',{name:`${label} Individual`}));expect(screen.getByLabelText(`${label} prize positions`)).toHaveValue(5);
});
it('shows prepared guest categories without enabling or binding rewards',()=>{
 const track=sponsorPreparedSource.rounds[3].tracks[0];render(view(sponsorLink('round-4',null,track.raceId)));budget();step('rules');expect(within(screen.getByRole('region',{name:'Official reward category preview'})).getAllByRole('listitem').map(n=>n.textContent)).toEqual(['Female','Male']);expect(screen.queryByRole('checkbox',{name:/Female/})).not.toBeInTheDocument();step('review');expect(screen.getByRole('button',{name:'Save rules and continue to funding'})).toBeDisabled();expect(mocks.resolve).not.toHaveBeenCalled();
});
it('keeps guest drafts separate for different tracks',()=>{
 const round=publishedSnapshot().catalogue.rounds[3],first=`${sponsorLink('round-4')}&raceId=${round.races[0].id}`,second=`${sponsorLink('round-4')}&raceId=${id(7001)}`;const a=render(view(first));budget('111');a.unmount();const b=render(view(second));expect(screen.getByLabelText('Total budget · test MON')).not.toHaveValue('111');budget('222');b.unmount();const c=render(view(first));expect(screen.getByLabelText('Total budget · test MON')).toHaveValue('111');c.unmount();render(view(second));expect(screen.getByLabelText('Total budget · test MON')).toHaveValue('222');
});
it('keeps saved rules immutable and all funded pots inspectable without saving',async()=>{
 mocks.signedIn=true;let seq=8100;const next=()=>id(seq++);let c=createGuidedSetup(next);c=addGuidedGroup(c,c.guided!.pots[0].nodeId,'club_standings',next,null);c=addGuidedGroup(c,c.guided!.pots[1].nodeId,'athlete_standings',next,null);c.root.children.forEach((p,i)=>p.shareBps=i<2?5000:0);c.root.children[0].children[0].name='Saved club category';c.root.children[1].children[0].name='Saved round category';c.sponsorSelection={...sponsorDemoSource,eventEditionId:null};const original=structuredClone(c);mocks.read.mockResolvedValue({id:id(800),revision:2,configuration:c,lifecycle:{state:'saved',canDelete:false}});mocks.resolve.mockRejectedValue(new ApiError('Missing',{status:404,code:'reward_sponsor_source_not_found'}));render(view(`/rewards/create?setup=${id(800)}&step=1`));await screen.findByText('Viewing saved rules · Revision 2');expect(screen.getByLabelText('Total budget · test MON')).toBeDisabled();expect(screen.queryByRole('button',{name:'Save draft'})).not.toBeInTheDocument();step('rules');const clubHeader=screen.getByRole('button',{name:'Saved club category Club'});expect(clubHeader).toBeEnabled();expect(clubHeader).toHaveAttribute('aria-expanded','false');fireEvent.click(clubHeader);expect(screen.getByLabelText('Saved club category budget %')).toBeDisabled();expect(within(screen.getByLabelText('Reward pot')).getAllByRole('option')).toHaveLength(2);fireEvent.change(screen.getByLabelText('Reward pot'),{target:{value:'1'}});fireEvent.click(screen.getByRole('button',{name:'Saved round category Individual'}));expect(screen.getByLabelText('Saved round category prize positions')).toBeDisabled();step('review');expect(screen.queryByRole('button',{name:'Save rules and continue to funding'})).not.toBeInTheDocument();fireEvent.click(screen.getAllByRole('link',{name:'Go to campaign'}).at(-1)!);expect(screen.getByLabelText('Current route')).toHaveTextContent(`/rewards/campaigns/${id(800)}`);expect(c).toEqual(original);expect(mocks.save).not.toHaveBeenCalled();
});
it('starts with a blank budget and labels navigation separately from save state',()=>{
 render(view());expect(screen.getByLabelText('Total budget · test MON')).toHaveValue('');expect(screen.getByRole('button',{name:'Continue'})).toBeDisabled();budget('10');step('rules');expect(screen.getByRole('button',{name:'Continue'})).toBeEnabled();step('review');expect(screen.getByRole('button',{name:'Save rules and continue to funding'})).toBeDisabled();expect(mocks.save).not.toHaveBeenCalled();
});
