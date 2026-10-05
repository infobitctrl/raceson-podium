import {render,screen} from "@testing-library/react";
import {MemoryRouter,Route,Routes,useLocation} from "react-router-dom";
import {beforeEach,expect,it,vi} from "vitest";
import SponsorCampaignEntry from "./SponsorCampaignEntry";
const state=vi.hoisted(()=>({signedIn:false,organizer:false}));
vi.mock("@/lib/auth",()=>({useAuth:()=>({isLoading:false,user:state.signedIn?{id:"owner"}:null,session:state.signedIn?{}:null,account:{userId:"owner",hasOrganizerAccess:state.organizer}})}));
vi.mock("./RewardSetup",()=>({default:({campaign}:{campaign:boolean})=> <p>{campaign?"Sponsor editor":"Classic editor"}</p>}));
const guestKey="raceson.reward-setup.sign-in-draft.v1.sponsor.league";
function Location(){return <output>{useLocation().search}</output>;}
const view=(path="/rewards/create")=><MemoryRouter initialEntries={[path]}><Routes><Route path="/rewards/create" element={<><SponsorCampaignEntry/><Location/></>}/><Route path="/rewards/events" element={<p>Choose an event</p>}/></Routes></MemoryRouter>;
beforeEach(()=>{sessionStorage.clear();state.signedIn=false;state.organizer=false;});
it("begins a fresh campaign in the event catalogue",()=>{
 render(view());expect(screen.getByText("Choose an event")).toBeVisible();expect(screen.queryByText("Sponsor editor")).not.toBeInTheDocument();
});
it("opens source-selected setup for visitors, athletes and organizers",()=>{
 const page=render(view("/rewards/create?sourceLeagueId=league&sourceSeasonId=season"));
 expect(screen.getByText("Sponsor editor")).toBeVisible();
 for(const organizer of [false,true]){state.signedIn=true;state.organizer=organizer;page.rerender(view("/rewards/create?sourceLeagueId=league&sourceSeasonId=season"));expect(screen.getByText("Sponsor editor")).toBeVisible();}
 expect(screen.queryByText("Organizer access required")).not.toBeInTheDocument();
});
it("keeps an existing source-less saved campaign and its query intact",()=>{
 const query="?setup=6cb8f27b-d832-4c45-880d-36bf11341560&step=5";
 render(view(`/rewards/create${query}`));expect(screen.getByText("Sponsor editor")).toBeVisible();expect(screen.getByRole("status")).toHaveTextContent(query);
});
it.each([JSON.stringify({name:"My retained work"}),"unreadable draft"])("does not discard a retained guest draft (%s)",draft=>{
 sessionStorage.setItem(guestKey,draft);render(view());expect(screen.getByText("Sponsor editor")).toBeVisible();expect(sessionStorage.getItem(guestKey)).toBe(draft);
});
