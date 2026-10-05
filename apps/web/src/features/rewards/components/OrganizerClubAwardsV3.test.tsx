import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { I18nProvider } from "@/shared/i18n/I18nProvider";
import OrganizerClubAwardsV3 from "./OrganizerClubAwardsV3";
import type { OrganizerClubAwardScopeV3 } from "@raceson/domain/rewards/organizer-club-awards-v3";
const calls=vi.hoisted(()=>({list:vi.fn(),read:vi.fn(),make:vi.fn(),prepare:vi.fn()}));
vi.mock("../data/organizerClubAwardsV3",()=>({getOrganizerClubAwardsV3:calls.list}));
vi.mock("../data/organizerClubPreparationV3",()=>({getOrganizerClubReadinessV3:calls.read,makeOrganizerClubPreparationV3:calls.make,prepareOrganizerClubClaimV3:calls.prepare}));
const id=(n:number)=>`8fb00000-0000-4000-8000-${String(n).padStart(12,"0")}`, address=`0x${"a".repeat(40)}`, entitlement=`0x${"b".repeat(64)}`;
const context:OrganizerClubAwardScopeV3={chainId:10143,uploadId:id(1),draftId:id(2),approvalId:id(3),slot:2,campaignAddress:address};
const row={entitlementId:entitlement,clubId:id(4),clubName:"Synthetic Club",amountWei:"100000000000000001",
  nomination:{requestId:id(5),address:`0x${"c".repeat(40)}`,status:"pending_review"},claim:null};
const page=()=>({...context,schema:"raceson-organizer-club-awards-v3",allocationRevision:"latest",items:[{...row}],nextCursor:null});
const mount=(locale:"en"|"hr"="en",dirty=false)=>render(<I18nProvider initialLocale={locale}><OrganizerClubAwardsV3 context={context} dirty={dirty}/></I18nProvider>);
beforeEach(()=>{Object.values(calls).forEach(m=>m.mockReset());calls.list.mockResolvedValue(page());calls.read.mockResolvedValue({state:"reviewed"});
  calls.make.mockImplementation((selection,readiness)=>({selection,body:readiness}));calls.prepare.mockResolvedValue({claimId:id(6),recipientConsented:false,operatorApproved:false});});
async function open(locale:"en"|"hr"="en") {
  fireEvent.click(screen.getByRole("button",{name:locale==="hr"?"Prikaži klupske nagrade":"Show club awards"}));await screen.findByText("Synthetic Club");
  fireEvent.click(screen.getByRole("button",{name:locale==="hr"?"Pregledaj riznicu i zahtjev":"Review treasury and claim"}));
  await screen.findByRole("checkbox");
}
it.each(["en","hr"] as const)("requires explicit exact preparation and never claims payment in %s",async locale=>{
  mount(locale);expect(calls.list).not.toHaveBeenCalled();await open(locale);
  const button=screen.getByRole("button",{name:locale==="hr"?"Pripremi točan klupski zahtjev":"Prepare exact club claim"});expect(button).toBeDisabled();
  expect(screen.getByRole("region",{name:locale==="hr"?"Provjera riznice":"Treasury review"})).toHaveFocus();
  fireEvent.click(screen.getByRole("checkbox"));fireEvent.click(button);
  await screen.findByText(locale==="hr"?/Zahtjev je pripremljen/:/Claim prepared ·/);
  expect(calls.prepare).toHaveBeenCalledTimes(1);expect(calls.make.mock.calls[0][0].award).toMatchObject({amountWei:row.amountWei,recipientAddress:row.nomination.address,uploadId:context.uploadId});
  expect(screen.queryByRole("button",{name:/^Pay|Isplati/})).not.toBeInTheDocument();
});
it("holds absent, withdrawn and identity-held treasuries without hiding reserved amounts",async()=>{
  const p=page();p.items=[{...row,nomination:null},{...row,entitlementId:`0x${"d".repeat(64)}`,nomination:{...row.nomination,status:"withdrawn"}},
    {...row,entitlementId:`0x${"e".repeat(64)}`,nomination:{...row.nomination,status:"identity_hold"}}] as typeof p.items;
  calls.list.mockResolvedValue(p);mount();fireEvent.click(screen.getByRole("button",{name:"Show club awards"}));await screen.findByText(/No treasury nominated/);
  expect(screen.getAllByRole("button",{name:"Review treasury and claim"}).every(b=>(b as HTMLButtonElement).disabled)).toBe(true);
  expect(screen.getAllByText(/0.100000000000000001/)).toHaveLength(3);expect(calls.read).not.toHaveBeenCalled();
});
it.each(["unreviewed","source_hold","identity_changed","revoked"])("does not expose preparation for %s",async state=>{
  calls.read.mockResolvedValue({state});mount();fireEvent.click(screen.getByRole("button",{name:"Show club awards"}));await screen.findByText("Synthetic Club");
  fireEvent.click(screen.getByRole("button",{name:"Review treasury and claim"}));await screen.findByText(state==="unreviewed"?/Treasury not reviewed/:/Preparation held/);
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();expect(calls.make).not.toHaveBeenCalled();
});
it("retries only the same uncertain command and rejects double clicks",async()=>{
  calls.prepare.mockRejectedValueOnce(Error("lost"));mount();await open();fireEvent.click(screen.getByRole("checkbox"));
  const button=screen.getByRole("button",{name:"Prepare exact club claim"});fireEvent.click(button);fireEvent.click(button);
  await screen.findByRole("alert");expect(calls.prepare).toHaveBeenCalledTimes(1);const original=calls.prepare.mock.calls[0][0];
  expect(screen.getByRole("button",{name:"Refresh club awards"})).toBeDisabled();
  fireEvent.click(screen.getByRole("button",{name:"Retry the same preparation"}));await screen.findByText(/Claim prepared ·/);
  expect(calls.prepare.mock.calls[1][0]).toBe(original);expect(calls.make).toHaveBeenCalledTimes(1);
});
it("existing claims and superseded allocations never offer duplicate preparation",async()=>{
  const p=page();p.items[0].claim={claimId:id(8),requestId:id(5),recipientAddress:row.nomination.address,recipientConsented:true,operatorApproved:false} as never;
  calls.list.mockResolvedValue(p);const v=mount();fireEvent.click(screen.getByRole("button",{name:"Show club awards"}));await screen.findByText("Synthetic Club");
  fireEvent.click(screen.getByRole("button",{name:"Review treasury and claim"}));await screen.findByText(/A claim already exists/);
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();v.unmount();
  calls.list.mockResolvedValue({...page(),allocationRevision:"superseded"});mount();fireEvent.click(screen.getByRole("button",{name:"Show club awards"}));
  await screen.findByText(/Superseded allocation/);expect(screen.getByRole("button",{name:"Review treasury and claim"})).toBeDisabled();
});
it("clears private list on failed refresh and ignores an old context's late response",async()=>{
  const v=mount();fireEvent.click(screen.getByRole("button",{name:"Show club awards"}));await screen.findByText("Synthetic Club");
  calls.list.mockRejectedValueOnce(Error("private error"));fireEvent.click(screen.getByRole("button",{name:"Refresh club awards"}));await screen.findByRole("alert");
  expect(screen.queryByText("Synthetic Club")).not.toBeInTheDocument();
  let resolve!:(v:unknown)=>void;calls.list.mockImplementationOnce(()=>new Promise(r=>resolve=r));fireEvent.click(screen.getByRole("button",{name:"Show club awards"}));
  v.rerender(<I18nProvider initialLocale="en"><OrganizerClubAwardsV3 context={{...context,uploadId:id(90)}} dirty/></I18nProvider>);
  await act(async()=>resolve(page()));expect(screen.queryByText("Synthetic Club")).not.toBeInTheDocument();expect(screen.getByRole("button",{name:"Show club awards"})).toBeDisabled();
});
it("closes review without preparing and removes the old selection",async()=>{
  mount();await open();fireEvent.click(screen.getByRole("button",{name:"Close review"}));
  expect(screen.queryByRole("region",{name:"Treasury review"})).not.toBeInTheDocument();expect(calls.prepare).not.toHaveBeenCalled();
  expect(screen.getByRole("button",{name:"Show club awards"})).toBeEnabled();
});
