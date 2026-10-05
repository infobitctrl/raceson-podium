import { fireEvent, render, screen, waitFor, act } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { I18nProvider } from "@/shared/i18n/I18nProvider";
import PilotAcceptanceV3 from "./PilotAcceptanceV3";
const request=vi.hoisted(()=>vi.fn());
vi.mock("@/lib/api",()=>({apiRequest:request}));
const fixture=(round=2)=>({schema:"raceson-pilot-acceptance-v3",chainId:10143,draftId:"9a000000-0000-4000-8000-000000000052",round,
  viewHash:"a".repeat(64),campaignAddress:"0x"+"1".repeat(40),budgetWei:"10000000000000000000",allocatedWei:"5000000000000000000",
  unallocatedWei:"5000000000000000000",awardCount:14,athleteAmountWei:null,recipientAddress:"0x"+"2".repeat(40),reviewSeconds:0,
  nextAction:"review_results",held:false,waitingForConsent:false,expired:false,steps:[],recipientConsented:false,operatorApproved:false,
  paid:false,claimExpiresAt:null,paymentTransactionHash:null,claimId:null,maximumActionGasWei:"0"});
beforeEach(()=>request.mockReset().mockResolvedValue(fixture()));
const mount=(locale:"en"|"hr"="en")=>render(<MemoryRouter><I18nProvider initialLocale={locale}><PilotAcceptanceV3/></I18nProvider></MemoryRouter>);
it.each(["en","hr"] as const)("selects round four without sending and discards earlier confirmation in %s",async locale=>{
  mount(locale);await screen.findByRole("checkbox");fireEvent.click(screen.getByRole("checkbox"));
  request.mockResolvedValue(fixture(4));fireEvent.change(screen.getByRole("combobox"),{target:{value:"4"}});
  await waitFor(()=>expect(request).toHaveBeenLastCalledWith(expect.objectContaining({path:"/v1/organizer/rewards/local-pilot/4"})));
  await waitFor(()=>expect(screen.getByRole("checkbox")).not.toBeChecked());
  expect(screen.getByRole("option",{name:locale==="en"?"Round 4 — developer QA":"Kolo 4 — razvojna provjera"})).toBeInTheDocument();
  expect(request.mock.calls.filter(([r])=>r.method==="POST")).toHaveLength(0);
});
it.each(["en","hr"] as const)("requires exact explicit approval, no automatic sends, and renders in %s",async locale=>{
  mount(locale);const name=locale==="en"?"Review synthetic results":"Pregledaj sintetičke rezultate";
  const button=await screen.findByRole("button",{name});expect(button).toBeDisabled();expect(request).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("checkbox"));expect(button).toBeEnabled();fireEvent.click(button);
  await waitFor(()=>expect(request).toHaveBeenCalledTimes(2));
  expect(request.mock.calls[1][0]).toMatchObject({method:"POST",body:{action:"review_results",viewHash:"a".repeat(64)}});
  await waitFor(()=>expect(screen.getByRole("checkbox")).not.toBeChecked());
});
it("clears stale action after uncertain response and refreshes without resending",async()=>{
  mount();await screen.findByRole("checkbox");request.mockRejectedValueOnce(Error("private diagnostic"));
  fireEvent.click(screen.getByRole("checkbox"));fireEvent.click(screen.getByRole("button",{name:"Review synthetic results"}));
  await screen.findByRole("alert");expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();expect(screen.queryByText("private diagnostic")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"Refresh progress"}));await screen.findByRole("checkbox");
  expect(request.mock.calls.filter(([r])=>r.method==="POST")).toHaveLength(1);
});
it("rejects a response for another round and disables round changes during a mutation",async()=>{
  mount();await screen.findByRole("checkbox");let finish!:(v:unknown)=>void;
  request.mockImplementationOnce(()=>new Promise(r=>{finish=r;}));fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button",{name:"Review synthetic results"}));expect(screen.getByRole("combobox")).toBeDisabled();
  await act(async()=>finish(fixture(3)));await screen.findByRole("alert");expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
});
it("confirmed payment shows receipt without another payout button",async()=>{
  request.mockResolvedValue({...fixture(),nextAction:null,recipientConsented:true,operatorApproved:true,paid:true,paymentTransactionHash:"0x"+"a".repeat(64)});
  mount();await screen.findByText("Paid — finalized testnet receipt recorded");expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  expect(screen.getByRole("link",{name:"View payout transaction"})).toHaveAttribute("href","https://testnet.monadvision.com/tx/0x"+"a".repeat(64));
});
