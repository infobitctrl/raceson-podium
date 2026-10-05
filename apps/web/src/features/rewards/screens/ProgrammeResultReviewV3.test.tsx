import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { I18nProvider } from "@/shared/i18n/I18nProvider";
import ProgrammeResultReviewV3 from "./ProgrammeResultReviewV3";
const mock=vi.hoisted(()=>({call:vi.fn()}));
vi.mock("../data/resultReviewV3",()=>({resultReviewV3:(...args:unknown[])=>mock.call(...args)}));
const id=(n:number)=>`85000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const record=()=>({schema:"raceson-result-review-v3",categoryId:id(1),organizationId:id(2),observedAt:"2026-09-09T12:00:00Z",
  state:"unconfigured",revision:0,reviewSeconds:null,policyId:null,configuredAt:null,locked:false,held:false,
  startedAt:null,startedByPublicationId:null,endsAt:null,latestPublicationId:null,finalPublicationId:null,officialPublishedAt:null,allocationApproved:false});
function mount(){return render(<I18nProvider initialLocale="en"><ProgrammeResultReviewV3 organizationId={id(2)} races={[{id:id(1),name:"Synthetic race A"},{id:id(3),name:"Synthetic race B"}]} /></I18nProvider>)}
beforeEach(()=>{mock.call.mockReset().mockResolvedValue(record())});
const choose=()=>fireEvent.change(screen.getByRole("combobox",{name:"Race review policy"}),{target:{value:id(1)}});
it("loads only the selected race, makes zero explicit, and saves only revision and duration",async()=>{
  mount();expect(mock.call).not.toHaveBeenCalled();choose();const hours=await screen.findByRole("spinbutton");expect(hours).toHaveValue(24);
  expect(mock.call).toHaveBeenCalledWith(id(1),id(2));fireEvent.change(hours,{target:{value:"0"}});
  expect(screen.getByText(/Zero explicitly announces/)).toBeVisible();mock.call.mockResolvedValueOnce({...record(),state:"awaiting_provisional",revision:1,reviewSeconds:0});
  fireEvent.click(screen.getByRole("button",{name:"Save review policy"}));expect(await screen.findByText(/Policy saved. No review has started/)).toBeVisible();
  expect(mock.call).toHaveBeenLastCalledWith(id(1),id(2),{expectedRevision:0,reviewSeconds:0});
});
it("rejects blank or out-of-range hours and preserves edits until conflict reload",async()=>{
  mount();choose();const input=await screen.findByRole("spinbutton");
  for(const value of["","-1","721"]){fireEvent.change(input,{target:{value}});expect(screen.getByRole("button",{name:"Save review policy"})).toBeDisabled()}
  fireEvent.change(input,{target:{value:"1"}});mock.call.mockRejectedValueOnce({status:409});
  fireEvent.click(screen.getByRole("button",{name:"Save review policy"}));expect(await screen.findByRole("alert")).toHaveTextContent("Your edit was not saved");expect(input).toHaveValue(1);
  expect(screen.getByRole("button",{name:"Save review policy"})).toBeDisabled();
  fireEvent.click(screen.getByRole("button",{name:"Reload policy (discard edits)"}));await waitFor(()=>expect(screen.getByRole("spinbutton")).toHaveValue(24));
});
it("published clocks are read-only and final evidence never offers a payout control",async()=>{
  mock.call.mockResolvedValue({...record(),state:"final",revision:1,reviewSeconds:86400,locked:true,startedAt:"2026-09-08T10:00:00Z",
    endsAt:"2026-09-09T10:00:00Z",officialPublishedAt:"2026-09-09T11:00:00Z",finalPublicationId:id(4)});
  mount();choose();expect(await screen.findByRole("spinbutton")).toBeDisabled();expect(screen.queryByRole("button",{name:"Save review policy"})).not.toBeInTheDocument();
  expect(screen.getByText(/Official final evidence recorded/)).toBeVisible();expect(screen.getByText(/payout integration is still in development/)).toBeVisible();
});
it("missing historical sources are not empty editable races; failed reload removes earlier evidence",async()=>{
  mock.call.mockRejectedValueOnce({status:404});mount();choose();expect(await screen.findByRole("alert")).toHaveTextContent("historical review evidence");expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"Reload policy (discard edits)"}));await screen.findByRole("spinbutton");mock.call.mockRejectedValueOnce(new Error("offline"));
  fireEvent.click(screen.getByRole("button",{name:"Reload policy (discard edits)"}));expect(await screen.findByRole("alert")).toHaveTextContent("could not be verified");expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
});
it("an old race request cannot populate a newly selected race",async()=>{
  let resolve!: (value: unknown)=>void;mock.call.mockImplementationOnce(()=>new Promise(r=>{resolve=r}));mount();choose();
  fireEvent.change(screen.getByRole("combobox",{name:"Race review policy"}),{target:{value:id(3)}});
  await screen.findByRole("spinbutton");resolve({...record(),state:"held"});
  await waitFor(()=>expect(screen.queryByText("Open complaint or adjudication · rewards held")).not.toBeInTheDocument());
  expect(mock.call).toHaveBeenLastCalledWith(id(3),id(2));
});
