vi.mock('../data/publicDirectory',()=>({usePublicDirectory:()=>({data:{items:[],sponsors:0,chainId:31337,checkedAt:'2026-09-28T10:00:00Z'},isPending:false,isError:false,refetch:vi.fn(),isFetching:false})}));
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/shared/i18n/I18nProvider";
import RewardsDemoApp from "./RewardsDemoApp";

const fixture = vi.hoisted(() => ({
  user: null as { id: string } | null,
  demo: true,
  organizer: false,
  club: false,
  athlete: true,
  authMounts: 0,
  sponsorMounts: 0,
  observedTitles: [] as { path: string; title: string }[],
  signOut: vi.fn(async () => {}),
  originCheck: vi.fn(),
}));
vi.mock('../components/RewardWalletSession',()=>({default:({children})=>{fixture.sponsorMounts++;return children;}}));
vi.mock("@/lib/auth", () => ({
  AuthProvider: ({ children }) => { fixture.authMounts++; return children; },
  useAuth: () => ({ user: fixture.user, isLoading: false, signOut: fixture.signOut,
    account: fixture.user ? { userId: fixture.user.id, hasAthleteAccess: fixture.athlete, hasOrganizerAccess: fixture.organizer } : null }),
  hasOrganizerWorkspaceAccess: () => false,
}));
vi.mock('../data/usePodiumNavigation',()=>({usePodiumNavigation:()=>{
 const account=fixture.user?{userId:fixture.user.id}:null;
 const role=!account?null:fixture.organizer?'reviewer':fixture.club?'club':fixture.athlete?'athlete':'sponsor';
 return {account,role,href:role?{reviewer:'/rewards/review',club:'/club/rewards',athlete:'/athlete/rewards',sponsor:'/rewards/manage'}[role]:null,error:false,retry:vi.fn()};
}}));
vi.mock("@/lib/public-env", () => ({
  publicEnv: { get rewardDemo() { return fixture.demo ? { chainId: 31337 } : null; } },
  assertPublicEnvironmentOrigin: () => fixture.originCheck(),
}));
// Model an external route announcer reading the title during passive effects.
vi.mock("../components/PodiumHeader", async importOriginal => {
  const original = await importOriginal<typeof import("../components/PodiumHeader")>();
  const { useEffect } = await import("react");
  const { useLocation } = await import("react-router-dom");
  return { default: function ObservedHeader() {
    const { pathname } = useLocation();
    useEffect(() => { fixture.observedTitles.push({ path: pathname, title: document.title }); }, [pathname]);
    return <original.default />;
  } };
});
vi.mock("@/shared/i18n/AccountLocaleSynchronizer", () => ({ AccountLocaleSynchronizer: () => null }));
vi.mock("@/shared/brand/BrandWordmark", () => ({ BrandWordmark: () => <span>RacesOn</span> }));
vi.mock("@/components/shared/ThemeToggle", () => ({ default: () => <button>Theme</button> }));
vi.mock("@/components/ui/sonner", () => ({ Toaster: () => null }));
vi.mock("../screens/AthleteRewards", () => ({ default: () => <h1>Own allocations</h1> }));
vi.mock("../screens/PublicRewardProgramme", () => ({ default: () => <h1>Public programme budget</h1> }));
vi.mock("../screens/TestRewardProgramme", () => ({ default: () => <h1>Test programme builder</h1> }));
vi.mock("../screens/RewardProgramme", () => ({ default: () => <h1>Public programme budget</h1> }));
vi.mock("../screens/ContractCanary", () => ({ default: () => <h1>Public contract status</h1> }));
vi.mock("../screens/AllocationRehearsalV3", () => ({ default: () => <h1>Public synthetic distribution</h1> }));
vi.mock("../screens/OrganizerRewards", () => ({ default: () => <h1>Private organiser review</h1> }));
vi.mock("../screens/ClubRewards", () => ({ default: () => <h1>Private club treasury</h1> }));
vi.mock("@/pages/athlete/AthleteAccountPage", () => ({ default: () => <h1>Demo account history</h1> }));
vi.mock("@/pages/AuthPage", () => ({ default: () => <h1>Demo sign-in</h1> }));
vi.mock("@/pages/ForgotPasswordPage", () => ({ default: () => <h1>Demo password reset</h1> }));
vi.mock("@/pages/EventDetailPage", () => ({ default: () => <h1>Demo race</h1> }));

function mount(path: string) {
  window.history.replaceState({}, "", path);
  return render(<I18nProvider initialLocale="en"><RewardsDemoApp /></I18nProvider>);
}
function nav(){return within(screen.getByRole('navigation',{name:'Main navigation'}));}
beforeEach(() => {
  fixture.user = null; fixture.athlete = true; fixture.demo = true; fixture.organizer = false; fixture.club=false; fixture.authMounts = 0; fixture.sponsorMounts = 0;
  fixture.originCheck.mockReset(); fixture.signOut.mockReset(); fixture.observedTitles = [];
});

describe("independent rewards application routing", () => {
  it("preserves legacy planning deep links under the separate calculator route", async () => {
    mount("/rewards?node=league&view=portal");
    await screen.findByRole("heading", { name: "Public programme budget" });
    expect(window.location.pathname).toBe("/rewards/calculator");
    expect(new URLSearchParams(window.location.search).get("node")).toBe("league");
    expect(new URLSearchParams(window.location.search).get("view")).toBe("portal");
  });
  it("keeps homepage grid/list switching on the Podium overview",async()=>{
    mount("/rewards");await screen.findByRole("heading",{name:"Sponsor the podium. Reward the finish."},{timeout:5000});fireEvent.click(screen.getByRole("button",{name:"List view"}));
    await waitFor(()=>expect(window.location.search).toContain("view=list"));expect(window.location.pathname).toBe("/rewards");expect(screen.getByRole("heading",{name:"Sponsor the podium. Reward the finish."})).toBeVisible();
    fireEvent.click(screen.getByRole("button",{name:"Grid view"}));await waitFor(()=>expect(window.location.search).toContain("view=grid"));expect(window.location.pathname).toBe("/rewards");
  });
  it.each(["/rewards/test","/rewards/rehearsal","/rewards/contract","/rewards/pots"])("retires unused tool entry %s into the campaign directory",async path=>{
    mount(path);expect(await screen.findByRole("heading",{name:"Campaigns",level:1})).toBeVisible();expect(window.location.pathname).toBe("/rewards/campaigns");expect(screen.queryByText("Demo tools")).not.toBeInTheDocument();
  });
  it("connects club rewards only through the demo navigation and title", async () => {
    fixture.user={id:"club-owner"};fixture.club=true;mount("/rewards"); fireEvent.click(await nav().findByRole("link", { name: "Club rewards" }));
    expect(await screen.findByRole("heading", { name: "Private club treasury" })).toBeVisible();
    expect(fixture.observedTitles.at(-1)).toEqual({path:"/club/rewards",title:"Club rewards · Testnet demo | RacesOn Podium"});
    expect(window.location.pathname).toBe("/club/rewards"); expect(screen.getByLabelText("Account menu",{exact:true}).closest("details")).not.toHaveAttribute("open"); expect(document.title).toBe("Club rewards · Testnet demo | RacesOn Podium");
  });
  it("lands guests on sponsorship discovery and retains that destination at sign-in", async () => {
    mount("/");
    expect(await screen.findByRole("heading", { name: "Sponsor the podium. Reward the finish." })).toBeVisible();
    expect(window.location.pathname).toBe("/rewards");
    expect(screen.queryByRole("link", {name:"Rewards control"})).not.toBeInTheDocument();
    expect(document.title).toBe("Home · Testnet demo | RacesOn Podium");
    expect(screen.getByRole("link", { name: "RacesOn Podium" })).toHaveAttribute("href", "/rewards");
    fireEvent.click(screen.getAllByRole("link", { name: "Sign in" })[0]);
    expect(await screen.findByRole("heading", { name: "Demo sign-in" })).toBeVisible();
    expect(new URLSearchParams(window.location.search).get("next")).toBe("/rewards");
  });
  it("offers operations only to staff while preserving the existing review route",async()=>{
    fixture.user={id:"staff"};fixture.organizer=true;mount("/organizer/rewards");await screen.findByRole("heading",{name:"Private organiser review"});expect(nav().getByRole("link",{name:"Review"})).toHaveAttribute("href","/rewards/review");fireEvent.click(screen.getByText("Account",{exact:true}));expect(screen.queryByRole("link",{name:"Rewards control"})).not.toBeInTheDocument();
  });
  it("hides organizer navigation from an athlete account", async () => {
    fixture.user = {id:"athlete"}; mount("/athlete/rewards");
    await screen.findByRole("heading", {name:"Own allocations"});
    expect(nav().getByRole("link", {name:"My rewards"})).toHaveAttribute("href","/athlete/rewards");
    expect(screen.queryByRole("link", {name:"Rewards control"})).not.toBeInTheDocument();
    expect(screen.queryByRole("link", {name:"Organize rewards"})).not.toBeInTheDocument();
  });
  it("redirects guests to its own sign-in while retaining the exact reward destination", async () => {
    mount("/athlete/rewards");
    expect(await screen.findByRole("heading", { name: "Demo sign-in" })).toBeVisible();
    expect(window.location.pathname).toBe("/auth");
    expect(new URLSearchParams(window.location.search).get("next")).toBe("/athlete/rewards");
    expect(screen.queryByRole("navigation", { name: "Demo navigation" })).not.toBeInTheDocument();
  });
  it("connects private rewards to the reused account-history screen without portal navigation", async () => {
    fixture.user = { id: "synthetic-user" };
    mount("/athlete/rewards");
    expect(await screen.findByRole("heading", { name: "Own allocations" })).toBeVisible();
    expect(document.title).toBe("Rewards · Testnet demo | RacesOn Podium");
    fireEvent.click(screen.getByText("Account",{exact:true}));
    fireEvent.click(screen.getByRole("link", { name: "Profile" }));
    expect(await screen.findByRole("heading",{name:"Profile",level:1})).toBeVisible();
    fireEvent.click(screen.getByRole("link",{name:"Edit athlete profile"}));
    expect(await screen.findByRole("heading", { name: "Demo account history" })).toBeVisible();
    expect(window.location.pathname).toBe("/athlete/account");
    expect(screen.queryByRole("link", { name: "Registrations" })).not.toBeInTheDocument();
    expect(fixture.originCheck).toHaveBeenCalled();
  });
  it("handles excluded portal routes locally, without a production redirect", async () => {
    mount("/organizer/finance");
    expect(await screen.findByRole("heading", { name: "This area is not part of the rewards demo" })).toBeVisible();
    expect(window.location.pathname).toBe("/organizer/finance");
    for (const link of screen.getAllByRole("link")) expect(link.getAttribute("href")).not.toMatch(/^https?:/);
  });
  it.each(["/organizer/events", "/organizer/events/retained-event", "/organizer/events/retained-event/race-day"])("retires event management %s without asking for organizer access", async path => {
    mount(path);
    expect(await screen.findByRole("heading", {name:"Find an event to sponsor"})).toBeVisible();
    expect(window.location.pathname).toBe("/rewards/events");
    expect(screen.queryByRole("heading", {name:"Demo sign-in"})).not.toBeInTheDocument();
  });
  it.each(["/organizer", "/organizer/dashboard"])("lands old workspace entry %s on Podium Home", async path => {
    fixture.user={id:"master"}; fixture.organizer=true;
    mount(path);
    expect(await screen.findByRole("heading", {name:"Sponsor the podium. Reward the finish."})).toBeVisible();
    expect(window.location.pathname).toBe("/rewards");
  });
  it("reports an uncertain sign-out instead of pretending the session was cleared", async () => {
    fixture.user = { id: "synthetic-user" }; fixture.signOut.mockRejectedValue(new Error("synthetic"));
    mount("/athlete/rewards");
    fireEvent.click(screen.getByText("Account",{exact:true}));fireEvent.click((await screen.findAllByRole("button", { name: "Sign out" }))[0]);
    expect(await screen.findByRole("alert")).toHaveTextContent("Sign out failed");
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Sign out" })[0]).toBeEnabled());
  });
  it("does not mount Auth if an unconfigured demo somehow reaches the browser", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      fixture.demo = false;
      mount("/athlete/rewards");
      expect(await screen.findByRole("alert")).toHaveTextContent("The demo could not load");
      expect(fixture.authMounts).toBe(0);
    } finally { log.mockRestore(); }
  });
});

 it("keeps denied athlete access within Podium without mounting private rewards",async()=>{
  fixture.user={id:"organizer"};fixture.organizer=true;fixture.athlete=false;mount("/athlete/rewards");
  expect(await screen.findByRole("heading",{name:"Use your athlete account to view rewards"})).toBeVisible();
  expect(screen.queryByRole("heading",{name:"Own allocations"})).not.toBeInTheDocument();
  expect(screen.queryByRole("link",{name:"Go to available workspace"})).not.toBeInTheDocument();
  expect(screen.getByRole("link",{name:"Explore campaigns"})).toHaveAttribute("href","/rewards/campaigns");
  expect(nav().getByRole("link",{name:"Review"})).toHaveAttribute("href","/rewards/review");
  expect(nav().queryByRole("link",{name:"My campaigns"})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("link",{name:"Explore campaigns"}));expect(await screen.findByRole("heading",{name:"Campaigns",level:1})).toBeVisible();
 });

it('does not mount sponsor custom-JWT synchronization on native operational wallet administration',async()=>{
 mount('/rewards/admin/wallets');expect(await screen.findByRole('heading',{name:'Wallet administration'})).toBeVisible();expect(fixture.sponsorMounts).toBe(0);
});

it.each(['sponsor','reviewer','club'])('provides a common Profile without athlete editing for a %s account',async role=>{
 fixture.user={id:'synthetic-'+role};fixture.athlete=false;fixture.organizer=role==='reviewer';fixture.club=role==='club';mount('/rewards/profile');
 expect(await screen.findByRole('heading',{name:'Profile',level:1})).toBeVisible();
 expect(screen.queryByRole('link',{name:'Edit athlete profile'})).not.toBeInTheDocument();
 expect(document.title).toBe('Profile · Testnet demo | RacesOn Podium');
});
