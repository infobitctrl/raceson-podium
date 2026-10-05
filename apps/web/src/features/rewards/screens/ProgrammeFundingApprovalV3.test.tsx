import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { createDefaultRewardProgrammeDraftV2, type SavedRewardPlanningDraft } from "@raceson/domain/rewards/programme-draft-v2";
import { decodeProgrammeApprovalV3 } from "@raceson/domain/rewards/programme-approval-v3";
import { I18nProvider } from "@/shared/i18n/I18nProvider";
import ProgrammeFundingApprovalV3 from "./ProgrammeFundingApprovalV3";
const mock=vi.hoisted(()=>({request:vi.fn()}));
vi.mock("../data/programmeApprovalV3",()=>({programmeApprovalV3:(...args:unknown[])=>mock.request(...args)}));
const id=(n:number)=>`87000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const record=():SavedRewardPlanningDraft=>({draftId:id(1),organizationId:id(2),seasonId:id(3),chainId:31337,organizationName:"Synthetic org",seasonName:"Synthetic season",
  revision:1,updatedAt:"2026-09-10T00:00:00Z",rules:createDefaultRewardProgrammeDraftV2()});
const terms=()=>({funderAddress:`0x${"a".repeat(40)}`,operatorAddress:`0x${"b".repeat(40)}`,reviewPeriods:Array(6).fill(86400)});
function view(){
  const rounds=Array.from({length:5},(_,i)=>({id:id(10+i),editionId:id(20+i),slot:i+1,name:`Synthetic round ${i+1}`,date:"2026-10-03",status:"draft",
    races:[{id:id(30+i),competitionId:id(40),name:"Synthetic race",distanceMetres:"15000",publicationId:null,publicationState:null,resultCount:0}]}));
  return decodeProgrammeApprovalV3({schema:"raceson-programme-approval-v3",record:record(),workspace:{draftId:id(1),revision:1,rulesRevision:1,catalogueHash:"a".repeat(64),boundCatalogueHash:"a".repeat(64),
    mapping:{version:2,leagueCategories:[],rounds:rounds.map(r=>({slot:r.slot,roundId:r.id,categories:[]}))},catalogue:{rounds,categories:[]}},contextHash:"c".repeat(64),approval:null,operationsEnabled:false});
}
function component(locale:"en"|"hr"="en",r=record()){return <I18nProvider initialLocale={locale}><ProgrammeFundingApprovalV3 key={`${r.draftId}:${r.revision}`} record={r}/></I18nProvider>}
async function open(){fireEvent.click(screen.getByRole("button",{name:"Review funding plan"}));await screen.findByLabelText("Nominated funder address")}
function fill(){fireEvent.change(screen.getByLabelText("Nominated funder address"),{target:{value:terms().funderAddress}});
  fireEvent.change(screen.getByLabelText("Nominated operator address"),{target:{value:terms().operatorAddress}});fireEvent.click(screen.getByRole("checkbox"))}
beforeEach(()=>{mock.request.mockReset().mockResolvedValue(view())});
it("loads only on demand, requires complete scopes, valid nominated roles and explicit confirmation",async()=>{
  render(component());expect(mock.request).not.toHaveBeenCalled();await open();
  expect(screen.getAllByRole("spinbutton")).toHaveLength(6);expect(screen.getByRole("button",{name:"Approve funding plan"})).toBeDisabled();
  fill();expect(screen.getByRole("button",{name:"Approve funding plan"})).toBeEnabled();
  fireEvent.change(screen.getByLabelText("Nominated operator address"),{target:{value:terms().funderAddress}});
  expect(screen.getByRole("checkbox")).not.toBeChecked();expect(screen.getByRole("button",{name:"Approve funding plan"})).toBeDisabled();
});
it("blocks unmapped round five without inventing its event or funding destination",async()=>{
  const partial=view();partial.workspace.mapping.rounds[4].roundId=null;mock.request.mockResolvedValue(partial);render(component());await open();fill();
  expect(screen.getByText(/Missing or incomplete rounds: 5/)).toBeVisible();expect(screen.getByRole("button",{name:"Approve funding plan"})).toBeDisabled();
  expect(mock.request).toHaveBeenCalledTimes(1);
});
it("stores exact approval, discloses zero review and never invokes signing or payment",async()=>{
  mock.request.mockImplementation(async(_r,body)=>body?{...view(),approval:{id:body.requestId,rulesRevision:1,mappingRevision:1,contextHash:body.contextHash,
    terms:body.terms,approvedAt:"2026-09-10T00:02:00Z",current:true}}:view());
  render(component());await open();fill();fireEvent.change(screen.getAllByRole("spinbutton")[0],{target:{value:"0"}});
  expect(screen.getByText(/Zero explicitly proposes/)).toBeVisible();expect(screen.getByRole("checkbox")).not.toBeChecked();fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button",{name:"Approve funding plan"}));await screen.findByText("Funding specification saved · execution checks still required");
  const body=mock.request.mock.calls[1][1];expect(body).toEqual({requestId:expect.any(String),expectedApprovalId:null,contextHash:view().contextHash,
    terms:{...terms(),reviewPeriods:[0,86400,86400,86400,86400,86400]}});
  expect(screen.getByRole("button",{name:"Approve funding plan"})).toBeDisabled();expect(screen.getByText(/does not deploy a contract, move MON/)).toBeVisible();
});
it("keeps the identical uncertain request, freezes inputs and recovers without duplicate decisions",async()=>{
  mock.request.mockResolvedValueOnce(view()).mockRejectedValueOnce(new Error("private failure"));render(component());await open();fill();
  fireEvent.click(screen.getByRole("button",{name:"Approve funding plan"}));await screen.findByRole("alert");
  expect(screen.getByLabelText("Nominated funder address")).toBeDisabled();expect(screen.queryByText("private failure")).not.toBeInTheDocument();
  const body=mock.request.mock.calls[1][1];mock.request.mockResolvedValueOnce({...view(),approval:{id:body.requestId,rulesRevision:1,mappingRevision:1,contextHash:body.contextHash,
    terms:body.terms,approvedAt:"2026-09-10T00:02:00Z",current:true}});
  fireEvent.click(screen.getByRole("button",{name:"Retry the same approval"}));await screen.findByText("Funding specification saved · execution checks still required");
  expect(mock.request.mock.calls[2][1]).toEqual(body);expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
it("failed reload hides old approval and a fresh read recovers; superseded revisions cannot repopulate it",async()=>{
  render(component());await open();mock.request.mockRejectedValueOnce(new Error("unavailable"));
  fireEvent.click(screen.getByRole("button",{name:"Reload funding approval"}));await screen.findByRole("alert");expect(screen.queryByLabelText("Nominated funder address")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"Reload funding approval"}));await screen.findByLabelText("Nominated funder address");expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
it("late request completion cannot populate a different saved revision",async()=>{
  let resolve!:(v:unknown)=>void;mock.request.mockImplementationOnce(()=>new Promise(r=>{resolve=r}));
  const ui=render(component());fireEvent.click(screen.getByRole("button",{name:"Review funding plan"}));ui.rerender(component("en",{...record(),revision:2}));
  await act(async()=>resolve(view()));await waitFor(()=>expect(screen.queryByLabelText("Nominated funder address")).not.toBeInTheDocument());
});
it("Croatian approval controls and pending-scope warning are localized",async()=>{
  const partial=view();partial.workspace.mapping.rounds[4].roundId=null;mock.request.mockResolvedValue(partial);render(component("hr"));
  fireEvent.click(screen.getByRole("button",{name:"Pregledaj plan financiranja"}));await screen.findByLabelText("Predložena adresa financijera");
  expect(screen.getByText(/Nepovezana ili nepotpuna kola: 5/)).toBeVisible();expect(screen.getByRole("button",{name:"Odobri plan financiranja"})).toBeDisabled();
});
