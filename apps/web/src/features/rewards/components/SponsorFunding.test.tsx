import {useEffect} from "react";
import {act,fireEvent, render, screen, within} from "@testing-library/react";
import {afterEach,beforeEach, expect, it, vi} from "vitest";
import {addGuidedGroup, createGuidedSetup} from "@raceson/domain/rewards/guided-setup-editor";
import type {SponsorLaunch} from "@raceson/domain/rewards/sponsor-launch";
import type {SponsorExecutionPlan} from "@raceson/domain/rewards/sponsor-execution";
import type {SponsorExecutionView} from "../data/sponsorExecution";
import SponsorFunding from "./SponsorFunding";
import {ApiError} from "@/lib/api";
import {saveSponsorReceipt,readSponsorReceipt,sponsorReceiptKey} from "../model/sponsorPendingReceipt";
const mocks = vi.hoisted(() => ({api: vi.fn(), send: vi.fn(), check: vi.fn(), walletUnmount: vi.fn()}));
vi.mock("../data/sponsorExecution", () => ({sponsorExecution: mocks.api}));
vi.mock("../data/sponsorTransaction", () => ({sendSponsorTransaction: mocks.send, checkSponsorTransaction: mocks.check, sponsorTransactionGasLimit: (action: string) => action === "deployment" ? 3_000_000_000_000_000_000n : 500_000_000_000_000_000n}));
vi.mock("./SponsorWallet", () => ({default: function FixtureWallet({onWallet, purpose}: {onWallet: (w: unknown) => void; purpose?: string}) {
 useEffect(()=>()=>{mocks.walletUnmount();onWallet(null);},[onWallet]);
 return <button onClick={() => onWallet({address: "0x"+(purpose === "operator" ? "22" : "11").repeat(20), wallet: {id:"fixture",name:"Fixture",provider:{}}})}>{purpose === "operator" ? "Connect operator wallet" : "Connect fixture wallet"}</button>;
}}));
const id = (n: number) => `73000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const plan: SponsorExecutionPlan = {version:4,launchId:id(3),setupRevision:4,configurationHash:"a".repeat(64),chainId:10143,funder:"0x"+"11".repeat(20),operator:"0x"+"22".repeat(20),
  unallocatedTreasury:"0x"+"33".repeat(20),expiredTreasury:"0x"+"11".repeat(20),claimLifetime:86400,reviewPeriods:[0,0,0,0,0,0],caps:["101","0","0","0","0","0"],budgetWei:"101"};
let seq=10;
const launch: SponsorLaunch = {id:id(3),state:"prepared",createdAt:"2026-09-23T08:00:00.000Z",configurationHash:plan.configurationHash,
  setup:{id:id(1),revision:4,chainId:10143,updatedAt:"2026-09-23T08:00:00.000Z",configuration:createGuidedSetup(()=>id(seq++))}};
launch.setup.configuration=addGuidedGroup(launch.setup.configuration,launch.setup.configuration.guided!.pots[0].nodeId,"club_metres",()=>id(seq++),null);
launch.setup.configuration.context={draftId:id(80),catalogueHash:"c".repeat(64),roundId:null,editionId:null,programmeName:"Synthetic league",eventName:"All rounds"};
launch.setup.configuration.root.children.forEach((pot,index)=>{pot.shareBps=index===0?10000:0;});
launch.setup.configuration.root.children[0].children[0].shareBps=10000;
const deployment="0x"+"aa".repeat(32),funding="0x"+"bb".repeat(32),address="0x"+"44".repeat(20);
const observed=(funded=false)=>({address,deploymentHash:deployment,funded,cancelled:false,fundingHash:funded?funding:null,blockNumber:"100",blockTimestamp:"1790162000",blockHash:"0x"+"cc".repeat(32),pots:[{slot:0,address:"0x"+"55".repeat(20),amountWei:"101",state:funded?1:0,paused:false,allocatedWei:"0",paidWei:"0",returnedWei:"0",remainingWei:funded?"101":"0",claimDeadline:"0",entitlementCount:"0"}]});
beforeEach(()=>{mocks.api.mockReset();mocks.send.mockReset();mocks.check.mockReset();mocks.walletUnmount.mockReset();sessionStorage.clear();localStorage.clear();});
afterEach(()=>{vi.useRealTimers();});
it("shows linked source, verified account and deposit destination under their steps", async () => {
 mocks.api.mockResolvedValue({enabled:true,record:{plan,deploymentHash:deployment,fundingHash:funding},observation:observed(true)});
 render(<SponsorFunding launch={launch} hr={false}/>);
 fireEvent.click(await screen.findByText(/History/));
 const steps=within(screen.getByRole("list",{name:"Funding steps"})).getAllByRole("listitem");
 const walletLink=within(steps[0]).getByRole("link",{name:plan.funder});
 expect(walletLink).toBeVisible();expect(walletLink).toHaveAttribute("href",`https://testnet.monadvision.com/address/${plan.funder}`);
 expect(within(steps[1]).getByRole("link",{name:address})).not.toBeVisible();
 fireEvent.click(within(steps[1]).getByText("Account & creation receipt"));
 expect(within(steps[1]).getByRole("link",{name:address})).toBeVisible();
 expect(within(steps[1]).getByRole("link",{name:"View account creation receipt"})).toHaveAttribute("href",`https://testnet.monadvision.com/tx/${deployment}`);
 expect(within(steps[2]).getByRole("link",{name:plan.funder})).toBeVisible();expect(within(steps[2]).getByRole("link",{name:address})).toBeVisible();
 expect(within(steps[2]).getByRole("link",{name:"View prize deposit receipt"})).toHaveAttribute("href",`https://testnet.monadvision.com/tx/${funding}`);
 expect(mocks.send).not.toHaveBeenCalled();
});
it("keeps the saved wallet visible while creation is pending without inventing a reward address", async () => {
 mocks.api.mockResolvedValue({enabled:true,record:{plan,deploymentHash:null,fundingHash:null},observation:null,creation:{status:"submitted",reason:null,hash:deployment}});
 render(<SponsorFunding launch={launch} hr/>);
 const steps=Array.from((await screen.findByRole("list",{name:"Koraci financiranja"})).children).filter(el=>!el.hasAttribute("hidden"));
 expect(steps).toHaveLength(1);
 expect(within(screen.getByLabelText("Spremljeni novčanik sponzora")).getByRole("link",{name:plan.funder})).toBeVisible();
 expect(screen.queryByRole("link",{name:address})).not.toBeInTheDocument();
 expect(screen.queryByText("Dostupno nakon izrade računa.")).not.toBeVisible();
 expect(mocks.send).not.toHaveBeenCalled();
});
it("verifies a submitted creation receipt without requesting another broadcast",async()=>{
 vi.useFakeTimers();
 mocks.api.mockResolvedValueOnce({enabled:true,record:{plan,deploymentHash:null,fundingHash:null},observation:null,creation:{status:"submitted",reason:null,hash:deployment}})
  .mockResolvedValue({enabled:true,record:{plan,deploymentHash:deployment,fundingHash:null},observation:observed()});
 render(<SponsorFunding launch={launch} hr={false}/>);await act(async()=>{});
 expect(screen.getByText(/Creation requested · confirmation pending/)).toBeVisible();
 await act(async()=>vi.advanceTimersByTimeAsync(15000));
 expect(mocks.api).toHaveBeenLastCalledWith(launch.setup.id,{action:"deployment",hash:deployment});
 expect(mocks.api.mock.calls.some(([,action])=>action?.action==="launch")).toBe(false);
 expect(screen.getByRole("button",{name:"Deposit reward funds"})).toBeDisabled();expect(mocks.send).not.toHaveBeenCalled();
});
it("keeps all transaction actions unavailable until the demo operator policy is configured",async()=>{
 mocks.api.mockResolvedValue({enabled:false,record:null,observation:null});render(<SponsorFunding launch={launch} hr={false}/>);
 await screen.findByRole("heading",{name:"Launch unavailable"});
 expect(screen.queryByRole("button",{name:"Create campaign contract"})).not.toBeInTheDocument();expect(mocks.send).not.toHaveBeenCalled();
});
it("manual refresh recovers an existing submitted deployment while a tab is hidden",async()=>{
 vi.spyOn(document,"visibilityState","get").mockReturnValue("hidden");
 try {
  mocks.api.mockResolvedValueOnce({enabled:true,record:{plan,deploymentHash:null,fundingHash:null},observation:null,creation:{status:"submitted",reason:null,hash:deployment}})
   .mockResolvedValue({enabled:true,record:{plan,deploymentHash:deployment,fundingHash:null},observation:observed()});
  render(<SponsorFunding launch={launch} hr={false}/>);await screen.findByText(/Creation requested · confirmation pending/);
  fireEvent.click(screen.getByRole("button",{name:"Refresh status"}));
  await screen.findByRole("button",{name:"Deposit reward funds"});
  expect(mocks.api).toHaveBeenLastCalledWith(launch.setup.id,{action:"deployment",hash:deployment});expect(mocks.send).not.toHaveBeenCalled();
 } finally { vi.restoreAllMocks(); }
});
it("manual refresh never starts a campaign that has not been launched",async()=>{
 mocks.api.mockResolvedValue({enabled:true,record:{plan,deploymentHash:null,fundingHash:null},observation:null,creation:{status:"ready",reason:null,hash:null}});
 render(<SponsorFunding launch={launch} hr={false}/>);await screen.findByRole("button",{name:"Create reward account"});
 fireEvent.click(screen.getByRole("button",{name:"Refresh funding status"}));await act(async()=>{});
 expect(mocks.api).toHaveBeenLastCalledWith(launch.setup.id,undefined);expect(mocks.send).not.toHaveBeenCalled();
});
it("launches automatically after saving the selected sponsor wallet",async()=>{
 let value:SponsorExecutionView={enabled:true,record:null,observation:null,creation:{status:"ready",reason:null,hash:null}};
 mocks.api.mockImplementation(async(_id,action)=>{if(action?.action==="prepare")value={...value,record:{plan,deploymentHash:null,fundingHash:null}};if(action?.action==="launch")value={...value,creation:{status:"submitted",reason:null,hash:deployment}};return value;});
 render(<SponsorFunding launch={launch} hr={false}/>);
 await screen.findByRole("button",{name:"Connect fixture wallet"});
 expect(screen.queryByRole("button",{name:"Create reward account"})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole("button",{name:"Connect fixture wallet"}));fireEvent.click(screen.getByRole("button",{name:"Create reward account"}));
 await screen.findByText(/Creation requested · confirmation pending/);
 expect(mocks.api).toHaveBeenCalledWith(launch.setup.id,{action:"launch"});
 expect(screen.queryByRole("link",{name:/Rewards Control/})).not.toBeInTheDocument();
 expect(screen.queryByText(/Controller creation gas limit/)).not.toBeInTheDocument();
 expect(screen.queryByRole("button",{name:"Create campaign contract"})).not.toBeInTheDocument();
 expect(screen.queryByRole("button",{name:"Connect operator wallet"})).not.toBeInTheDocument();expect(mocks.send).not.toHaveBeenCalled();
});
it("funds an already deployed programme from the sponsor wallet only",async()=>{
 let value:SponsorExecutionView={enabled:true,record:{plan,deploymentHash:deployment,fundingHash:null},observation:observed()};
 mocks.api.mockImplementation(async(_id,action)=>{if(action?.action==="funding")value={enabled:true,record:{plan,deploymentHash:deployment,fundingHash:funding},observation:observed(true)};return value;});
 mocks.send.mockResolvedValue(funding);render(<SponsorFunding launch={launch} hr={false}/>);
 await screen.findByRole("button",{name:"Deposit reward funds"});fireEvent.click(screen.getByRole("button",{name:"Connect fixture wallet"}));fireEvent.click(screen.getByRole("button",{name:"Deposit reward funds"}));
 await screen.findByText(/All selected pots are funded/);expect(mocks.send).toHaveBeenCalledTimes(1);expect(mocks.send.mock.calls[0][1]).toEqual({plan,action:"funding",address});
});
it("keeps a broadcast hash across verification failure and reload, without sending twice",async()=>{
 const initial={enabled:true,record:{plan,deploymentHash:deployment,fundingHash:null},observation:observed()};let failure=true;
 mocks.api.mockImplementation(async(_id,action)=>{if(action){if(failure)throw Error("not finalized");return {enabled:true,record:{plan,deploymentHash:deployment,fundingHash:funding},observation:observed(true)};}return initial;});
 mocks.send.mockResolvedValue(funding);
 const page=render(<SponsorFunding launch={launch} hr={false}/>);await screen.findByRole("button",{name:"Deposit reward funds"});
 fireEvent.click(screen.getByRole("button",{name:"Connect fixture wallet"}));fireEvent.click(screen.getByRole("button",{name:"Deposit reward funds"}));
 await screen.findByRole("alert");expect(screen.getByText(funding)).toBeInTheDocument();expect(screen.queryByRole("button",{name:"Create campaign contract"})).not.toBeInTheDocument();
 page.unmount();render(<SponsorFunding launch={launch} hr={false}/>);await screen.findByRole("button",{name:"Check confirmation"});
 failure=false;fireEvent.click(screen.getByRole("button",{name:"Check confirmation"}));await screen.findByText(/All selected pots are funded/);
 expect(mocks.send).toHaveBeenCalledTimes(1);expect(sessionStorage.length).toBe(0);
});

it("shows the gas blocker without a wallet transaction and allows a fresh readiness check",async()=>{
 mocks.api.mockResolvedValue({enabled:true,record:{plan,deploymentHash:deployment,fundingHash:null},observation:observed()});
 mocks.check.mockResolvedValueOnce({gasCostWei:"3846827358800000000",balanceWei:"3354506153846153846",blocker:"gas_limit"})
  .mockResolvedValueOnce({gasCostWei:"100000000000000000",balanceWei:"3354506153846153846",blocker:null});
 render(<SponsorFunding launch={launch} hr={false}/>);await screen.findByRole("button",{name:"Deposit reward funds"});
 fireEvent.click(screen.getByRole("button",{name:"Connect fixture wallet"}));fireEvent.click(screen.getByRole("button",{name:"Check balance"}));
 await screen.findByText(/Above the 0.5 test MON gas limit/);
 expect(screen.getByRole("button",{name:"Deposit reward funds"})).toBeDisabled();expect(mocks.send).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole("button",{name:"Check balance"}));await screen.findByText(/Ready for wallet confirmation/);
 expect(screen.getByRole("button",{name:"Deposit reward funds"})).toBeEnabled();expect(mocks.send).not.toHaveBeenCalled();
});
it("explains a preflight failure without implying a broadcast took place",async()=>{
 mocks.api.mockResolvedValue({enabled:true,record:{plan,deploymentHash:deployment,fundingHash:null},observation:observed()});
 mocks.send.mockRejectedValue(new Error("sponsor_preflight_failed"));
 render(<SponsorFunding launch={launch} hr={false}/>);await screen.findByRole("button",{name:"Deposit reward funds"});
 fireEvent.click(screen.getByRole("button",{name:"Connect fixture wallet"}));fireEvent.click(screen.getByRole("button",{name:"Deposit reward funds"}));
 expect(await screen.findByRole("alert")).toHaveTextContent("No transaction was requested");
});
it("recognizes an arrived budget, explains missing gas and recovers after a top-up",async()=>{
 mocks.api.mockResolvedValue({enabled:true,record:{plan,deploymentHash:deployment,fundingHash:null},observation:observed()});
 mocks.check.mockResolvedValueOnce({balanceWei:plan.budgetWei,gasCostWei:null,blocker:"balance"})
  .mockResolvedValueOnce({balanceWei:"1000101",gasCostWei:"1000",blocker:null});
 render(<SponsorFunding launch={launch} hr={false}/>);await screen.findByRole("button",{name:"Deposit reward funds"});
 fireEvent.click(screen.getByRole("button",{name:"Connect fixture wallet"}));fireEvent.click(screen.getByRole("button",{name:"Check balance"}));
 await screen.findByText(/Your reward budget has arrived/);
 expect(screen.queryByText(/Estimated network fee/)).not.toBeInTheDocument();
 expect(screen.getByRole("button",{name:"Deposit reward funds"})).toBeDisabled();
 fireEvent.click(screen.getByRole("button",{name:"Check balance"}));await screen.findByText(/Ready for wallet confirmation/);
 expect(screen.getByRole("button",{name:"Deposit reward funds"})).toBeEnabled();expect(mocks.send).not.toHaveBeenCalled();
});

it("explains missing automatic creation configuration without implying human approval or polling",async()=>{
 vi.useFakeTimers();mocks.api.mockResolvedValue({enabled:true,record:{plan,deploymentHash:null,fundingHash:null},observation:null,creation:{status:"unavailable",reason:"configuration",hash:null}});
 render(<SponsorFunding launch={launch} hr={false}/>);await act(async()=>{});
 expect(screen.getByRole("heading",{name:"Launch unavailable"})).toBeVisible();
 expect(screen.getByText(/RacesOn needs to restore this service/)).toBeVisible();
 expect(screen.getByLabelText("Saved sponsor wallet")).toHaveTextContent(plan.funder);
 expect(screen.getByRole("button",{name:"Connect fixture wallet"})).toBeVisible();
 expect(screen.queryByRole("button",{name:"Deposit reward funds"})).not.toBeInTheDocument();expect(screen.queryByRole("button",{name:"Create reward account"})).not.toBeInTheDocument();
 await act(async()=>vi.advanceTimersByTimeAsync(60000));expect(mocks.api).toHaveBeenCalledTimes(1);
});
it("retries the saved campaign after a recoverable creation failure",async()=>{
 mocks.api.mockResolvedValueOnce({enabled:true,record:{plan,deploymentHash:null,fundingHash:null},observation:null,creation:{status:"failed",reason:"balance",hash:null}}).mockResolvedValue({enabled:true,record:{plan,deploymentHash:null,fundingHash:null},observation:null,creation:{status:"submitted",reason:null,hash:deployment}});
 render(<SponsorFunding launch={launch} hr={false}/>);fireEvent.click(await screen.findByRole("button",{name:"Retry creation"}));await screen.findByText(/Creation requested · confirmation pending/);expect(mocks.api).toHaveBeenCalledWith(launch.setup.id,{action:"launch"});expect(mocks.send).not.toHaveBeenCalled();
});

it("does not offer a disabled launch button for an unconfigured new campaign",async()=>{
 mocks.api.mockResolvedValue({enabled:true,record:null,observation:null,creation:{status:"unavailable",reason:"configuration",hash:null}});
 render(<SponsorFunding launch={launch} hr={false}/>);
 await screen.findByRole("heading",{name:"Launch unavailable"});
 expect(screen.getByText(/Connect the wallet you will use to deposit your prizes/)).toBeVisible();
 expect(screen.queryByRole("button",{name:"Create reward account"})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole("button",{name:"Connect fixture wallet"}));
 expect(mocks.api).toHaveBeenCalledTimes(1);expect(mocks.send).not.toHaveBeenCalled();
});

it("blocks new deposits into an unbound frozen campaign while retaining contract and receipt recovery",async()=>{
 const unbound=structuredClone(launch);unbound.setup.configuration.context=null;
 mocks.api.mockResolvedValue({enabled:true,record:{plan,deploymentHash:deployment,fundingHash:null},observation:observed()});
 render(<SponsorFunding launch={unbound} hr={false}/>);
 await screen.findByText("New deposits are blocked for this campaign.");
 expect(screen.getByRole("link",{name:"Open the corrected draft in My campaigns"})).toHaveAttribute("href","/rewards/manage");
 expect(await screen.findByText("Campaign reward account")).toBeInTheDocument();
 expect(screen.getByText("Recover a wallet transaction")).toBeInTheDocument();
 expect(screen.queryByRole("button",{name:"Deposit reward funds"})).not.toBeInTheDocument();
 expect(screen.queryByRole("button",{name:"Connect fixture wallet"})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole("button",{name:"Refresh funding status"}));await act(async()=>{});
 expect(mocks.api).toHaveBeenLastCalledWith(launch.setup.id,undefined);expect(mocks.send).not.toHaveBeenCalled();
});

it("verifies a previously broadcast deposit for an unbound campaign without sending again",async()=>{
 const unbound=structuredClone(launch);unbound.setup.configuration.context=null;
 sessionStorage.setItem(`raceson:sponsor-tx:${launch.setup.chainId}:${launch.setup.id}`,JSON.stringify({action:"funding",hash:funding}));
 mocks.api.mockImplementation(async(_id,action)=>({enabled:true,record:{plan,deploymentHash:deployment,fundingHash:action?funding:null},observation:observed(Boolean(action))}));
 render(<SponsorFunding launch={unbound} hr={false}/>);
 fireEvent.click(await screen.findByRole("button",{name:"Check confirmation"}));
 await screen.findByText(/All selected pots are funded/);
 expect(mocks.api).toHaveBeenLastCalledWith(launch.setup.id,{action:"funding",hash:funding});
 expect(mocks.send).not.toHaveBeenCalled();expect(sessionStorage.length).toBe(0);
 expect(screen.getByText("Campaign reward account")).toBeInTheDocument();
 expect(screen.queryByRole("button",{name:"Deposit reward funds"})).not.toBeInTheDocument();
});

it("does not start or retry deployment for an unbound frozen launch",async()=>{
 const unbound=structuredClone(launch);unbound.setup.configuration.context=null;
 mocks.api.mockResolvedValue({enabled:true,record:{plan,deploymentHash:null,fundingHash:null},observation:null,creation:{status:"failed",reason:"balance",hash:null}});
 render(<SponsorFunding launch={unbound} hr={false}/>);
 await screen.findByText("New deposits are blocked for this campaign.");
 expect(screen.queryByRole("button",{name:"Create reward account"})).not.toBeInTheDocument();
 expect(screen.queryByRole("button",{name:"Retry creation"})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole("button",{name:"Refresh funding status"}));await act(async()=>{});
 expect(mocks.api).toHaveBeenLastCalledWith(launch.setup.id,undefined);expect(mocks.send).not.toHaveBeenCalled();
});


it("distinguishes creation confirmation from an unfunded budget and points to the next action", async () => {
 mocks.api.mockResolvedValue({enabled:true,record:{plan,deploymentHash:deployment,fundingHash:null},observation:observed()});
 render(<SponsorFunding launch={launch} hr={false}/>);
 await screen.findByRole("heading",{name:"Deposit the prize funds"});
 expect(screen.queryByRole("heading",{name:"Reward account created"})).not.toBeInTheDocument();
 expect(within(screen.getByRole("list",{name:"Funding steps"})).getAllByRole("listitem")).toHaveLength(1);
 expect(screen.queryByText("Deposit confirmed")).not.toBeInTheDocument();
 expect(screen.getByRole("list",{name:"Funding steps"}).querySelector('[aria-current="step"]')).toHaveTextContent("Deposit reward funds");
 expect(screen.getByRole("link",{name:"My campaigns"})).toHaveAttribute("href","/rewards/manage");
 expect(screen.queryByText(/Review hours/)).not.toBeInTheDocument();
 expect(mocks.send).not.toHaveBeenCalled();
});

it("shows an interrupted confirmation check without claiming failure or allowing a deposit", async () => {
 vi.useFakeTimers();
 mocks.api.mockResolvedValueOnce({enabled:true,record:{plan,deploymentHash:null,fundingHash:null},observation:null,creation:{status:"submitted",reason:null,hash:deployment}}).mockRejectedValueOnce(Error("network"));
 render(<SponsorFunding launch={launch} hr={false}/>); await act(async()=>{});
 expect(screen.getByText(/reward account is not confirmed yet/)).toBeVisible();
 await act(async()=>vi.advanceTimersByTimeAsync(15000));
 expect(screen.getByText(/The last check failed/)).toBeVisible();
 expect(screen.queryByRole("button",{name:"Deposit reward funds"})).not.toBeInTheDocument();
 expect(screen.getByRole("button",{name:"Refresh status"})).toBeEnabled();
 expect(mocks.send).not.toHaveBeenCalled();
});

it("completes the steps only after a verified deposit and offers campaign tracking", async () => {
 mocks.api.mockResolvedValue({enabled:true,record:{plan,deploymentHash:deployment,fundingHash:funding},observation:observed(true)});
 render(<SponsorFunding launch={launch} hr={false}/>);
 await screen.findByText(/History/);
 expect(screen.getByText(/History/).closest("details")).not.toHaveAttribute("open");fireEvent.click(screen.getByText(/History/));
 expect(screen.getByRole("list",{name:"Funding steps"}).querySelectorAll('[data-complete="true"]')).toHaveLength(3);
 expect(screen.getByRole("region",{name:"Results and payouts"})).toBeVisible();
 expect(screen.queryByRole("button",{name:"Deposit reward funds"})).not.toBeInTheDocument();
 expect(screen.getByRole("link",{name:"My campaigns"})).toBeVisible();
});


it("reopens a broadcast receipt after tab storage is gone and automatically verifies without sending again",async()=>{
 vi.useFakeTimers();
 const initial={enabled:true,record:{plan,deploymentHash:deployment,fundingHash:null},observation:observed()};
 let confirmed=false;
 mocks.api.mockImplementation(async(_id,action)=>{if(action){if(!confirmed)throw Error("not finalized");return {enabled:true,record:{plan,deploymentHash:deployment,fundingHash:funding},observation:observed(true)};}return initial;});
 mocks.send.mockResolvedValue(funding);
 const page=render(<SponsorFunding launch={launch} hr={false}/>);await act(async()=>{});
 fireEvent.click(screen.getByRole("button",{name:"Connect fixture wallet"}));fireEvent.click(screen.getByRole("button",{name:"Deposit reward funds"}));await act(async()=>{});
 expect(readSponsorReceipt(launch)?.hash).toBe(funding);
 page.unmount();sessionStorage.clear();confirmed=true;
 render(<SponsorFunding launch={launch} hr={false}/>);await act(async()=>{});
 expect(screen.getByText(funding)).toBeInTheDocument();
 expect(screen.queryByRole("button",{name:"Deposit reward funds"})).not.toBeInTheDocument();
 await act(async()=>vi.advanceTimersByTimeAsync(15000));
 expect(screen.getByText(/All selected pots are funded/)).toBeVisible();
 expect(mocks.api).toHaveBeenLastCalledWith(launch.setup.id,{action:"funding",hash:funding});
 expect(mocks.send).toHaveBeenCalledTimes(1);expect(readSponsorReceipt(launch)).toBeNull();
 expect(localStorage.length).toBe(0);
});

it("checks a pending deposit after two seconds, then confirms the same receipt without another send",async()=>{
 vi.useFakeTimers();saveSponsorReceipt(launch,{action:"funding",hash:funding});
 const initial={enabled:true,record:{plan,deploymentHash:deployment,fundingHash:null},observation:observed()};
 mocks.api.mockResolvedValueOnce(initial)
  .mockRejectedValueOnce(new ApiError("Pending",{status:425,code:"sponsor_receipt_pending"}))
  .mockResolvedValue({enabled:true,record:{plan,deploymentHash:deployment,fundingHash:funding},observation:observed(true)});
 render(<SponsorFunding launch={launch} hr={false}/>);await act(async()=>{});
 expect(screen.getByRole("heading",{name:"Confirming your deposit"})).toBeVisible();
 expect(screen.getByText(funding)).not.toBeVisible();
 fireEvent.click(screen.getByText("Transaction details"));expect(screen.getByText(funding)).toBeVisible();
 await act(async()=>vi.advanceTimersByTimeAsync(1999));expect(mocks.api).toHaveBeenCalledTimes(1);
 await act(async()=>vi.advanceTimersByTimeAsync(1));expect(mocks.api).toHaveBeenCalledTimes(2);
 expect(screen.queryByRole("button",{name:"Deposit reward funds"})).not.toBeInTheDocument();
 await act(async()=>vi.advanceTimersByTimeAsync(2999));expect(mocks.api).toHaveBeenCalledTimes(2);
 await act(async()=>vi.advanceTimersByTimeAsync(1));
 expect(screen.getByText(/All selected pots are funded/)).toBeVisible();
 expect(mocks.api.mock.calls.slice(1).map(call=>call[1])).toEqual([{action:"funding",hash:funding},{action:"funding",hash:funding}]);
 expect(readSponsorReceipt(launch)).toBeNull();expect(mocks.send).not.toHaveBeenCalled();
});

it("does not discard a receipt just because the chain reports funded without the matching saved hash",async()=>{
 vi.useFakeTimers();saveSponsorReceipt(launch,{action:"funding",hash:funding});
 mocks.api.mockResolvedValue({enabled:true,record:{plan,deploymentHash:deployment,fundingHash:null},observation:{...observed(true),fundingHash:null}});
 render(<SponsorFunding launch={launch} hr={false}/>);await act(async()=>{});
 await act(async()=>vi.advanceTimersByTimeAsync(15000));
 expect(readSponsorReceipt(launch)?.hash).toBe(funding);expect(screen.getByRole("button",{name:"Check confirmation"})).toBeVisible();
 expect(screen.getByText(/We’re still checking/)).toBeVisible();expect(mocks.send).not.toHaveBeenCalled();
});

it("persists a manually recovered hash before a failed check",async()=>{
 const initial={enabled:true,record:{plan,deploymentHash:deployment,fundingHash:null},observation:observed()};
 mocks.api.mockImplementation(async(_id,action)=>{if(action)throw Error("network");return initial;});
 const page=render(<SponsorFunding launch={launch} hr={false}/>);await screen.findByRole("button",{name:"Deposit reward funds"});
 fireEvent.click(screen.getByText("Details & help"));fireEvent.click(screen.getByText("Recover a wallet transaction"));
 fireEvent.change(screen.getByLabelText("Transaction hash"),{target:{value:funding}});fireEvent.click(screen.getByRole("button",{name:"Verify and save"}));
 await screen.findByRole("alert");page.unmount();sessionStorage.clear();
 render(<SponsorFunding launch={launch} hr={false}/>);
 expect(await screen.findByRole("button",{name:"Check confirmation"})).toBeVisible();
 expect(readSponsorReceipt(launch)?.hash).toBe(funding);expect(mocks.send).not.toHaveBeenCalled();
});

it.each([400,401,403,404,409])("pauses automatic receipt checks on HTTP %s and retains the exact hash",async(status)=>{
 vi.useFakeTimers();saveSponsorReceipt(launch,{action:"funding",hash:funding});
 mocks.api.mockImplementation(async(_id,action)=>{if(action)throw new ApiError("blocked",{status});return {enabled:true,record:{plan,deploymentHash:deployment,fundingHash:null},observation:observed()};});
 render(<SponsorFunding launch={launch} hr={false}/>);await act(async()=>{});
 await act(async()=>vi.advanceTimersByTimeAsync(600000));
 expect(mocks.api).toHaveBeenCalledTimes(2);expect(readSponsorReceipt(launch)?.hash).toBe(funding);
 expect(screen.getByText(/Automatic checks paused/)).toBeVisible();expect(mocks.send).not.toHaveBeenCalled();
});

it("bounds unavailable-receipt retries and pauses while the page is hidden",async()=>{
 vi.useFakeTimers();let visible=false;const visibility=vi.spyOn(document,"visibilityState","get").mockImplementation(()=>visible?"visible":"hidden");
 saveSponsorReceipt(launch,{action:"funding",hash:funding});
 mocks.api.mockImplementation(async(_id,action)=>{if(action)throw new ApiError("not finalized",{status:503});return {enabled:true,record:{plan,deploymentHash:deployment,fundingHash:null},observation:observed()};});
 try{
  render(<SponsorFunding launch={launch} hr={false}/>);await act(async()=>{});
  await act(async()=>vi.advanceTimersByTimeAsync(120000));expect(mocks.api).toHaveBeenCalledTimes(1);
  visible=true;await act(async()=>{document.dispatchEvent(new Event("visibilitychange"));});
  await act(async()=>vi.advanceTimersByTimeAsync(600000));expect(mocks.api).toHaveBeenCalledTimes(7);
  expect(screen.getByText(/Automatic checks paused/)).toBeVisible();expect(readSponsorReceipt(launch)?.hash).toBe(funding);
 }finally{visibility.mockRestore();}
});

it("serializes automatic verification and prevents an old campaign response changing a new campaign",async()=>{
 vi.useFakeTimers();let finish!:(v:SponsorExecutionView)=>void;
 saveSponsorReceipt(launch,{action:"funding",hash:funding});
 mocks.api.mockImplementation(async(_id,action)=>action?new Promise<SponsorExecutionView>(resolve=>{finish=resolve;}):{enabled:true,record:{plan,deploymentHash:deployment,fundingHash:null},observation:observed()});
 const page=render(<SponsorFunding launch={launch} hr={false}/>);await act(async()=>{});
 await act(async()=>vi.advanceTimersByTimeAsync(15000));
 expect(screen.getByRole("button",{name:"Check confirmation"})).toBeDisabled();expect(screen.getByRole("button",{name:"Refresh funding status"})).toBeDisabled();
 await act(async()=>vi.advanceTimersByTimeAsync(60000));expect(mocks.api).toHaveBeenCalledTimes(2);
 const another={...launch,id:id(91),setup:{...launch.setup,id:id(90)}};
 page.rerender(<SponsorFunding launch={another} hr={false}/>);await act(async()=>{});
 await act(async()=>finish({enabled:true,record:{plan,deploymentHash:deployment,fundingHash:funding},observation:observed(true)}));
 expect(screen.queryByText(/All selected pots are funded/)).not.toBeInTheDocument();expect(screen.queryByRole("button",{name:"Check confirmation"})).not.toBeInTheDocument();
 expect(readSponsorReceipt(launch)?.hash).toBe(funding);expect(readSponsorReceipt(another)).toBeNull();expect(mocks.send).not.toHaveBeenCalled();
});

it("shows the receipt even when loading campaign status fails",async()=>{
 saveSponsorReceipt(launch,{action:"funding",hash:funding});mocks.api.mockRejectedValue(Error("offline"));
 render(<SponsorFunding launch={launch} hr={false}/>);await screen.findByRole("alert");
 expect(screen.getByText(funding)).toBeInTheDocument();expect(screen.getByRole("button",{name:"Check confirmation"})).toBeEnabled();
});

it("retains an in-memory hash and explains when durable browser storage is unavailable",async()=>{
 mocks.api.mockImplementation(async(_id,action)=>{if(action)throw Error("network");return {enabled:true,record:{plan,deploymentHash:deployment,fundingHash:null},observation:observed()};});
 mocks.send.mockResolvedValue(funding);const storage=vi.spyOn(Storage.prototype,"setItem").mockImplementation(()=>{throw Error("blocked");});
 try{
  render(<SponsorFunding launch={launch} hr={false}/>);await screen.findByRole("button",{name:"Deposit reward funds"});
  fireEvent.click(screen.getByRole("button",{name:"Connect fixture wallet"}));fireEvent.click(screen.getByRole("button",{name:"Deposit reward funds"}));
  await screen.findByRole("alert");expect(screen.getByText(/Keep this transaction hash/)).toBeVisible();expect(screen.getByText(funding)).toBeInTheDocument();
 }finally{storage.mockRestore();}
});

it("receives a saved pending receipt from another tab and blocks another deposit",async()=>{
 mocks.api.mockResolvedValue({enabled:true,record:{plan,deploymentHash:deployment,fundingHash:null},observation:observed()});
 render(<SponsorFunding launch={launch} hr={false}/>);await screen.findByRole("button",{name:"Deposit reward funds"});
 saveSponsorReceipt(launch,{action:"funding",hash:funding});
 act(()=>window.dispatchEvent(new StorageEvent("storage",{key:sponsorReceiptKey(launch)})));
 expect(screen.getByText(funding)).toBeInTheDocument();expect(screen.queryByRole("button",{name:"Deposit reward funds"})).not.toBeInTheDocument();expect(mocks.send).not.toHaveBeenCalled();
});

it("ignores a stale initial GET after the saved receipt was verified",async()=>{
 let completeGet!:(value:SponsorExecutionView)=>void;
 saveSponsorReceipt(launch,{action:"funding",hash:funding});
 mocks.api.mockImplementation(async(_id,action)=>action?{enabled:true,record:{plan,deploymentHash:deployment,fundingHash:funding},observation:observed(true)}:new Promise<SponsorExecutionView>(resolve=>{completeGet=resolve;}));
 render(<SponsorFunding launch={launch} hr={false}/>);
 fireEvent.click(await screen.findByRole("button",{name:"Check confirmation"}));await screen.findByText(/All selected pots are funded/);
 await act(async()=>completeGet({enabled:true,record:{plan,deploymentHash:deployment,fundingHash:null},observation:observed()}));
 expect(screen.getByText(/All selected pots are funded/)).toBeVisible();expect(screen.queryByRole("button",{name:"Deposit reward funds"})).not.toBeInTheDocument();
});

it("cancels a deposit preflight when another tab reports a submitted receipt",async()=>{
 let completeGet!:(value:SponsorExecutionView)=>void;
 const initial={enabled:true,record:{plan,deploymentHash:deployment,fundingHash:null},observation:observed()};
 mocks.api.mockResolvedValueOnce(initial).mockImplementation(()=>new Promise<SponsorExecutionView>(resolve=>{completeGet=resolve;}));
 render(<SponsorFunding launch={launch} hr={false}/>);await screen.findByRole("button",{name:"Deposit reward funds"});
 fireEvent.click(screen.getByRole("button",{name:"Connect fixture wallet"}));fireEvent.click(screen.getByRole("button",{name:"Deposit reward funds"}));
 saveSponsorReceipt(launch,{action:"funding",hash:funding});
 act(()=>window.dispatchEvent(new StorageEvent("storage",{key:sponsorReceiptKey(launch)})));
 await act(async()=>completeGet(initial));
 expect(mocks.send).not.toHaveBeenCalled();expect(screen.getByText(funding)).toBeInTheDocument();
 expect(screen.queryByRole("button",{name:"Deposit reward funds"})).not.toBeInTheDocument();
});

it("keeps a successful initial GET after an early verification failure so automatic retries can resume",async()=>{
 vi.useFakeTimers();let completeGet!:(value:SponsorExecutionView)=>void,confirmed=false;
 saveSponsorReceipt(launch,{action:"funding",hash:funding});
 mocks.api.mockImplementation(async(_id,action)=>{
  if(!action)return new Promise<SponsorExecutionView>(resolve=>{completeGet=resolve;});
  if(!confirmed)throw Error("temporary failure");
  return {enabled:true,record:{plan,deploymentHash:deployment,fundingHash:funding},observation:observed(true)};
 });
 render(<SponsorFunding launch={launch} hr={false}/>);await act(async()=>{});
 fireEvent.click(screen.getByRole("button",{name:"Check confirmation"}));await act(async()=>{});
 await act(async()=>completeGet({enabled:true,record:{plan,deploymentHash:deployment,fundingHash:null},observation:observed()}));
 confirmed=true;await act(async()=>vi.advanceTimersByTimeAsync(15000));
 expect(screen.getByText(/All selected pots are funded/)).toBeVisible();expect(readSponsorReceipt(launch)).toBeNull();
 expect(mocks.send).not.toHaveBeenCalled();
});

it.each([
 ["sponsor_receipt_pending",425,"Confirming your deposit","Your deposit has been sent",false],
 ["sponsor_receipt_reverted",422,"Transaction failed","network finalized this transaction as failed",true],
 ["sponsor_receipt_mismatch",422,"Transaction needs review","could not be matched to the saved campaign",true],
 ["sponsor_observation_unavailable",503,"Receipt check unavailable","transaction may still complete",false],
] as const)("explains %s without losing the hash or resending",async(code,status,title,detail,paused)=>{
 vi.useFakeTimers();saveSponsorReceipt(launch,{action:"funding",hash:funding});
 mocks.api.mockImplementation(async(_id,action)=>{if(action)throw new ApiError("Server diagnostic",{status,code});return {enabled:true,record:{plan,deploymentHash:deployment,fundingHash:null},observation:observed()};});
 render(<SponsorFunding launch={launch} hr={false}/>);await act(async()=>{});
 await act(async()=>vi.advanceTimersByTimeAsync(2000));
 expect(screen.getByRole("heading",{name:title})).toBeVisible();expect(screen.getByText(new RegExp(detail))).toBeVisible();
 expect(screen.queryByRole("alert")).not.toBeInTheDocument();
 expect(screen.queryByRole("button",{name:"Deposit reward funds"})).not.toBeInTheDocument();
 expect(readSponsorReceipt(launch)?.hash).toBe(funding);
 const calls=mocks.api.mock.calls.length;await act(async()=>vi.advanceTimersByTimeAsync(3000));
 expect(mocks.api.mock.calls.length).toBe(paused?calls:calls+1);expect(mocks.send).not.toHaveBeenCalled();
});

it("recovers a provider outage by manually verifying the same hash",async()=>{
 saveSponsorReceipt(launch,{action:"funding",hash:funding});let available=false;
 mocks.api.mockImplementation(async(_id,action)=>{
  if(!action)return {enabled:true,record:{plan,deploymentHash:deployment,fundingHash:null},observation:observed()};
  if(!available)throw new ApiError("Provider unavailable",{status:503,code:"sponsor_observation_unavailable"});
  return {enabled:true,record:{plan,deploymentHash:deployment,fundingHash:funding},observation:observed(true)};
 });
 render(<SponsorFunding launch={launch} hr={false}/>);fireEvent.click(await screen.findByRole("button",{name:"Check confirmation"}));
 await screen.findByRole("heading",{name:"Receipt check unavailable"});available=true;
 fireEvent.click(screen.getByRole("button",{name:"Check confirmation"}));await screen.findByText(/All selected pots are funded/);
 expect(readSponsorReceipt(launch)).toBeNull();expect(mocks.send).not.toHaveBeenCalled();
 expect(mocks.api.mock.calls.filter(call=>call[1]).map(call=>call[1])).toEqual([{action:"funding",hash:funding},{action:"funding",hash:funding}]);
});

it("does not apply a stale failed-receipt classification to a replacement hash",async()=>{
 let reject!:(error:Error)=>void;saveSponsorReceipt(launch,{action:"funding",hash:funding});
 mocks.api.mockImplementation(async(_id,action)=>action?new Promise((_resolve,fail)=>{reject=fail;}):{enabled:true,record:{plan,deploymentHash:deployment,fundingHash:null},observation:observed()});
 render(<SponsorFunding launch={launch} hr={false}/>);fireEvent.click(await screen.findByRole("button",{name:"Check confirmation"}));await act(async()=>{});
 const replacement="0x"+"dd".repeat(32);saveSponsorReceipt(launch,{action:"funding",hash:replacement});
 act(()=>window.dispatchEvent(new StorageEvent("storage",{key:sponsorReceiptKey(launch)})));
 await act(async()=>reject(new ApiError("Reverted",{status:422,code:"sponsor_receipt_reverted"})));
 expect(screen.queryByRole("heading",{name:"Transaction failed"})).not.toBeInTheDocument();expect(screen.queryByRole("alert")).not.toBeInTheDocument();
 expect(screen.getByText(replacement)).toBeInTheDocument();expect(readSponsorReceipt(launch)?.hash).toBe(replacement);expect(mocks.send).not.toHaveBeenCalled();
});

it('offers completion only after the funding receipt is saved and no receipt remains pending',async()=>{
 mocks.api.mockResolvedValueOnce({enabled:true,record:{plan,deploymentHash:deployment,fundingHash:null},observation:{...observed(true),fundingHash:null}})
  .mockResolvedValue({enabled:true,record:{plan,deploymentHash:deployment,fundingHash:funding},observation:observed(true)});
 render(<SponsorFunding launch={launch} hr={false}/>);await screen.findByText(/All selected pots are funded/);
 expect(screen.queryByRole('button',{name:'Complete setup'})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Refresh campaign status'}));await screen.findByRole('button',{name:'Complete setup'});
 expect(mocks.send).not.toHaveBeenCalled();
});

it("distinguishes a controller queue from network confirmation and retries without a wallet send",async()=>{
 vi.useFakeTimers();
 const record={plan,deploymentHash:null,fundingHash:null};
 mocks.api.mockResolvedValueOnce({enabled:true,record,observation:null,creation:{status:"processing",reason:"controller_busy",hash:null}})
  .mockResolvedValue({enabled:true,record,observation:null,creation:{status:"submitted",reason:null,hash:deployment}});
 render(<SponsorFunding launch={launch} hr={false}/>);await act(async()=>{});
 expect(screen.getByRole("heading",{name:"Your account creation is queued"})).toBeVisible();
 expect(screen.getByText(/No creation transaction has been sent for this campaign/)).toBeVisible();
 expect(screen.queryByText(/confirmation pending/)).not.toBeInTheDocument();
 const progress=screen.getByRole("group",{name:"Contract creation progress"});
 expect(within(progress).getByText("Preparing")).toHaveAttribute("aria-current","step");
 expect(within(progress).getByText("Submitted")).toHaveAttribute("data-complete","false");
 expect(screen.queryByRole("button",{name:"Deposit reward funds"})).not.toBeInTheDocument();
 await act(async()=>vi.advanceTimersByTimeAsync(15000));
 expect(within(progress).getByText("Confirming")).toHaveAttribute("aria-current","step");
 expect(within(progress).getByText("Confirmed")).toHaveAttribute("data-complete","false");
 expect(screen.getByText(/Creation requested · confirmation pending/)).toBeVisible();
 expect(mocks.api).toHaveBeenLastCalledWith(launch.setup.id,{action:"launch"});expect(mocks.send).not.toHaveBeenCalled();
});
it("does not imply network submission while creation has no transaction hash",async()=>{
 mocks.api.mockResolvedValue({enabled:true,record:{plan,deploymentHash:null,fundingHash:null},observation:null,creation:{status:"processing",reason:null,hash:null}});
 render(<SponsorFunding launch={launch} hr={false}/>);
 await screen.findByRole("heading",{name:"Preparing your reward account"});
 expect(screen.getByText(/Network confirmation has not started/)).toBeVisible();
 expect(screen.queryByText(/confirmation pending/)).not.toBeInTheDocument();expect(mocks.send).not.toHaveBeenCalled();
});

it('shows a blocked service on reload without auto-creating, then refreshes availability read-only',async()=>{
 vi.useFakeTimers();let available=false;
 const record={plan,deploymentHash:null,fundingHash:null};
 mocks.api.mockImplementation(async()=>({enabled:true,record,observation:null,creation:{status:available?'ready':'unavailable',reason:available?null:'controller_busy',hash:null}}));
 render(<SponsorFunding launch={launch} hr={false}/>);await act(async()=>{});
 expect(screen.getByRole('heading',{name:'Waiting for the creation service'})).toBeVisible();
 expect(screen.getByText(/creation still requires your explicit action/)).toBeVisible();
 expect(screen.queryByRole('button',{name:'Create reward account'})).not.toBeInTheDocument();
 await act(async()=>{vi.advanceTimersByTime(45000);});
 expect(mocks.api).toHaveBeenCalledTimes(1);expect(mocks.send).not.toHaveBeenCalled();
 available=true;fireEvent.click(screen.getByRole('button',{name:'Refresh funding status'}));await act(async()=>{});
 expect(screen.getByRole('button',{name:'Create reward account'})).toBeEnabled();
 expect(mocks.api.mock.calls.every((call)=>!call[1])).toBe(true);
 expect(mocks.send).not.toHaveBeenCalled();
});

it('shows separate verified creation and deposit receipts after funding',async()=>{
 mocks.api.mockResolvedValue({enabled:true,record:{plan,deploymentHash:deployment,fundingHash:funding},observation:observed(true)});
 render(<SponsorFunding launch={launch} hr={false}/>);await screen.findByRole('heading',{name:/Deposit confirmed/});
 fireEvent.click(screen.getByText('Details & help'));
 expect(screen.getByRole('link',{name:'View account creation receipt'})).toHaveAttribute('href',`https://testnet.monadvision.com/tx/${deployment}`);
 expect(screen.getByRole('link',{name:'View prize deposit receipt'})).toHaveAttribute('href',`https://testnet.monadvision.com/tx/${funding}`);
 expect(mocks.send).not.toHaveBeenCalled();
});


it("shows only the current action and preserves the connected provider across stage changes",async()=>{
 let value:SponsorExecutionView={enabled:true,record:null,observation:null,creation:{status:"ready",reason:null,hash:null}};
 mocks.api.mockImplementation(async(_id,action)=>{
  if(action?.action==="prepare")value={...value,record:{plan,deploymentHash:null,fundingHash:null}};
  if(action?.action==="launch")value={...value,record:{plan,deploymentHash:deployment,fundingHash:null},observation:observed()};
  return value;
 });
 render(<SponsorFunding launch={launch} hr={false}/>);
 await screen.findByRole("heading",{name:"Connect your funding wallet"});
 const progress=screen.getByRole("list",{name:"Funding progress"});
 expect(within(progress).queryAllByRole("link")).toHaveLength(0);
 expect(within(progress).getAllByRole("listitem")).toHaveLength(3);
 expect(screen.queryByRole("button",{name:"Create reward account"})).not.toBeInTheDocument();
 expect(screen.queryByRole("button",{name:"Deposit reward funds"})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole("button",{name:"Connect fixture wallet"}));
 await screen.findByRole("heading",{name:"Create the reward contract"});
 expect(screen.queryByRole("button",{name:"Connect fixture wallet"})).not.toBeInTheDocument();
 expect(within(screen.getByRole("list",{name:"Funding steps"})).getAllByRole("listitem")).toHaveLength(1);
 expect(mocks.walletUnmount).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole("button",{name:"Create reward account"}));
 await screen.findByRole("heading",{name:"Deposit the prize funds"});
 expect(screen.getByRole("button",{name:"Deposit reward funds"})).toBeEnabled();
 expect(screen.queryByRole("button",{name:"Create reward account"})).not.toBeInTheDocument();
 expect(within(screen.getByRole("list",{name:"Funding steps"})).getAllByRole("listitem")).toHaveLength(1);
 expect(progress.querySelectorAll('[data-complete="true"]')).toHaveLength(2);
 expect(mocks.walletUnmount).not.toHaveBeenCalled();expect(mocks.send).not.toHaveBeenCalled();
});


it('replaces a creation request with progress, then checks the same hash before unlocking deposit',async()=>{
 const prepared={enabled:true,record:{plan,deploymentHash:null,fundingHash:null},observation:null,creation:{status:'ready' as const,reason:null,hash:null}};
 let finish!:(value:SponsorExecutionView)=>void;
 mocks.api.mockImplementation(async(_id,action)=>{
  if(action?.action==='prepare')return prepared;
  if(action?.action==='launch')return new Promise<SponsorExecutionView>(resolve=>{finish=resolve;});
  if(action?.action==='deployment')return {...prepared,record:{plan,deploymentHash:deployment,fundingHash:null},observation:observed(),creation:{status:'ready',reason:null,hash:null}};
  return {...prepared,record:null};
 });
 render(<SponsorFunding launch={launch} hr={false}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Connect fixture wallet'}));
 fireEvent.click(screen.getByRole('button',{name:'Create reward account'}));
 const progress=await screen.findByRole('group',{name:'Contract creation progress'});
 expect(within(progress).getByText('Preparing')).toHaveAttribute('aria-current','step');
 expect(within(progress).getByText('Submitted')).toHaveAttribute('data-complete','false');
 expect(screen.queryByRole('button',{name:'Create reward account'})).not.toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Deposit reward funds'})).not.toBeInTheDocument();
 await act(async()=>finish({...prepared,creation:{status:'submitted',reason:null,hash:deployment}}));
 expect(within(progress).getByText('Submitted')).toHaveAttribute('data-complete','true');
 expect(within(progress).getByText('Confirming')).toHaveAttribute('aria-current','step');
 expect(within(progress).getByText('Confirmed')).toHaveAttribute('data-complete','false');
 expect(within(progress).getByRole('link',{name:'View transaction'})).toHaveAttribute('href',`https://testnet.monadvision.com/tx/${deployment}`);
 fireEvent.click(within(progress).getByRole('button',{name:'Refresh status'}));
 await screen.findByRole('heading',{name:'Deposit the prize funds'});
 expect(screen.queryByRole('group',{name:'Contract creation progress'})).not.toBeInTheDocument();
 expect(mocks.api.mock.calls.filter(([,action])=>action?.action==='launch')).toHaveLength(1);
 expect(mocks.api).toHaveBeenLastCalledWith(launch.setup.id,{action:'deployment',hash:deployment});
 expect(mocks.send).not.toHaveBeenCalled();expect(mocks.walletUnmount).not.toHaveBeenCalled();
});

it('replaces the deposit button while the wallet is outstanding and preserves progress for its pending receipt',async()=>{
 let finish!:(hash:string)=>void;let confirmed=false;
 const initial={enabled:true,record:{plan,deploymentHash:deployment,fundingHash:null},observation:observed()};
 mocks.api.mockImplementation(async(_id,action)=>{
  if(action?.action==='funding'){
   if(!confirmed)throw new ApiError('Pending',{status:425,code:'sponsor_receipt_pending'});
   return {...initial,record:{plan,deploymentHash:deployment,fundingHash:funding},observation:observed(true)};
  }
  return initial;
 });
 mocks.send.mockImplementation(()=>new Promise<string>(resolve=>{finish=resolve;}));
 render(<SponsorFunding launch={launch} hr={false}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Connect fixture wallet'}));
 fireEvent.click(screen.getByRole('button',{name:'Deposit reward funds'}));
 const progress=await screen.findByRole('group',{name:'Prize deposit progress'});
 expect(within(progress).getByText('Wallet confirmation')).toHaveAttribute('aria-current','step');
 expect(within(progress).getByText('Submitted')).toHaveAttribute('data-complete','false');
 expect(screen.queryByRole('button',{name:'Deposit reward funds'})).not.toBeInTheDocument();
 await act(async()=>finish(funding));
 const receipt=screen.getByRole('group',{name:'Prize deposit progress'});
 expect(within(receipt).getByText('Confirming')).toHaveAttribute('aria-current','step');
 expect(within(receipt).getByText('Confirmed')).toHaveAttribute('data-complete','false');
 expect(readSponsorReceipt(launch)).toEqual({action:'funding',hash:funding});
 confirmed=true;fireEvent.click(within(receipt).getByRole('button',{name:'Check confirmation'}));
 await screen.findByText(/All selected pots are funded/);
 expect(mocks.send).toHaveBeenCalledTimes(1);expect(readSponsorReceipt(launch)).toBeNull();
});
