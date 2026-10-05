import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import type {ReactElement} from "react";
import {fireEvent,render as rtlRender,screen,within} from "@testing-library/react";
import {MemoryRouter,Route,Routes,useLocation} from "react-router-dom";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {I18nProvider} from "@/shared/i18n/I18nProvider";
import SponsorDiscovery from "./SponsorDiscovery";
import {sponsorLink,sponsorDiscoveryLink,sponsorDemoSource,sponsorDemoEditions,sponsorSelectedEventName} from "../model/sponsorOpportunities";
import {sponsorCatalogue} from "../model/sponsorCatalogue";
import {sponsorPreparedSource} from "../model/sponsorPreparedSource";
import SponsorSourceStatus from "../components/SponsorSourceStatus";
import type {useSponsorSource} from "../model/useSponsorSource";
const directoryQuery=vi.hoisted(()=>vi.fn());
vi.mock('../data/publicDirectory',()=>({usePublicDirectory:directoryQuery}));
beforeEach(()=>directoryQuery.mockReturnValue({data:{chainId:10143,items:[],sponsors:0,checkedAt:'2026-10-05T17:00:00Z',refreshStatus:'current'},isPending:false,isError:false}));
const view=()=>{const result=render(<I18nProvider initialLocale="en"><MemoryRouter><SponsorDiscovery/></MemoryRouter></I18nProvider>);fireEvent.change(screen.getByLabelText("Event period"),{target:{value:"all"}});return result;};
it("preserves league and race selection through setup",()=>{
 view();fireEvent.click(screen.getByRole("button",{name:"All"}));expect(screen.getByRole("heading",{level:1})).toHaveTextContent("Find an event to sponsor");
 expect(screen.getByRole("link",{name:"Sponsor event: Šibenik Trail League"})).toHaveAttribute("href",sponsorLink("league"));
 expect(screen.getByText("6 results")).toBeVisible();
 fireEvent.click(screen.getByRole("button",{name:"View Šubićevac Trail 2026"}));
 expect(within(screen.getByRole("article",{name:"Event details"})).getByRole("link",{name:"Sponsor event"})).toHaveAttribute("href",sponsorLink("round-5"));
 fireEvent.click(screen.getByRole("button",{name:"Back to events"}));expect(screen.queryByRole("article",{name:"Event details"})).not.toBeInTheDocument();
});
it("filters races, searches Croatian names and recovers empty results",()=>{
 view();fireEvent.click(screen.getByRole("button",{name:"Races",exact:true}));
 expect(screen.queryByRole("heading",{name:"Šibenik Trail League"})).not.toBeInTheDocument();
 expect(screen.getAllByRole("button",{name:/^View details:/})).toHaveLength(5);
 fireEvent.click(screen.getByRole("button",{name:"All",exact:true}));
 fireEvent.change(screen.getByRole("textbox"),{target:{value:"subicevac"}});
 expect(screen.getByRole("heading",{name:"Šubićevac Trail 2026"})).toBeVisible();
 expect(screen.queryByRole("heading",{name:"Raslina Trail 2026"})).not.toBeInTheDocument();
 fireEvent.change(screen.getByRole("textbox"),{target:{value:"no such competition"}});
 expect(screen.getByRole("status")).toHaveTextContent("No matches");
 fireEvent.click(screen.getByRole("button",{name:"Clear filters"}));
 expect(screen.getByRole("heading",{name:"Šibenik Trail League"})).toBeVisible();
 expect(screen.getByText("6 results")).toBeVisible();
});

it("carries public league, season and exact event identity independently of labels",()=>{
 const league=new URL(sponsorLink(),"https://demo.invalid");expect(league.searchParams.get("sourceLeagueId")).toBe(sponsorDemoSource.sourceLeagueId);expect(league.searchParams.get("sourceSeasonId")).toBe(sponsorDemoSource.sourceSeasonId);expect(league.searchParams.has("eventEditionId")).toBe(false);
 const race=new URL(sponsorLink("round-4"),"https://demo.invalid");expect(race.searchParams.get("eventEditionId")).toBe(sponsorDemoEditions[3]);
});

it("returns from event selection to the same saved campaign instead of creating a new draft",()=>{
 const setup="79185f04-1041-4df0-9e7a-aa60fa149b81";
 const state={status:"unselected",selected:false,source:null,retry:()=>{}} as ReturnType<typeof useSponsorSource>;
 function Location(){return <output data-testid="location">{useLocation().search}</output>;}
 render(<I18nProvider initialLocale="en"><MemoryRouter initialEntries={[`/rewards/create?setup=${setup}`]}><Routes>
  <Route path="/rewards/create" element={<><SponsorSourceStatus state={state} hr={false}/><Location/></>}/>
  <Route path="/rewards/events" element={<SponsorDiscovery/>}/>
 </Routes></MemoryRouter></I18nProvider>);
 expect(screen.getByRole("link",{name:"Choose an event to sponsor"})).toHaveAttribute("href",sponsorDiscoveryLink(setup));
 fireEvent.click(screen.getByRole("link",{name:"Choose an event to sponsor"}));fireEvent.change(screen.getByLabelText("Event period"),{target:{value:"all"}});fireEvent.click(screen.getByRole("button",{name:"All"}));
 expect(screen.getByRole("link",{name:"Sponsor event: Šibenik Trail League"})).toHaveAttribute("href",sponsorLink("league",setup));
 fireEvent.click(screen.getByRole("button",{name:"View Raslina Trail 2026"}));
 fireEvent.click(screen.getByRole("link",{name:"Sponsor event"}));
 const selection=new URLSearchParams(screen.getByTestId("location").textContent!);
 expect(selection.get("setup")).toBe(setup);
 expect(selection.get("eventEditionId")).toBe(sponsorDemoEditions[3]);
 expect(selection.get("sourceLeagueId")).toBe(sponsorDemoSource.sourceLeagueId);
 expect(selection.get("sourceSeasonId")).toBe(sponsorDemoSource.sourceSeasonId);
});

it.each([undefined,null,"invalid","00000000-0000-0000-0000-000000000000"])("does not carry an invalid saved setup identifier (%s)",setup=>{
 expect(sponsorDiscoveryLink(setup)).toBe("/rewards/events");
 expect(new URL(sponsorLink("round-4",setup),"https://demo.invalid").searchParams.has("setup")).toBe(false);
});

it("describes catalogue availability separately from connecting existing reward groups",()=>{
 const state={status:"ready",selected:true,source:null,retry:()=>{}} as ReturnType<typeof useSponsorSource>;
 render(<MemoryRouter><SponsorSourceStatus state={state} hr={false}/></MemoryRouter>);
 expect(screen.getByText("Official event catalogue available.")).toBeVisible();
 expect(screen.queryByText("Official event and categories connected.")).not.toBeInTheDocument();
 expect(screen.getByText(/Matching a category preserves that group’s budget and prizes/)).toHaveTextContent("Participation rewards use the league’s contribution rules and do not need a category.");
});

it("renders exactly one league and five races with source identities",()=>{
 view();fireEvent.click(screen.getByRole("button",{name:"All"}));expect(screen.getAllByRole("link",{name:/^Sponsor event:/})).toHaveLength(6);
 expect(sponsorCatalogue.filter(c=>c.kind==="race")).toHaveLength(5);
 expect(sponsorCatalogue.filter(c=>c.kind==="track")).toHaveLength(10);
 for(const item of sponsorCatalogue.filter(c=>c.kind==="race")){
  const url=new URL(screen.getByRole("link",{name:`Sponsor event: ${item.name}`}).getAttribute("href")!,"https://demo.invalid");
  expect(url.searchParams.get("eventEditionId")).toBe(item.eventEditionId);
  expect(url.searchParams.get("raceId")).toBe(item.raceId??null);
  expect(url.searchParams.get("sourceLeagueId")).toBe(sponsorPreparedSource.sourceLeagueId);
  expect(url.searchParams.get("sourceSeasonId")).toBe(sponsorPreparedSource.sourceSeasonId);
 }
 expect(screen.queryByText("Organizer confirmation required")).not.toBeInTheDocument();
});

it("defaults old track-filter and track-detail URLs to the six-event catalogue",()=>{
 const track=sponsorCatalogue.find(c=>c.kind==='track')!;
 render(<I18nProvider initialLocale="en"><MemoryRouter initialEntries={[`/rewards/events?kind=track&event=${track.id}`]}><SponsorDiscovery/></MemoryRouter></I18nProvider>);
 expect(screen.getByRole('button',{name:'All',exact:true})).toHaveAttribute('aria-pressed','true');
 expect(screen.queryByRole('button',{name:'Tracks',exact:true})).not.toBeInTheDocument();
 expect(screen.queryByRole('article',{name:'Event details'})).not.toBeInTheDocument();
 expect(screen.getAllByRole('link',{name:/^Sponsor event:/})).toHaveLength(6);
 for(const link of screen.getAllByRole('link',{name:/^Sponsor event:/}))expect(new URL(link.getAttribute('href')!,'https://demo.invalid').searchParams.has('raceId')).toBe(false);
});

it("preserves existing track-specific campaign identities outside new event discovery",()=>{
 const setup="79185f04-1041-4df0-9e7a-aa60fa149b81";
 const track=sponsorCatalogue.find(c=>c.sourceRaceId==="eec23bd8-d376-4a46-8d5e-5bcdea453e4d")!;
 const url=new URL(sponsorLink(track.parent,setup,track.raceId),"https://demo.invalid");
 expect(url.searchParams.get("setup")).toBe(setup);expect(url.searchParams.get("raceId")).toBe(track.raceId);
 expect(sponsorSelectedEventName({...sponsorDemoSource,eventEditionId:track.eventEditionId,raceId:track.raceId})).toBe(track.name);
});

it("does not put a track from another race or an invalid track into sponsor links",()=>{
 const raceId="8e240924-7918-4df0-9000-000000000005";
 for(const [parent,race] of [["round-4",raceId],["league",raceId],["round-5","invalid"]]){
  expect(new URL(sponsorLink(parent,undefined,race),"https://demo.invalid").searchParams.has("raceId")).toBe(false);
 }
});


afterEach(()=>vi.useRealTimers());
it.each([
 ["2026-09-29T01:30:00Z",true],
 ["2026-10-04T21:59:59Z",true],
 ["2026-10-04T22:00:00Z",false],
])("classifies league by its final scheduled race in Zagreb at %s",(now,upcoming)=>{
 vi.useFakeTimers();vi.setSystemTime(new Date(now));
 const setup="79185f04-1041-4df0-9e7a-aa60fa149b81";
 render(<I18nProvider initialLocale="en"><MemoryRouter initialEntries={[`/rewards/events?kind=league&period=upcoming&setup=${setup}`]}><SponsorDiscovery/></MemoryRouter></I18nProvider>);
 const league=()=>screen.queryByRole("heading",{name:"Šibenik Trail League"});
 expect(Boolean(league())).toBe(upcoming);
 fireEvent.change(screen.getByRole("combobox",{name:"Event period"}),{target:{value:"past"}});
 expect(Boolean(league())).toBe(!upcoming);
 fireEvent.change(screen.getByRole("combobox",{name:"Event period"}),{target:{value:"all"}});
 expect(league()).toBeVisible();
 expect(screen.getByText("4 Oct 2026")).toHaveAttribute("datetime","2026-10-04");
 expect(screen.getByRole("link",{name:"Sponsor event: Šibenik Trail League"})).toHaveAttribute("href",sponsorLink("league",setup));
});
it("filters all event types consistently and keeps date sorting",()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date("2026-09-29T01:30:00Z"));
 view();fireEvent.click(screen.getByRole("button",{name:"All"}));
 fireEvent.change(screen.getByRole("combobox",{name:"Event period"}),{target:{value:"upcoming"}});
 expect(screen.getAllByRole("link",{name:/^Sponsor event:/})).toHaveLength(2);
 fireEvent.change(screen.getByRole("combobox",{name:"Event period"}),{target:{value:"past"}});
 expect(screen.getAllByRole("link",{name:/^Sponsor event:/})).toHaveLength(4);
 expect(screen.queryByRole("heading",{name:"Šibenik Trail League"})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole("button",{name:"Races"}));
 fireEvent.change(screen.getByRole("combobox",{name:"Sort events"}),{target:{value:"date-desc"}});
 expect(screen.getAllByRole("heading",{level:2}).map(h=>h.textContent)).toEqual(sponsorCatalogue.filter(c=>c.kind==="race"&&c.date<"2026-09-29").sort((a,b)=>b.date.localeCompare(a.date)).map(c=>c.name));
});


it.each(['View Šubićevac Trail 2026','View details: Šubićevac Trail 2026'])('opens a dedicated event page from %s and returns with filters retained',name=>{
 view();fireEvent.click(screen.getByRole('button',{name}));
 const details=within(screen.getByRole('article',{name:'Event details'}));
 expect(details.getByRole('heading',{name:'Competition structure'})).toBeVisible();
 expect(details.getByRole('link',{name:'Sponsor event'})).toHaveAttribute('href',sponsorLink('round-5'));
 fireEvent.click(details.getByRole('button',{name:'Back to events'}));
 expect(screen.getByLabelText('Event period')).toHaveValue('all');
 expect(screen.queryByRole('article',{name:'Event details'})).not.toBeInTheDocument();
});
it('opens an event detail directly from its retained URL selection',()=>{
 render(<I18nProvider initialLocale="en"><MemoryRouter initialEntries={['/rewards/events?event=round-5&kind=race&period=all']}><SponsorDiscovery/></MemoryRouter></I18nProvider>);
 expect(screen.getByRole('heading',{level:1,name:'Šubićevac Trail 2026'})).toBeVisible();
 expect(screen.getByRole('link',{name:'Sponsor event'})).toHaveAttribute('href',sponsorLink('round-5'));
});

it('defaults to all six events and keeps date filters available',()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-05T12:00:00Z'));
 render(<I18nProvider initialLocale="en"><MemoryRouter><SponsorDiscovery/></MemoryRouter></I18nProvider>);
 expect(screen.getByRole('button',{name:'All',exact:true})).toHaveAttribute('aria-pressed','true');
 expect(screen.getByLabelText('Event period')).toHaveValue('all');
 expect(screen.getByText('6 results')).toBeVisible();
 expect(screen.getAllByText('0 sponsorships')).toHaveLength(6);
 fireEvent.change(screen.getByLabelText('Event period'),{target:{value:'upcoming'}});
 expect(screen.getByRole('status')).toHaveTextContent('No matches');
});

it('counts published sponsorships by exact league, season and parent race',()=>{
 const selection={...sponsorDemoSource,eventEditionId:null};
 const item=(scope:typeof selection|{sourceLeagueId:string;sourceSeasonId:string;eventEditionId:string;raceId?:string}|null)=>({selection:scope});
 directoryQuery.mockReturnValue({data:{refreshStatus:'current',items:[item(selection),item({...selection,eventEditionId:sponsorDemoEditions[0]}),item({...selection,eventEditionId:sponsorDemoEditions[0],raceId:'existing-track'}),item({...selection,sourceLeagueId:'other-league'}),item({...selection,sourceSeasonId:'other-season',eventEditionId:sponsorDemoEditions[0]}),item(null)]},isError:false});
 view();
 expect(within(screen.getByRole('region',{name:'Šibenik Trail League'})).getByText('1 sponsorship')).toBeVisible();
 expect(within(screen.getByRole('region',{name:'Vrpolje Trail 2026'})).getByText('2 sponsorships')).toBeVisible();
 expect(screen.getAllByText('0 sponsorships')).toHaveLength(4);
});

it.each([
 [{data:undefined,isError:false},'Checking sponsorships…'],
 [{data:undefined,isError:true},'Sponsorships unavailable'],
 [{data:{items:[],refreshStatus:'failed'},isError:false},'Sponsorships unavailable'],
])('does not turn unavailable sponsorship counts into zero', (state,label)=>{
 directoryQuery.mockReturnValue(state);view();
 expect(screen.getAllByText(label)).toHaveLength(6);
 expect(screen.queryByText('0 sponsorships')).not.toBeInTheDocument();
});

it('opens the league structure without losing the draft identity',()=>{
 const setup='72000000-0000-4000-8000-000000000001';render(<I18nProvider initialLocale="en"><MemoryRouter initialEntries={[`/rewards/events?event=league&setup=${setup}`]}><SponsorDiscovery/></MemoryRouter></I18nProvider>);expect(screen.getByRole('heading',{name:'Competition structure'})).toBeVisible();expect(screen.getByRole('link',{name:'Sponsor event',exact:true})).toHaveAttribute('href',sponsorLink('league',setup));expect(screen.getAllByRole('button',{name:'Event details'})).toHaveLength(5);
});

function render(ui:ReactElement){return rtlRender(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}>{ui}</QueryClientProvider>);}
