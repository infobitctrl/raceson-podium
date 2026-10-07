import {act,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {beforeEach,expect,it,vi} from "vitest";
import {MemoryRouter} from "react-router-dom";
import {I18nProvider} from "@/shared/i18n/I18nProvider";
import {RewardEmbeddedWalletContext} from "./RewardEmbeddedWalletContext";
import RewardWalletPanel from "./RewardWalletPanel";
import type {WalletProof} from "../model/athleteRewards";
import type {PreparedWalletProof} from "../data/browserWallet";
const mocks=vi.hoisted(()=>({prepare:vi.fn(),save:vi.fn()}));
vi.mock("../data/browserWallet",()=>({prepareBrowserWalletProof:mocks.prepare,discoverRewardWallets:()=>()=>{}}));
vi.mock("../data/athleteDestinations",()=>({submitRewardDestination:mocks.save}));
const address=`0x${"ab".repeat(20)}` as const,profile="81000000-0000-4000-8000-000000000003";
const wallet={id:"fixture",name:"Fixture wallet",provider:{request:vi.fn(),on:vi.fn(),removeListener:vi.fn()}};
const challenge={challengeId:"81000000-0000-4000-8000-000000000001",address,chainId:10143 as const,alreadyVerified:false,message:"Exact free control message",expiresAt:"2026-10-07T12:00:00Z"};
const proof:WalletProof={proofId:challenge.challengeId,address,chainId:10143,verifiedAt:"2026-10-07T11:00:00Z",proofKind:"eip191_address_control"};
let prepared:PreparedWalletProof;
const saved=vi.fn();
function tree(complete=true){return <MemoryRouter><I18nProvider initialLocale="en"><RewardEmbeddedWalletContext.Provider value={{status:"ready",wallet,address}}><RewardWalletPanel compact athleteProfileId={profile} destinationsComplete={complete} onDestinationSaved={saved}/></RewardEmbeddedWalletContext.Provider></I18nProvider></MemoryRouter>;}
beforeEach(()=>{vi.clearAllMocks();prepared={challenge,confirm:vi.fn().mockResolvedValue(proof),assertCurrent:vi.fn().mockResolvedValue(undefined),dispose:vi.fn()};mocks.prepare.mockResolvedValue(prepared);mocks.save.mockResolvedValue({requestId:"81000000-0000-4000-8000-000000000002",athleteProfileId:profile,address,chainId:10143,status:"pending_review"});});
it("advances only through explicit wallet selection, successful free proof and destination consent",async()=>{
  let confirm!:(value:WalletProof)=>void;vi.mocked(prepared.confirm).mockImplementation(()=>new Promise(resolve=>{confirm=resolve;}));
  render(tree());expect(screen.getByText("Wallet",{selector:"li"})).toHaveAttribute("aria-current","step");
  expect(mocks.prepare).not.toHaveBeenCalled();expect(mocks.save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"Continue with this wallet"}));
  expect(await screen.findByRole("heading",{name:"Verify wallet control"})).toBeVisible();
  expect(screen.getByText("Verify",{selector:"li"})).toHaveAttribute("aria-current","step");
  expect(screen.getByText("Exact free control message").closest("details")).not.toHaveAttribute("open");
  expect(screen.queryByRole("button",{name:"Save wallet"})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:/Sign and verify wallet/}));
  expect(screen.getByRole("group",{name:"Wallet setup progress"})).toHaveAttribute("aria-busy","true");
  expect(screen.getByText("Verify",{selector:"li"})).toHaveAttribute("aria-current","step");
  await act(async()=>confirm(proof));
  expect(screen.getByText("Save",{selector:"li"})).toHaveAttribute("aria-current","step");
  const save=screen.getByRole("button",{name:"Save wallet"});expect(save).toBeDisabled();
  expect(mocks.save).not.toHaveBeenCalled();fireEvent.click(screen.getByRole("checkbox"));fireEvent.click(save);
  await waitFor(()=>expect(saved).toHaveBeenCalledOnce());
  expect(prepared.assertCurrent).toHaveBeenCalledOnce();expect(mocks.save).toHaveBeenCalledExactlyOnceWith(challenge,profile,expect.any(String));
});
it("retains the verify step after a cancelled signature and supports an explicit retry",async()=>{
  vi.mocked(prepared.confirm).mockRejectedValueOnce(Error("private provider error"));render(tree());
  fireEvent.click(screen.getByRole("button",{name:"Continue with this wallet"}));
  const sign=await screen.findByRole("button",{name:/Sign and verify wallet/});fireEvent.click(sign);
  expect(await screen.findByRole("alert")).toBeVisible();
  expect(screen.getByText("Verify",{selector:"li"})).toHaveAttribute("aria-current","step");
  expect(screen.queryByRole("button",{name:"Save wallet"})).not.toBeInTheDocument();expect(mocks.save).not.toHaveBeenCalled();
  fireEvent.click(sign);expect(await screen.findByRole("button",{name:"Save wallet"})).toBeDisabled();
});
it("requires complete destination data before exposing setup actions",()=>{
  render(tree(false));expect(screen.queryByRole("button",{name:"Continue with this wallet"})).not.toBeInTheDocument();expect(mocks.prepare).not.toHaveBeenCalled();
});
it("disposes an in-flight proof when setup closes without progressing or saving",async()=>{
  let resolve!:(proof:PreparedWalletProof)=>void;mocks.prepare.mockImplementation(()=>new Promise<PreparedWalletProof>(finish=>{resolve=finish;}));
  const view=render(tree());fireEvent.click(screen.getByRole("button",{name:"Continue with this wallet"}));view.unmount();
  await act(async()=>resolve(prepared));expect(prepared.dispose).toHaveBeenCalledOnce();expect(mocks.save).not.toHaveBeenCalled();expect(saved).not.toHaveBeenCalled();
});
