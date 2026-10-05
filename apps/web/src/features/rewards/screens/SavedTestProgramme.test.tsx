import {act,fireEvent,render,screen,within,waitFor} from "@testing-library/react";
import {MemoryRouter} from "react-router-dom";
import {beforeEach,expect,it,vi} from "vitest";
import {I18nProvider} from "@/shared/i18n/I18nProvider";
import {ApiError} from "@/lib/api";
import {createTestProgramme,type SavedTestProgramme as Saved} from "@raceson/domain/rewards/test-programme";
import SavedTestProgramme from "./SavedTestProgramme";
const mocks=vi.hoisted(()=>({user:"owner",session:{access_token:"a"},save:vi.fn(),read:vi.fn()}));
vi.mock("@/lib/auth",()=>({useAuth:()=>({user:mocks.user?{id:mocks.user}:null,session:mocks.session,account:{userId:mocks.user},isLoading:false})}));
vi.mock("../data/testProgrammes",()=>({readTestProgramme:mocks.read,saveTestProgramme:mocks.save}));
const id="72000000-0000-4000-8000-000000000001";
const record:Saved={id,chainId:10143,revision:1,updatedAt:"2026-09-16T12:00:00.000Z",configuration:{name:"Saved two-round test",budgetMon:100,order:createTestProgramme(2,10),rule:"rank",approved:false,claims:{}}};
beforeEach(()=>{mocks.user="owner";mocks.session={access_token:"a"};mocks.save.mockReset();mocks.read.mockReset();});
const view=(path="/rewards/test")=><I18nProvider initialLocale="en"><MemoryRouter initialEntries={[path]}><SavedTestProgramme/></MemoryRouter></I18nProvider>;
it("creates a private named test and reopens the saved response",async()=>{
 mocks.save.mockImplementation(async(newId,change)=>({...record,id:newId,configuration:change.configuration}));
 mocks.read.mockImplementation(async(newId)=>({...record,id:newId,configuration:{...record.configuration,name:"Weekend test"}}));
 render(view());fireEvent.change(screen.getByLabelText("Programme name"),{target:{value:"Weekend test"}});
 fireEvent.click(screen.getByRole("button",{name:"Save test programme"}));
 await screen.findByText("Saved to your account");expect(mocks.save).toHaveBeenCalledOnce();
 const [newId,request]=mocks.save.mock.calls[0];expect(request.expectedRevision).toBe(0);expect(request.configuration.order).toHaveLength(2);expect(request.configuration.order[0]).toHaveLength(10);
 await waitFor(()=>expect(mocks.read).toHaveBeenCalledWith(newId));expect(await screen.findByDisplayValue("Weekend test")).toBeVisible();
});
it("retries an uncertain save with the identical request and locks edits",async()=>{
 mocks.read.mockResolvedValue(record);mocks.save.mockRejectedValueOnce(new Error("network")).mockImplementationOnce(async(_id,change)=>({...record,revision:2,configuration:change.configuration}));
 render(view(`/rewards/test?test=${id}`));await screen.findByDisplayValue(record.configuration.name);
 fireEvent.change(screen.getByLabelText("Programme name"),{target:{value:"Updated test"}});fireEvent.click(screen.getByRole("button",{name:"Save changes"}));
 await screen.findByText(/save is not confirmed/);expect(screen.getByLabelText("Programme name")).toBeDisabled();
 fireEvent.click(screen.getByRole("button",{name:"Retry save"}));await screen.findByText("Saved to your account");
 expect(mocks.save.mock.calls[1]).toEqual(mocks.save.mock.calls[0]);
});
it("keeps simulated paid state across reloads and resets it on rule edits",async()=>{
 mocks.read.mockResolvedValue({...record,configuration:{...record.configuration,approved:true,claims:{"0:0":"paid"}}});
 render(view(`/rewards/test?test=${id}`));await screen.findByText("Paid (test)");
 fireEvent.change(screen.getByLabelText("Distribution",{selector:"select"}),{target:{value:"equal"}});
 expect(screen.queryByText("Paid (test)")).not.toBeInTheDocument();expect(screen.getByText("Unsaved changes")).toBeVisible();
});
it("reloads a conflicting revision only on explicit action",async()=>{
 mocks.read.mockResolvedValueOnce(record).mockResolvedValue({...record,revision:3,configuration:{...record.configuration,name:"Other saved edit"}});
 mocks.save.mockRejectedValue(new ApiError("Conflict",{status:409,code:"reward_test_conflict"}));
 render(view(`/rewards/test?test=${id}`));await screen.findByDisplayValue(record.configuration.name);
 fireEvent.change(screen.getByLabelText("Programme name"),{target:{value:"My edit"}});fireEvent.click(screen.getByRole("button",{name:"Save changes"}));
 const reload=await screen.findByRole("button",{name:"Reload saved version"});expect(screen.getByLabelText("Programme name")).toHaveValue("My edit");
 fireEvent.click(reload);await screen.findByDisplayValue("Other saved edit");
});
it("retires a late private load after identity changes",async()=>{
 let finish!:(value:Saved)=>void;mocks.read.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;})).mockRejectedValueOnce(new Error("not found"));
 const page=render(view(`/rewards/test?test=${id}`));mocks.user="other";mocks.session={access_token:"b"};page.rerender(view(`/rewards/test?test=${id}`));
 await screen.findByText("Test programme unavailable");await act(async()=>finish(record));expect(screen.queryByDisplayValue(record.configuration.name)).not.toBeInTheDocument();
});
it("keeps anonymous simulations available without fetching private tests",()=>{
 mocks.user="";render(view());expect(screen.getByRole("link",{name:/Sign in to save/})).toBeVisible();expect(mocks.read).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole("button",{name:"Approve simulated allocation"}));expect(within(screen.getByRole("table",{name:"Simulated reward distribution"})).getAllByText("Awarded")).toHaveLength(20);
 expect(mocks.save).not.toHaveBeenCalled();
});
