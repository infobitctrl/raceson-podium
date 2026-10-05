import {act,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {MemoryRouter,Route,Routes,useLocation} from "react-router-dom";
import {beforeEach,expect,it,vi} from "vitest";
import {I18nProvider} from "@/shared/i18n/I18nProvider";
import {ApiError} from "@/lib/api";
import CreateRewardProgramme from "./CreateRewardProgramme";
const mock=vi.hoisted(()=>({user:"owner",organizer:true,token:"a",sources:vi.fn(),create:vi.fn()}));
vi.mock("@/lib/auth",()=>({useAuth:()=>({user:mock.user?{id:mock.user}:null,session:{access_token:mock.token,refresh_token:"test-refresh",user:{id:mock.user},expires_at:1900000000,token_type:"bearer"},account:{userId:mock.user,hasOrganizerAccess:mock.organizer},isLoading:false})}));
vi.mock("../data/programmeCreation",()=>({programmeSources:mock.sources,createProgramme:mock.create}));
vi.mock("../components/DistributionExplorer",()=>({default:()=> <p>Distribution preview</p>}));
const source={seasonId:"82000000-0000-4000-8000-000000000001",organizationId:"82000000-0000-4000-8000-000000000003",seasonName:"Weekend league",organizationName:"Demo host",draftId:null};
function Destination(){return <p>{useLocation().search}</p>;}
const page=()=> <I18nProvider initialLocale="en"><MemoryRouter initialEntries={["/rewards/create"]}><Routes><Route path="/rewards/create" element={<CreateRewardProgramme/>}/><Route path="/rewards/setup" element={<Destination/>}/></Routes></MemoryRouter></I18nProvider>;
beforeEach(()=>{mock.user="owner";mock.organizer=true;mock.token="a";mock.sources.mockReset().mockResolvedValue([source]);mock.create.mockReset().mockImplementation(async change=>({draftId:change.draftId}));});
async function choose(){fireEvent.change(await screen.findByLabelText("League and season"),{target:{value:source.seasonId}});}
it("creates a saved draft for the chosen season and opens its workspace",async()=>{
 render(page());await choose();fireEvent.change(screen.getByLabelText("Budget · test MON"),{target:{value:"500"}});fireEvent.click(screen.getByRole("button",{name:"Create programme draft"}));
 await waitFor(()=>expect(mock.create).toHaveBeenCalledOnce());const change=mock.create.mock.calls[0][0];expect(change.seasonId).toBe(source.seasonId);expect(change.budgetMon).toBe("500");expect(await screen.findByText(`?programme=${change.draftId}`)).toBeVisible();
});
it("retries uncertain creation with the same identity and locks settings",async()=>{
 mock.create.mockRejectedValueOnce(new Error("network"));render(page());await choose();fireEvent.click(screen.getByRole("button",{name:"Create programme draft"}));
 await screen.findByRole("alert");expect(screen.getByLabelText("Budget · test MON")).toBeDisabled();expect(screen.getByLabelText("League and season")).toBeDisabled();
 fireEvent.click(screen.getByRole("button",{name:"Retry creation"}));await waitFor(()=>expect(mock.create).toHaveBeenCalledTimes(2));expect(mock.create.mock.calls[1]).toEqual(mock.create.mock.calls[0]);
});
it("opens an existing programme and refuses to create a duplicate",async()=>{
 mock.sources.mockResolvedValue([{...source,draftId:"existing"}]);render(page());await choose();expect(screen.getByRole("link",{name:"Open existing programme →"})).toHaveAttribute("href","/rewards/setup?programme=existing");expect(screen.queryByRole("button",{name:"Create programme draft"})).not.toBeInTheDocument();
});
it("reloads sources after a competing creation",async()=>{
 mock.create.mockRejectedValueOnce(new ApiError("exists",{status:409,code:"reward_programme_exists"}));mock.sources.mockResolvedValueOnce([source]).mockResolvedValueOnce([{...source,draftId:"newer"}]);
 render(page());await choose();fireEvent.click(screen.getByRole("button",{name:"Create programme draft"}));expect(await screen.findByRole("link",{name:"Open existing programme →"})).toHaveAttribute("href","/rewards/setup?programme=newer");
});
it("keeps athlete accounts outside organizer sources and offers a private simulation",()=>{
 mock.organizer=false;render(page());expect(screen.getByRole("link",{name:"Create test programme →"})).toBeVisible();expect(mock.sources).not.toHaveBeenCalled();
});
it("retires a late private source reply when the account changes",async()=>{
 let finish!:(v:unknown)=>void;mock.sources.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));const ui=render(page());mock.organizer=false;mock.user="athlete";mock.token="b";ui.rerender(page());await act(async()=>finish([source]));expect(screen.queryByText(/Weekend league/)).not.toBeInTheDocument();
});

it("connects a season inline without leaving the setup workspace or creating a duplicate",async()=>{
 const selected=vi.fn();mock.sources.mockResolvedValue([{...source,draftId:"existing"}]);
 render(<I18nProvider initialLocale="en"><MemoryRouter><CreateRewardProgramme onSelected={selected}/></MemoryRouter></I18nProvider>);await choose();
 fireEvent.click(screen.getByRole("button",{name:"Use this season"}));expect(selected).toHaveBeenCalledWith("existing");expect(mock.create).not.toHaveBeenCalled();expect(screen.queryByText("Distribution preview")).not.toBeInTheDocument();
});
it("creates the embedded season draft with the campaign budget and preserves it across uncertain retries",async()=>{
 const selected=vi.fn();mock.create.mockRejectedValueOnce(new Error("network"));
 const embedded=(budget:string)=><I18nProvider initialLocale="en"><MemoryRouter><CreateRewardProgramme initialBudgetMon={budget} onSelected={selected}/></MemoryRouter></I18nProvider>;
 const ui=render(embedded("100"));await choose();
 expect(screen.queryByLabelText("Budget · test MON")).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole("button",{name:"Select league"}));await screen.findByRole("alert");
 expect(mock.create.mock.calls[0][0].budgetMon).toBe("100");
 ui.rerender(embedded("200"));fireEvent.click(screen.getByRole("button",{name:"Retry creation"}));
 await waitFor(()=>expect(mock.create).toHaveBeenCalledTimes(2));
 expect(mock.create.mock.calls[1]).toEqual(mock.create.mock.calls[0]);
 expect(selected).toHaveBeenCalledWith(mock.create.mock.calls[0][0].draftId);
});
it("uses the current embedded budget if the campaign changes before creation",async()=>{
 const selected=vi.fn();const embedded=(budget:string)=><I18nProvider initialLocale="en"><MemoryRouter><CreateRewardProgramme initialBudgetMon={budget} onSelected={selected}/></MemoryRouter></I18nProvider>;
 const ui=render(embedded("100000"));await choose();ui.rerender(embedded("100"));
 fireEvent.click(screen.getByRole("button",{name:"Select league"}));
 await waitFor(()=>expect(mock.create).toHaveBeenCalledOnce());expect(mock.create.mock.calls[0][0].budgetMon).toBe("100");
});
