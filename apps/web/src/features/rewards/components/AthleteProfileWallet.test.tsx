import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { I18nProvider } from "@/shared/i18n/I18nProvider";
import AthleteProfileWallet from "./AthleteProfileWallet";
import type { RewardDestination } from "../model/athleteDestinations";
const mocks = vi.hoisted(() => ({ withdraw:vi.fn(), mode:"local-testnet" }));
vi.mock("../data/athleteDestinations",()=>({withdrawRewardDestination:mocks.withdraw}));
vi.mock("@/lib/public-env",()=>({publicEnv:{get rewardDemo(){return {mode:mocks.mode};}}}));
vi.mock("./RewardWalletPanel",()=>({default:({athleteProfileId}:{athleteProfileId:string})=><p>Connecting {athleteProfileId}</p>}));
const profile="81000000-0000-4000-8000-000000000003";
const destination:RewardDestination={requestId:"81000000-0000-4000-8000-000000000001",athleteProfileId:profile,
  address:`0x${"a".repeat(40)}`,chainId:10143,status:"pending_review",requestedAt:"2026-09-15T10:00:00Z",withdrawnAt:null};
const base={ready:true,failed:false,profiles:[profile],profileId:profile,onProfile:vi.fn(),destinations:[destination],complete:true,
  refreshing:false,onRefresh:vi.fn(async()=>{}),onMore:vi.fn()};
const tree=(patch:Partial<ComponentProps<typeof AthleteProfileWallet>>={},locale:"en"|"hr"="en")=><I18nProvider initialLocale={locale}><AthleteProfileWallet {...base} {...patch}/></I18nProvider>;
beforeEach(()=>{mocks.withdraw.mockReset().mockResolvedValue(undefined);base.onRefresh.mockClear();base.onProfile.mockClear();mocks.mode="local-testnet";});
it.each(["en","hr"] as const)("shows one profile wallet before its collapsed history in %s without mutations",locale=>{
  render(tree({},locale));
  expect(screen.getByText(locale === "en" ? "Manage" : "Uredi").closest("details")).not.toHaveAttribute("open");
  fireEvent.click(screen.getByText(locale === "en" ? "Manage" : "Uredi"));
  expect(screen.getByRole("heading",{name:locale==="en"?"Your wallet":"Tvoj novčanik"})).toBeVisible();
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  expect(screen.getAllByRole("link",{name:`${destination.address.slice(0,8)}…${destination.address.slice(-6)}`})[0]).toHaveAttribute("href",`https://testnet.monadvision.com/address/${destination.address}`);
  expect(screen.getByRole("button",{name:locale==="en"?"Change wallet":"Promijeni novčanik"})).toBeEnabled();
  expect(mocks.withdraw).not.toHaveBeenCalled();
});
it("opens a replacement explanation, but cancel never withdraws or opens another wallet",()=>{
  render(tree());fireEvent.click(screen.getByText("Manage"));fireEvent.click(screen.getByRole("button",{name:"Change wallet"}));
  expect(screen.getByText(/Existing signed claims and past payments keep their original address/)).toBeVisible();
  fireEvent.click(screen.getByRole("button",{name:"Cancel"}));
  expect(screen.queryByRole("button",{name:"Remove current wallet"})).not.toBeInTheDocument();
  expect(mocks.withdraw).not.toHaveBeenCalled();expect(base.onRefresh).not.toHaveBeenCalled();
});
it("uses the exact saved wallet ID once, refreshes, then allows a replacement",async()=>{
  let finish!:()=>void; mocks.withdraw.mockImplementation(()=>new Promise<void>(resolve=>{finish=resolve;}));
  const view=render(tree());fireEvent.click(screen.getByText("Manage"));fireEvent.click(screen.getByRole("button",{name:"Change wallet"}));
  const remove=screen.getByRole("button",{name:"Remove current wallet"});fireEvent.click(remove);fireEvent.click(remove);
  expect(mocks.withdraw).toHaveBeenCalledExactlyOnceWith(destination.requestId);
  await act(async()=>finish());expect(base.onRefresh).toHaveBeenCalledOnce();
  // The query must actually confirm removal before setup appears.
  expect(screen.queryByText(`Connecting ${profile}`)).not.toBeInTheDocument();
  view.rerender(tree({destinations:[{...destination,status:"withdrawn",withdrawnAt:"2026-09-15T10:01:00Z"}]}));
  expect(await screen.findByText(`Connecting ${profile}`)).toBeVisible();
});
it("keeps an uncertain removal visible and never opens replacement setup",async()=>{
  mocks.withdraw.mockRejectedValue(Error("private failure"));render(tree());
  fireEvent.click(screen.getByText("Manage"));
  fireEvent.click(screen.getByRole("button",{name:"Change wallet"}));fireEvent.click(screen.getByRole("button",{name:"Remove current wallet"}));
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not confirm the change");
  expect(screen.getByRole("button",{name:"Remove current wallet"})).toBeDisabled();
  expect(screen.getAllByRole("button",{name:"Refresh wallet"})[0]).toBeEnabled();
  expect(screen.queryByText("private failure")).not.toBeInTheDocument();expect(base.onRefresh).not.toHaveBeenCalled();
  expect(screen.queryByText(`Connecting ${profile}`)).not.toBeInTheDocument();
});
it("cannot replace from incomplete pagination and hides private addresses after lost access",()=>{
  const view=render(tree({complete:false}));fireEvent.click(screen.getByText("Manage"));expect(screen.getByRole("button",{name:"Change wallet"})).toBeDisabled();
  view.rerender(tree({ready:false,failed:true}));expect(screen.queryByText(destination.address)).not.toBeInTheDocument();
  expect(screen.getByRole("button",{name:"Connect wallet"})).toBeDisabled();expect(mocks.withdraw).not.toHaveBeenCalled();
});
it("does not reuse a different profile or network wallet",async()=>{
  render(tree({destinations:[{...destination,chainId:31337},{...destination,athleteProfileId:"another-profile"}]}));
  expect(screen.queryByRole("button",{name:"Change wallet"})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"Connect wallet"}));expect(await screen.findByText(`Connecting ${profile}`)).toBeVisible();
  expect(mocks.withdraw).not.toHaveBeenCalled();
});
it("requires an explicit selection when several profiles are available",async()=>{
  render(tree({profileId:null,profiles:[profile,"second-profile"],destinations:[]}));
  expect(screen.getByRole("button",{name:"Connect wallet"})).toBeDisabled();
  fireEvent.change(screen.getByRole("combobox",{name:"Athlete profile"}),{target:{value:profile}});
  expect(base.onProfile).toHaveBeenCalledWith(profile);
  await waitFor(()=>expect(mocks.withdraw).not.toHaveBeenCalled());
  expect(within(screen.getByRole("region",{name:"Your wallet"})).queryByText(`Connecting ${profile}`)).not.toBeInTheDocument();
});
