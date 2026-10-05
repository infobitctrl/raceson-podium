vi.mock('../data/publicDirectory',()=>({usePublicDirectory:()=>({data:{items:[]},isError:false})}));
import {act,render,screen,fireEvent} from "@testing-library/react";
import {MemoryRouter,useLocation} from "react-router-dom";
import {createGuidedSetup} from "@raceson/domain/rewards/guided-setup-editor";
import {beforeEach,expect,it,vi} from "vitest";
import {I18nProvider} from "@/shared/i18n/I18nProvider";
import OrganizerProgrammeDirectory from "./OrganizerProgrammeDirectory";
const mocks=vi.hoisted(()=>({organizer:true,token:"session-a",list:vi.fn(),setups:vi.fn(),remove:vi.fn(),archive:vi.fn()}));
vi.mock("../components/TestProgrammeLibrary",()=>({default:()=> <p>Own saved test programmes</p>}));
vi.mock("@/lib/auth",()=>({useAuth:()=>({user:{id:"owner"},session:{access_token:mocks.token},isLoading:false,account:{userId:"owner",hasOrganizerAccess:mocks.organizer}})}));
vi.mock("../data/distributionSetups",()=>({listRewardSetups:mocks.setups,deleteRewardDraft:mocks.remove,archiveRewardSetup:mocks.archive}));
vi.mock("../data/planningDrafts",()=>({listPlanningDrafts:mocks.list}));
vi.mock("./SavedRewardProgramme",()=>({default:()=> <p>Access required</p>}));
const view=()=> <I18nProvider initialLocale="en"><MemoryRouter><OrganizerProgrammeDirectory/></MemoryRouter></I18nProvider>;
beforeEach(()=>{mocks.organizer=true;mocks.token="session-a";mocks.list.mockReset();mocks.setups.mockReset().mockResolvedValue([]);mocks.remove.mockReset();mocks.archive.mockReset();});
it("keeps legacy planning and test tools out of My campaigns for every account",async()=>{
 mocks.organizer=false;render(view());fireEvent.click(screen.getByRole("button",{name:"Grid view"}));await screen.findByText("No campaigns in this view");expect(mocks.list).not.toHaveBeenCalled();expect(mocks.setups).toHaveBeenCalled();expect(screen.queryByText("Test programmes")).not.toBeInTheDocument();
});
it("retires a pending private response when the session changes",async()=>{
 let finish!:(rows:unknown[])=>void;mocks.setups.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;})).mockResolvedValueOnce([]);
 const page=render(view());fireEvent.click(screen.getByRole("button",{name:"Grid view"}));mocks.token="session-b";page.rerender(view());fireEvent.click(screen.getByRole("button",{name:"Grid view"}));await screen.findByText("No campaigns in this view");
 await act(async()=>finish([{id:"old",configuration:{name:"Old private programme"}}]));expect(screen.queryByText("Old private programme")).not.toBeInTheDocument();
});

it("removes a confirmed draft card and preserves other saved campaigns",async()=>{
 let n=1;const next=()=>`75000000-0000-4000-8000-${String(n++).padStart(12,"0")}`;
 const draft={id:next(),lifecycle:{state:"draft",canDelete:true},revision:1,chainId:10143,updatedAt:"2026-09-23T12:00:00.000Z",configuration:{...createGuidedSetup(next),name:"Draft to delete"}};
 mocks.organizer=false;mocks.setups.mockResolvedValue([draft,{...draft,id:next(),lifecycle:{state:"draft",canDelete:false},configuration:{...draft.configuration,name:"Keep this campaign",stage:"ready"}}]);mocks.remove.mockResolvedValue({id:draft.id,deleted:true});
 render(view());fireEvent.click(screen.getByRole("button",{name:"Grid view"}));fireEvent.click(await screen.findByRole("button",{name:"Delete draft: Draft to delete"}));fireEvent.click(screen.getByRole("button",{name:"Delete draft"}));
 await screen.findByText('Campaign removed from your list.');expect(screen.queryByRole("heading",{name:"Draft to delete"})).not.toBeInTheDocument();expect(screen.getByRole("heading",{name:"Keep this campaign"})).toBeVisible();
});

it("starts a new campaign by selecting an existing event",async()=>{
 mocks.organizer=false;render(view());fireEvent.click(screen.getByRole("button",{name:"Grid view"}));
 expect(screen.getByRole("link",{name:"New campaign"})).toHaveAttribute("href","/rewards/events");
 expect(await screen.findByRole("link",{name:"Explore events"})).toHaveAttribute("href","/rewards/events");
});

it("moves confirmed archives between views and restores only the returned row",async()=>{
 let n=1;const next=()=>`75000000-0000-4000-8000-${String(n++).padStart(12,"0")}`;
 const campaign={id:next(),lifecycle:{state:"deposit",canDelete:false,archived:false},revision:1,chainId:10143,updatedAt:"2026-09-23T12:00:00.000Z",configuration:{...createGuidedSetup(next),name:"Older campaign"}};
 const archived={...campaign,lifecycle:{...campaign.lifecycle,archived:true}};
 mocks.organizer=false;mocks.setups.mockResolvedValue([campaign]);mocks.archive.mockResolvedValueOnce(archived).mockResolvedValueOnce(campaign);
 render(view());fireEvent.click(screen.getByRole("button",{name:"Grid view"}));fireEvent.click(await screen.findByRole("button",{name:"Archive campaign: Older campaign"}));fireEvent.click(screen.getByRole("button",{name:"Archive campaign"}));
 await screen.findByText('Campaign archive updated.');expect(screen.queryByRole("heading",{name:"Older campaign"})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole("button",{name:"Archived"}));expect(screen.getByRole("button",{name:"Archived"})).toHaveAttribute("aria-pressed","true");
 expect(screen.getByRole("heading",{name:"Older campaign"})).toBeVisible();expect(screen.getByRole("link",{name:/Older campaign/})).toHaveAttribute("href",`/rewards/campaigns/${campaign.id}`);
 fireEvent.click(screen.getByRole("button",{name:"Restore campaign: Older campaign"}));await act(async()=>{});expect(screen.queryByRole("heading",{name:"Older campaign"})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole("button",{name:"Active"}));expect(screen.getByRole("heading",{name:"Older campaign"})).toBeVisible();
});
it("keeps archived campaigns out of the initial active list after reload",async()=>{
 let n=1;const next=()=>`75000000-0000-4000-8000-${String(n++).padStart(12,"0")}`;
 mocks.organizer=false;mocks.setups.mockResolvedValue([{id:next(),lifecycle:{state:"deposit",canDelete:false,archived:true},revision:1,chainId:10143,updatedAt:"2026-09-23T12:00:00.000Z",configuration:{...createGuidedSetup(next),name:"Archived before reload"}}]);
 render(view());fireEvent.click(screen.getByRole("button",{name:"Grid view"}));await screen.findByText("No campaigns in this view");expect(screen.queryByRole("heading",{name:"Archived before reload"})).not.toBeInTheDocument();fireEvent.click(screen.getByRole("button",{name:"Archived"}));expect(screen.getByRole("heading",{name:"Archived before reload"})).toBeVisible();
});

it('keeps lifecycle labels and exact continuation links consistent across cards and table',async()=>{
 let n=1;const next=()=>`75000000-0000-4000-8000-${String(n++).padStart(12,'0')}`;
 const base={revision:2,chainId:10143,updatedAt:'2026-09-28T22:00:00.000Z'};
 const saved={...base,id:next(),lifecycle:{state:'saved',canDelete:false,archived:false},configuration:{...createGuidedSetup(next),name:'Saved league',budgetMon:'1'}};
 const unbound={...base,id:next(),lifecycle:{state:'deposit',canDelete:false,archived:false},configuration:{...createGuidedSetup(next),name:'Unbound league',budgetMon:'10'}};
 mocks.setups.mockResolvedValue([saved,unbound]);render(view());fireEvent.click(screen.getByRole("button",{name:"Grid view"}));
 expect(await screen.findByText('Saved · not launched')).toBeVisible();expect(screen.getByText('Source links required')).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'List view'}));
 expect(screen.getByText('Saved · not launched')).toBeVisible();expect(screen.getByText('Source links required')).toBeVisible();expect(screen.queryByText('Ready for deposit')).not.toBeInTheDocument();
 expect(screen.getByRole('link',{name:'Saved league'})).toHaveAttribute('href',`/rewards/campaigns/${saved.id}`);
 fireEvent.click(screen.getByRole('button',{name:'Drafts'}));expect(screen.getByRole('link',{name:'Saved league'})).toBeVisible();expect(screen.queryByRole('link',{name:'Unbound league'})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'All'}));fireEvent.click(screen.getByRole('button',{name:'Planned budget'}));
 expect(screen.getAllByRole('row')[1]).toHaveTextContent('Unbound league');
 fireEvent.click(screen.getByRole('button',{name:'Planned budget'}));expect(screen.getAllByRole('row')[1]).toHaveTextContent('Saved league');
 fireEvent.change(screen.getByRole('textbox',{name:'Search my campaigns'}),{target:{value:'saved'}});expect(screen.getAllByRole('row')).toHaveLength(2);
 expect(mocks.remove).not.toHaveBeenCalled();expect(mocks.archive).not.toHaveBeenCalled();
});


it('clears only the search and returns focus while retaining archived view and sorting',async()=>{
 let n=1;const next=()=>`75000000-0000-4000-8000-${String(n++).padStart(12,'0')}`;
 const record={id:next(),lifecycle:{state:'saved',canDelete:false,archived:true},revision:1,chainId:10143,updatedAt:'2026-09-23T12:00:00.000Z',configuration:{...createGuidedSetup(next),name:'Retained campaign'}};
 mocks.setups.mockResolvedValue([record]);
 function Location(){return <output data-testid="location">{useLocation().search}</output>;}
 render(<I18nProvider initialLocale="en"><MemoryRouter initialEntries={['/rewards/manage?status=archived&q=missing&sort=budget&order=asc&view=list']}><OrganizerProgrammeDirectory/><Location/></MemoryRouter></I18nProvider>);
 await screen.findByText('No matching campaigns');
 fireEvent.click(screen.getByRole('button',{name:'Clear search'}));
 expect(screen.getByRole('textbox',{name:'Search my campaigns'})).toHaveFocus();
 expect(screen.getByRole('link',{name:'Retained campaign'})).toHaveAttribute('href',`/rewards/campaigns/${record.id}`);
 const params=new URLSearchParams(screen.getByTestId('location').textContent!);
 expect(params.get('q')).toBe('');expect(params.get('status')).toBe('archived');expect(params.get('view')).toBe('list');expect(params.get('sort')).toBe('budget');expect(params.get('order')).toBe('asc');
 expect(mocks.remove).not.toHaveBeenCalled();expect(mocks.archive).not.toHaveBeenCalled();
});
