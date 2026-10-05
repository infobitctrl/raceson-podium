import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { createDefaultRewardProgrammeDraftV2, type SavedRewardPlanningDraft } from "@raceson/domain/rewards/programme-draft-v2";
import { decodeProgrammeFundingV3, emptyProgrammeFundingV3 } from "@raceson/domain/rewards/programme-funding-v3";
import { I18nProvider } from "@/shared/i18n/I18nProvider";
import ProgrammeFundingV3 from "./ProgrammeFundingV3";
const mock=vi.hoisted(()=>({read:vi.fn()}));
vi.mock("../data/programmeFundingV3",()=>({readProgrammeFundingV3:(...args:unknown[])=>mock.read(...args)}));
vi.mock("./ProgrammeFundingApprovalV3",()=>({default:()=>null}));
vi.mock("./ProgrammeDepositV3",()=>({default:()=>null}));
const id=(n:number)=>`86000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const address=(n:number)=>`0x${String(n).padStart(40,"0")}`;
const record=():SavedRewardPlanningDraft=>({draftId:id(5),organizationId:id(2),seasonId:id(4),chainId:31337,organizationName:"Synthetic organization",
  seasonName:"Synthetic league",revision:1,updatedAt:"2026-09-09T12:00:00Z",rules:createDefaultRewardProgrammeDraftV2()});
// Explicit component fixture, never published as live chain evidence.
const verified=()=>decodeProgrammeFundingV3({...emptyProgrammeFundingV3(record()),status:"verified",observation:{
  address:address(1),funderAddress:address(2),operatorAddress:address(3),deploymentTransactionHash:`0x${"a".repeat(64)}`,
  deploymentBlockNumber:"1",deploymentBlockHash:`0x${"b".repeat(64)}`,blockNumber:"20",blockHash:`0x${"c".repeat(64)}`,blockTimestamp:"1788950000",
  depositedWei:"50000000000000000000001",totalRoutedWei:"40000000000000000000000",unroutedRefundedWei:"0",returnedWei:"0",returnsWithdrawnWei:"0",
  pendingFundingWei:"10000000000000000000001",pendingReturnsWei:"0",balanceWei:"10000000000000000000001",surplusWei:"0",fundingAborted:false,
  pots:Array.from({length:6},(_,slot)=>({slot,address:address(slot+10),capWei:slot===5?"50000000000000000000000":"10000000000000000000000",
    routed:slot<4,state:0,paused:false,accountedFundingWei:slot<4?"10000000000000000000000":"0",allocatedWei:"0",paidWei:"0",treasuryReturnedWei:"0",
    returnedToProgrammeWei:"0",balanceWei:slot<4?"10000000000000000000000":"0",remainingWei:slot<4?"10000000000000000000000":"0"})),
}},record());
function component(r=record(),locale:"en"|"hr"="en"){return <I18nProvider initialLocale={locale}><ProgrammeFundingV3 record={r}/></I18nProvider>}
beforeEach(()=>mock.read.mockReset().mockResolvedValue(emptyProgrammeFundingV3(record())));
it("shows six planned pots while unknown funding remains unverified, not zero",async()=>{
  render(component());await screen.findByText("Awaiting a registered programme deployment");
  expect(screen.getAllByText("Not verified")).toHaveLength(2);expect(screen.getByText("100,000 MON")).toBeVisible();
  expect(within(screen.getByRole("list")).getAllByRole("listitem")).toHaveLength(6);
  expect(screen.getAllByText("Planned · no verified deposit")).toHaveLength(6);
  expect(screen.queryByText("0 MON")).not.toBeInTheDocument();expect(screen.queryByText("Contract address")).not.toBeInTheDocument();
  expect(screen.getAllByRole("button")).toHaveLength(1);
});
it("shows exact deposited wei, four routed pots and two retained future pots without payment controls",async()=>{
  mock.read.mockResolvedValue(verified());render(component());await screen.findByText("50,000.000000000000000001 MON");
  expect(screen.getAllByText("Full pot routed")).toHaveLength(4);expect(screen.getAllByText("Not yet routed")).toHaveLength(2);
  fireEvent.click(screen.getAllByText("Inspect pot")[0]);expect(screen.getByText(address(10))).toBeVisible();
  fireEvent.click(screen.getByText("Inspect deployment and accounting"));expect(screen.getByText(address(1))).toBeVisible();
  expect(screen.getAllByRole("button")).toHaveLength(1);expect(screen.getByText(/funding balance does not approve race results/)).toBeVisible();
});
it("failed refresh clears previous balances and addresses and a subsequent read recovers",async()=>{
  mock.read.mockResolvedValueOnce(verified());render(component());await screen.findByText("50,000.000000000000000001 MON");
  mock.read.mockRejectedValueOnce(new Error("private provider failure"));fireEvent.click(screen.getByRole("button",{name:"Refresh funding"}));
  await screen.findByRole("alert");expect(screen.queryByText(address(1))).not.toBeInTheDocument();expect(screen.getAllByText("Not verified")).toHaveLength(2);
  expect(screen.queryByText(/private provider failure/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"Refresh funding"}));await screen.findByText("Awaiting a registered programme deployment");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
it("an old funding request cannot overwrite a newly selected revision",async()=>{
  let resolve!:(value:unknown)=>void;mock.read.mockImplementationOnce(()=>new Promise(r=>{resolve=r}));
  const ui=render(component()),next={...record(),revision:2};mock.read.mockResolvedValueOnce(emptyProgrammeFundingV3(next));ui.rerender(component(next));
  await screen.findByText("Awaiting a registered programme deployment");await act(async()=>resolve(verified()));
  await waitFor(()=>expect(screen.queryByText("50,000.000000000000000001 MON")).not.toBeInTheDocument());
  expect(screen.getByText(/Saved rules revision 2/)).toBeVisible();
});
it("Croatian funding labels and exact decimal amounts are localized",async()=>{
  mock.read.mockResolvedValue(verified());render(component(record(),"hr"));await screen.findByText("50.000,000000000000000001 MON");
  expect(screen.getByRole("heading",{name:"Financiranje programa"})).toBeVisible();expect(screen.getAllByText("Cijeli fond prenesen")).toHaveLength(4);
});
