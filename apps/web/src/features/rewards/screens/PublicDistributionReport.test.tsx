import {fireEvent,render,screen,within} from "@testing-library/react";
import {MemoryRouter,Routes,Route} from "react-router-dom";
import {beforeEach,expect,it,vi} from "vitest";
import type {PublicRewardReport} from "@raceson/domain/rewards/public-report";
import {I18nProvider} from "@/shared/i18n/I18nProvider";
import PublicDistributionReport from "./PublicDistributionReport";
import {RewardsHome,RewardPotsDirectory} from "./RewardCatalogue";

const state=vi.hoisted(()=>({data:null as PublicRewardReport|null,failed:false,retry:vi.fn()}));
vi.mock("../model/usePublicRewardReport",()=>({usePublicRewardReport:()=>state}));
const mon=(n:number)=>String(BigInt(n)*10n**18n);
beforeEach(()=>{
 state.failed=false;state.retry.mockClear();
 state.data={schema:"raceson-public-reward-report-v1",observedAt:"2026-09-16T12:00:00.000Z",programmes:[{
  id:"demo",name:"Synthetic demo",host:"Demo host",chainId:10143,source:"synthetic",status:"distributing",
  pots:[{id:"round-1",slot:1,name:"Round 1",budgetWei:mon(10),approvedAt:"2026-09-15T10:00:00.000Z",
   pools:[{key:"athlete_standings",budgetWei:mon(10)}],rows:[
    {recipientId:"athlete-1",name:"Demo athlete 1",kind:"athlete",amountWei:mon(2),claim:"submitted",payment:"paid",transactionHash:`0x${"a".repeat(64)}`,paidAt:"2026-09-15T12:00:00.000Z"},
    {recipientId:"athlete-2",name:"Demo athlete 2",kind:"athlete",amountWei:mon(3),claim:"not_submitted",payment:"not_paid",transactionHash:null,paidAt:null},
   ]},{id:"league",slot:6,name:"League pot",budgetWei:mon(20),approvedAt:"2026-09-15T11:00:00.000Z",
    pools:[{key:"athlete_standings",budgetWei:mon(20)}],rows:[{recipientId:"athlete-1",name:"Demo athlete 1",kind:"athlete",amountWei:mon(4),claim:"submitted",payment:"processing",transactionHash:null,paidAt:null}]}]}]};
});
function show(path="/rewards/programmes/demo",locale:"en"|"hr"="en"){
 render(<I18nProvider initialLocale={locale}><MemoryRouter initialEntries={[path]}><Routes>
 <Route path="/rewards" element={<RewardsHome/>}/><Route path="/rewards/pots" element={<RewardPotsDirectory/>}/>
 <Route path="/rewards/programmes/:programmeId" element={<PublicDistributionReport/>}/>
 <Route path="/rewards/programmes/:programmeId/pots/:potId" element={<PublicDistributionReport/>}/>
 </Routes></MemoryRouter></I18nProvider>);
}
it("shows recipient totals across pots and drills into allocation, claim and receipt evidence",()=>{
 show();
 const row=screen.getByRole("rowheader",{name:"Demo athlete 1"}).closest("tr")!;
 expect(within(row).getAllByRole("cell").map(c=>c.textContent)).toEqual(["2","4","6","2"]);
 const links=screen.getAllByRole("link",{name:/Round 1/});fireEvent.click(links[0]);
 const paid=screen.getByRole("rowheader",{name:"Demo athlete 1"}).closest("tr")!;
 expect(within(paid).getByText("Awarded")).toBeVisible();expect(within(paid).getByText("Claim submitted")).toBeVisible();expect(within(paid).getByText("Paid")).toBeVisible();
 expect(within(paid).getByRole("link",{name:"Receipt ↗"})).toHaveAttribute("href",`https://testnet.monadvision.com/tx/0x${"a".repeat(64)}`);
 fireEvent.change(screen.getByLabelText("Payment status"),{target:{value:"unpaid"}});
 expect(screen.queryByRole("rowheader",{name:"Demo athlete 1"})).not.toBeInTheDocument();
 expect(screen.getByRole("rowheader",{name:"Demo athlete 2"})).toBeVisible();
 expect(screen.getByText("Not claimed")).toBeVisible();
});
it("shows processing without inventing a confirmed receipt",()=>{
 show("/rewards/programmes/demo/pots/league");expect(screen.getByText("Processing")).toBeVisible();
 expect(screen.queryByRole("link",{name:"Receipt ↗"})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole("button",{name:"History"}));
 expect(screen.getByText("League pot · allocation approved")).toBeVisible();
 expect(screen.queryByText(/athlete 1 · paid/)).not.toBeInTheDocument();
});
it("handles no matches, rules and Croatian labels",()=>{
 show("/rewards/programmes/demo/pots/round-1","hr");
 fireEvent.change(screen.getByRole("searchbox"),{target:{value:"missing"}});
 expect(screen.getByText("Nema pronađenih primatelja.")).toBeVisible();
 fireEvent.click(screen.getByRole("button",{name:"Pravila"}));expect(screen.getByText("Odobrena podjela proračuna")).toBeVisible();
 expect(screen.getByText("Plasman sportaša")).toBeVisible();
});
it("keeps active reports separate from planned budgets on the homepage",()=>{
 show("/rewards");expect(screen.getByRole("heading",{name:"Synthetic demo"})).toBeVisible();
 fireEvent.click(screen.getByRole("button",{name:"Planned"}));expect(screen.queryByRole("heading",{name:"Synthetic demo"})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole("button",{name:"Active"}));expect(screen.queryByRole("heading",{name:"Šibenik Trail League"})).not.toBeInTheDocument();
 expect(screen.getByRole("link",{name:/View distribution/})).toBeVisible();
});
it("searches pots across planned and published programmes",()=>{
 show("/rewards/pots");fireEvent.change(screen.getByRole("searchbox"),{target:{value:"Synthetic demo"}});
 expect(screen.getAllByRole("link").filter(link=>link.getAttribute("href")?.includes("/pots/"))).toHaveLength(2);
 fireEvent.change(screen.getByLabelText("Pot type"),{target:{value:"league"}});
 expect(screen.getAllByRole("link").filter(link=>link.getAttribute("href")?.includes("/pots/"))).toHaveLength(1);
 expect(screen.getAllByRole("link").find(link=>link.getAttribute("href")==="/rewards/programmes/demo/pots/league")).toBeVisible();
});
it("distinguishes failed loading and missing reports from an empty ledger",()=>{
 state.data=null;state.failed=true;show();expect(screen.getByRole("alert")).toHaveTextContent("could not be loaded");
 fireEvent.click(screen.getByRole("button",{name:"Try again"}));expect(state.retry).toHaveBeenCalledOnce();
 expect(screen.queryByRole("table")).not.toBeInTheDocument();
});
it("uses the interactive branch selection to show the matching pot table and restores the whole programme",()=>{
 show();
 fireEvent.change(screen.getByLabelText("View branch"),{target:{value:"pot:round-1"}});
 expect(screen.getByRole("table")).toHaveTextContent("Claim");
 expect(screen.getByRole("link",{name:"Open pot →"})).toHaveAttribute("href","/rewards/programmes/demo/pots/round-1");
 fireEvent.change(screen.getByLabelText("View branch"),{target:{value:"pot:round-1:athlete_standings"}});
 expect(screen.getByText(/table shows combined awards/)).toBeVisible();
 expect(screen.getByRole("rowheader",{name:"Demo athlete 2"})).toBeVisible();
 fireEvent.click(screen.getByRole("button",{name:"Whole programme ›"}));
 expect(screen.getByRole("table")).toHaveTextContent("Rewards by recipient and pot");
});
it("restores branch deep links and falls back safely for an unknown branch",()=>{
 show("/rewards/programmes/demo?branch=pot:league");
 expect(screen.getByLabelText("View branch")).toHaveValue("pot:league");
 expect(screen.getByRole("table")).toHaveTextContent("Processing");
 expect(screen.queryByRole("rowheader",{name:"Demo athlete 2"})).not.toBeInTheDocument();
});

vi.mock("../components/DistributionFlowChart", () => ({default:()=>null}));
it("gives every league split its own exact recipient table, totals and deep link",()=>{
 const league=state.data!.programmes[0].pots[1];
 league.pools=[
  {key:"athlete_standings",budgetWei:mon(10),awards:[{recipientId:"athlete-1",amountWei:mon(1)}]},
  {key:"participation",budgetWei:mon(10),awards:[{recipientId:"athlete-1",amountWei:mon(3)}]},
 ];
 show("/rewards/programmes/demo?branch=pot:league");
 const splits=screen.getByRole("region",{name:"League pot splits"});
 fireEvent.click(within(splits).getByRole("button",{name:/Athlete standings/}));
 expect(screen.getByRole("table")).toHaveAccessibleName("League pot · Athlete standings · test MON");
 const row=screen.getByRole("rowheader",{name:"Demo athlete 1"}).closest("tr")!;
 expect(within(row).getAllByRole("cell")[0]).toHaveTextContent(/^1$/);
 expect(within(row).getByText("Processing")).toBeVisible();
 expect(screen.getByText(/combined pot award/)).toBeVisible();
 expect(screen.getByRole("link",{name:"Open pot →"})).toHaveAttribute("href","/rewards/programmes/demo/pots/league?branch=pot%3Aleague%3Aathlete_standings");
 fireEvent.click(within(splits).getByRole("button",{name:/Distance participation/}));
 expect(screen.getByRole("table")).toHaveAccessibleName("League pot · Distance participation · test MON");
 expect(within(screen.getByRole("rowheader",{name:"Demo athlete 1"}).closest("tr")!).getAllByRole("cell")[0]).toHaveTextContent(/^3$/);
});
it("restores an empty split without falling back to combined awards",()=>{
 const league=state.data!.programmes[0].pots[1];
 league.pools.push({key:"club_standings",budgetWei:mon(0),awards:[]});
 show("/rewards/programmes/demo/pots/league?branch=pot:league:club_standings");
 expect(screen.getByRole("table")).toHaveAccessibleName("League pot · Club standings · test MON");
 expect(screen.getByText("No matching recipients.")).toBeVisible();
 expect(screen.queryByRole("rowheader",{name:"Demo athlete 1"})).not.toBeInTheDocument();
});
