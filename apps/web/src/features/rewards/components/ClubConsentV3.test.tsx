import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClubConsentSelectionV3 } from "@raceson/rewards-chain/club-consent-v3";
import { I18nProvider } from "@/shared/i18n/I18nProvider";
import ClubConsentV3 from "./ClubConsentV3";
const mocks = vi.hoisted(() => ({ read: vi.fn(), create: vi.fn(), discover: vi.fn(), collect: vi.fn(), submit: vi.fn(), dispose: vi.fn(), request: vi.fn(), lost: vi.fn(), close: vi.fn(), recorded: vi.fn(), network: vi.fn() }));
vi.mock("../data/clubConsentV3", () => ({ getClubConsentReviewV3: mocks.read }));
vi.mock("../data/browserClubConsentV3", () => ({ createBrowserClubConsentV3: mocks.create }));
vi.mock("../data/browserWallet", () => ({ discoverRewardWallets: mocks.discover }));
vi.mock("../data/athleteClaims", () => ({ requireClaimNetwork: mocks.network }));
const id = (n: number) => `81000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const address = (n: number) => `0x${String(n).repeat(40)}` as `0x${string}`;
const selection: ClubConsentSelectionV3 = { chainId: 10143, uploadId: id(1), requestId: id(2), claimId: id(3), entitlementId: `0x${"1".repeat(64)}`,
  campaignAddress: address(2), recipientAddress: address(3), amountWei: "1000000000000000001", pot: "league" };
const progress = (n=0, recorded=false) => ({ required: 2 as const, signaturesCollected:n, signedBy:[address(4),address(5)].slice(0,n), recipientConsented:recorded, operatorApproved:false });
let state = progress(), changed: () => void, signal: AbortSignal;
beforeEach(() => {
  Object.values(mocks).forEach(fn => fn.mockReset()); state = progress();
  mocks.read.mockResolvedValue({ status:"signature_required", expiresAt:String(Math.floor(Date.now()/1000)+1000) });
  mocks.create.mockImplementation((_s,_r,s,_current,c) => { signal=s; changed=c; return {progress:()=>state, collect:mocks.collect, submit:mocks.submit, dispose:mocks.dispose}; });
  mocks.collect.mockImplementation(async () => state = progress(state.signaturesCollected+1));
  mocks.submit.mockImplementation(async () => state = progress(0,true));
  mocks.request.mockResolvedValue([address(4)]);
  mocks.discover.mockImplementation((_window, update) => { update([{id:"owner-wallet",name:"Owner wallet fixture",provider:{request:mocks.request,on:vi.fn(),removeListener:vi.fn()}}]); return vi.fn(); });
});
const mount = (locale:"en"|"hr"="en") => render(<I18nProvider initialLocale={locale}><ClubConsentV3 selection={selection} onAccessLost={mocks.lost} onClose={mocks.close} onRecorded={mocks.recorded}/></I18nProvider>);
async function connect(addressValue=address(4)) {
  mocks.request.mockResolvedValue([addressValue]);
  const advanced=await screen.findByRole("button",{name:"Advanced · external wallet"});
  if(advanced.getAttribute("aria-expanded")==="false")fireEvent.click(advanced);
  fireEvent.change(await screen.findByLabelText("Owner wallet"),{target:{value:"owner-wallet"}});
  fireEvent.click(screen.getByRole("button",{name:"Connect / refresh signer"}));
  await screen.findByRole("checkbox");
}
async function sign() {
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button",{name:"Sign with this owner"}));
  await waitFor(()=>expect(screen.queryByRole("checkbox")).not.toBeInTheDocument());
}
describe("club consent controls",()=>{
  it.each(["en","hr"] as const)("shows exact award without wallet calls in %s",async locale=>{
    mount(locale); await screen.findByText(locale==="en"?"Signatures collected: 0 / 2":"Prikupljeni potpisi: 0 / 2");
    expect(screen.getByText(locale==="en"?"1.000000000000000001 test MON":"1,000000000000000001 testni MON")).toBeVisible();
    expect(screen.getByText(selection.recipientAddress)).toBeVisible(); expect(screen.getByText("Monad testnet · 10143")).toBeVisible();
    expect(mocks.request).not.toHaveBeenCalled(); expect(mocks.collect).not.toHaveBeenCalled(); expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("requires visible signer acknowledgement and two separate signatures before explicit consent submission",async()=>{
    mount(); await connect();
    expect(screen.getByRole("button",{name:"Sign with this owner"})).toBeDisabled();
    expect(screen.getByText(address(4))).toBeVisible(); expect(mocks.collect).not.toHaveBeenCalled();
    await sign(); expect(mocks.collect).toHaveBeenLastCalledWith(expect.objectContaining({request:mocks.request}),address(4));
    expect(screen.queryByRole("button",{name:"Submit two-owner consent"})).not.toBeInTheDocument();
    await connect(address(5)); await sign();
    expect(mocks.submit).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole("button",{name:"Submit two-owner consent"}));
    await screen.findByText(/Club consent recorded —/); expect(mocks.submit).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Test payment confirmed")).not.toBeInTheDocument(); expect(mocks.recorded).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button",{name:"Return to refreshed club rewards"})); expect(mocks.recorded).toHaveBeenCalledTimes(1);
  });
  it("blocks an already-used signer and discards state on wallet invalidation",async()=>{
    mount(); await connect(); await sign(); await connect();
    expect(screen.getByRole("button",{name:"Sign with this owner"})).toBeDisabled();
    expect(screen.getByText(/This owner has already signed/)).toBeVisible();
    act(()=>changed()); expect(screen.getByText(/This signing session is closed/)).toBeVisible();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument(); expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("recovers recorded consent without opening a wallet",async()=>{
    state=progress(0,true); mocks.read.mockResolvedValue({status:"already_recorded",expiresAt:"1700000000"});
    mount(); await screen.findByText(/Club consent recorded —/); expect(mocks.request).not.toHaveBeenCalled(); expect(mocks.discover).not.toHaveBeenCalled();
  });
  it("fails closed on a source hold without signing",async()=>{
    mocks.read.mockRejectedValue({status:409}); mount(); await screen.findByRole("alert");
    expect(screen.getByText(/This signing session is closed/)).toBeVisible(); expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.request).not.toHaveBeenCalled();
  });
  it("retains collected proofs for an explicit submit retry, not an automatic retry",async()=>{
    mount(); await connect(); await sign(); await connect(address(5)); await sign();
    mocks.submit.mockRejectedValueOnce(new Error("lost response"));
    fireEvent.click(screen.getByRole("button",{name:"Submit two-owner consent"})); await screen.findByRole("alert");
    expect(mocks.submit).toHaveBeenCalledTimes(1); expect(mocks.collect).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button",{name:"Submit two-owner consent"})); await screen.findByText(/Club consent recorded —/);
    expect(mocks.submit).toHaveBeenCalledTimes(2); expect(mocks.collect).toHaveBeenCalledTimes(2);
  });
  it("aborts a pending wallet step on unmount and ignores its late result",async()=>{
    const v=mount(); fireEvent.click(await screen.findByRole("button",{name:"Advanced · external wallet"})); await screen.findByLabelText("Owner wallet"); let resolve!:(v:unknown)=>void;
    mocks.request.mockImplementation(()=>new Promise(r=>resolve=r));
    fireEvent.change(screen.getByLabelText("Owner wallet"),{target:{value:"owner-wallet"}});
    fireEvent.click(screen.getByRole("button",{name:"Connect / refresh signer"})); v.unmount();
    expect(signal.aborted).toBe(true); expect(mocks.dispose).toHaveBeenCalled();
    await act(async()=>resolve([address(4)])); expect(mocks.collect).not.toHaveBeenCalled(); expect(mocks.recorded).not.toHaveBeenCalled();
  });
  it("propagates lost account access without another prompt",async()=>{
    mocks.read.mockRejectedValue({status:401}); mount(); await screen.findByRole("alert");
    expect(mocks.lost).toHaveBeenCalledWith({status:401}); expect(mocks.request).not.toHaveBeenCalled();
  });
});
