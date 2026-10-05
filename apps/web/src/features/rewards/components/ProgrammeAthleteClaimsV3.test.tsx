import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/shared/i18n/I18nProvider";
import ProgrammeAthleteClaimsV3 from "./ProgrammeAthleteClaimsV3";
import ProgrammeAthleteClaimDetailV3 from "./ProgrammeAthleteClaimDetailV3";
import { consentV3Fixture, consentV3Signer } from "../model/athleteConsentV3Fixtures.test-helper";
import type { RewardWalletProvider } from "../data/browserWallet";

const calls = vi.hoisted(() => ({ read: vi.fn(), submit: vi.fn(), payment: vi.fn(), env: { rewardPortalEnabled: true, rewardDemo: { mode: "local" } } }));
vi.mock("@/lib/public-env", () => ({ publicEnv: calls.env }));
vi.mock("../data/athleteConsentV3", () => ({ getAthleteConsentReviewV3: calls.read, submitAthleteConsentV3: calls.submit }));
vi.mock("../data/athletePaymentStatusV3", () => ({ getAthletePaymentStatusV3: calls.payment }));
const fixture = consentV3Fixture(), listeners = new Map<string, (...args: unknown[]) => void>();
const request = vi.fn(async ({ method, params }: { method: string; params?: unknown[] }): Promise<unknown> => {
  if (method === "eth_accounts" || method === "eth_requestAccounts") return [consentV3Signer.address];
  if (method === "eth_chainId") return "0x7a69";
  if (method === "eth_signTypedData_v4") return consentV3Signer.signTypedData(JSON.parse(params?.[1] as string));
  throw Error("unexpected wallet method");
});
const provider: RewardWalletProvider = { request, on: (e, cb) => { listeners.set(e, cb); }, removeListener: e => { listeners.delete(e); } };
function detail(locale: "en" | "hr" = "en", mode: "consent" | "payment" = "consent", lost = vi.fn()) {
  return render(<I18nProvider initialLocale={locale}><ProgrammeAthleteClaimDetailV3 claim={fixture.claim} selection={fixture.selection} mode={mode}
    onRecorded={vi.fn()} onAccessLost={lost} onClose={vi.fn()} /></I18nProvider>);
}
async function sign(locale: "en" | "hr" = "en") {
  fireEvent.click(await screen.findByRole("button", { name: locale === "en" ? "Advanced · external wallet" : "Napredno · vanjski novčanik" })); fireEvent.click(await screen.findByRole("button", { name: locale === "en" ? "Browser wallet" : "Novčanik preglednika" }));
  const button = screen.getByRole("button", { name: locale === "en" ? "Confirm claim in wallet" : "Potvrdi zahtjev u novčaniku" });
  expect(button).toBeDisabled(); expect(request).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(button);
  await waitFor(() => expect(calls.submit).toHaveBeenCalled());
}
beforeEach(() => {
  calls.read.mockReset().mockResolvedValue(fixture.review); calls.submit.mockReset().mockResolvedValue(fixture.receipt); calls.payment.mockReset().mockResolvedValue(fixture.payment);
  request.mockClear(); listeners.clear(); calls.env.rewardDemo.mode = "local";
  Object.defineProperty(window, "ethereum", { configurable: true, value: provider });
});
describe("programme V3 athlete consent and payment screens", () => {
  it("enables synthetic consent only for the exact owner-approved testnet profile and programme", () => {
    const award={...fixture.award,chainId:10143 as const,ageStatus:"synthetic_test" as const,
      draftId:"9a000000-0000-4000-8000-000000000052",athleteProfileId:"9a000000-0000-4000-8000-000000001060"};
    const claim={...fixture.claim,chainId:10143 as const};
    for(const [patch,enabled] of [[{},true],
      [{athleteProfileId:"9a000000-0000-4000-8000-000000001061"},true],
      [{athleteProfileId:"9a000000-0000-4000-8000-000000001062"},false],
      [{draftId:fixture.award.draftId},false],
      [{athleteProfileId:fixture.award.athleteProfileId},false],[{chainId:31337},false]] as const){
      const view=render(<I18nProvider initialLocale="en"><ProgrammeAthleteClaimsV3 items={[claim]}
        awards={[{...award,...patch}]} pending={false} refreshing={false} hasMore={false}
        onRefresh={vi.fn()} onMore={vi.fn()} onAccessLost={vi.fn()} /></I18nProvider>);
      const button=screen.queryByRole("button",{name:"Claim reward"});
      if(enabled)expect(button).toBeEnabled();else expect(button).not.toBeInTheDocument();view.unmount();
    }
  });
  it.each(["en", "hr"] as const)("reviews exact amount and domain, then one Claim action signs and saves in %s", async locale => {
    detail(locale); await screen.findByText(fixture.claim.recipientAddress); expect(screen.getByRole("region")).toHaveFocus();
    expect(screen.getByText(locale === "en" ? /1\.000000000000000001/ : /1,000000000000000001/)).toBeVisible();
    await sign(locale); expect(listeners.size).toBe(0);
    expect(await screen.findByText(locale === "en" ? "Claim submitted" : "Zahtjev je poslan")).toBeVisible();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument(); expect(calls.payment).not.toHaveBeenCalled();
    expect(calls.submit.mock.calls[0][0]).toEqual(fixture.selection);
    expect(new Set(request.mock.calls.map(([r]) => r.method))).toEqual(new Set(["eth_requestAccounts", "eth_accounts", "eth_chainId", "eth_signTypedData_v4"]));
    expect(screen.queryByText(locale === "en" ? "Test payment confirmed" : "Testna isplata je potvrđena")).not.toBeInTheDocument();
  });
  it("retains exact proof for explicit lost-save retry without signing again", async () => {
    calls.submit.mockRejectedValueOnce(Error("private SQL")); detail(); await sign();
    expect(await screen.findByRole("alert")).toHaveTextContent("consent may have been saved"); expect(screen.queryByText("private SQL")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Submit claim" })); await screen.findByText("Claim submitted");
    expect(calls.submit.mock.calls[0]).toEqual(calls.submit.mock.calls[1]); expect(request.mock.calls.filter(([r]) => r.method === "eth_signTypedData_v4")).toHaveLength(1);
  });
  it("reloads recorded consent without requesting accounts or another signature", async () => {
    calls.read.mockResolvedValue({ ...fixture.receipt, status: "already_recorded" }); detail(); await screen.findByText("Claim submitted");
    expect(request).not.toHaveBeenCalled(); expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
  it("wallet cancellation never saves consent and leaves an explicit retry", async () => {
    const original=request.getMockImplementation()!;
    request.mockImplementation(r=>r.method==="eth_signTypedData_v4"?Promise.reject({code:4001}):original(r));
    try {
      detail();fireEvent.click(await screen.findByRole("button", { name: "Advanced · external wallet" })); fireEvent.click(await screen.findByRole("button",{name:"Browser wallet"}));
      fireEvent.click(screen.getByRole("checkbox"));fireEvent.click(screen.getByRole("button",{name:"Confirm claim in wallet"}));
      await screen.findByRole("alert");expect(calls.submit).not.toHaveBeenCalled();
      expect(screen.getByRole("button",{name:"Confirm claim in wallet"})).toBeEnabled();
    } finally {request.mockImplementation(original);}
  });
  it("does not expose signing controls when source/session review fails", async () => {
    for (const status of [401, 409]) {
      calls.read.mockRejectedValue({ status, message: "private source" }); const lost = vi.fn(), view = detail("en", "consent", lost);
      await screen.findByRole("alert"); expect(screen.queryByRole("checkbox")).not.toBeInTheDocument(); expect(screen.queryByText("private source")).not.toBeInTheDocument();
      expect(lost).toHaveBeenCalledTimes(status === 401 ? 1 : 0); view.unmount();
    }
  });
  it("discards a signature and subscriptions after unmount during the wallet prompt", async () => {
    const original = request.getMockImplementation()!; let finish!: (value: unknown) => void;
    request.mockImplementation(r => r.method === "eth_signTypedData_v4" ? new Promise(resolve => { finish = resolve; }) : original(r));
    const view = detail(); fireEvent.click(await screen.findByRole("button", { name: "Advanced · external wallet" })); fireEvent.click(await screen.findByRole("button", { name: "Browser wallet" })); fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Confirm claim in wallet" })); await waitFor(() => expect(finish).toBeTypeOf("function"));
    view.unmount(); await act(async () => finish(await consentV3Signer.signTypedData(fixture.review.typedData)));
    expect(calls.submit).not.toHaveBeenCalled(); expect(listeners.size).toBe(0); request.mockImplementation(original);
  });
  it("shows actual persisted payment states and drops a stale receipt after denied refresh", async () => {
    calls.payment.mockResolvedValue({ ...fixture.payment, state: "confirmed", confirmed: true, paymentId: fixture.claim.claimId,
      transactionHash: `0x${"a".repeat(64)}`, blockNumber: "400", blockHash: `0x${"b".repeat(64)}`, readinessHeld: true });
    const lost = vi.fn(); detail("hr", "payment", lost); await screen.findByText("Testna isplata je potvrđena");
    expect(screen.getByText(/Ranija potvrđena isplata ostaje dio povijesti/)).toBeVisible(); expect(request).not.toHaveBeenCalled(); expect(calls.read).not.toHaveBeenCalled();
    calls.payment.mockRejectedValue({ status: 401 }); fireEvent.click(screen.getByRole("button", { name: "Osvježi status isplate" }));
    await screen.findByRole("alert"); expect(screen.queryByText("Testna isplata je potvrđena")).not.toBeInTheDocument(); expect(lost).toHaveBeenCalledOnce();
  });
  it("labels the sixth pot as league, disables unmatched consent and preserves payment-history access", async () => {
    const second = { ...fixture.claim, claimId: "8fe00000-0000-4000-8000-000000000019", entitlementId: `0x${"f".repeat(64)}` as `0x${string}` };
    render(<I18nProvider initialLocale="en"><ProgrammeAthleteClaimsV3 items={[fixture.claim, second]} awards={[fixture.award]} pending={false} refreshing={false}
      hasMore={false} onRefresh={vi.fn()} onMore={vi.fn()} onAccessLost={vi.fn()} /></I18nProvider>);
    const rows = screen.getAllByRole("listitem"); expect(within(rows[0]).getByText("League reward")).toBeVisible();
    expect(within(rows[1]).queryByRole("button", { name: "Claim reward" })).not.toBeInTheDocument();
    expect(within(rows[1]).getByRole("button", { name: "Reward payment status" })).toBeEnabled(); expect(calls.read).not.toHaveBeenCalled();
    fireEvent.click(within(rows[0]).getByRole("button", { name: "Claim reward" })); await screen.findByRole("region", { name: "Claim reward" });
  });
});
