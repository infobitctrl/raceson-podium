import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AthleteRewards from "./AthleteRewards";
import { I18nProvider } from "@/shared/i18n/I18nProvider";
import type { RewardAllocation, RewardAllocationsPage } from "../model/athleteRewards";
import type { RewardDestinationsPage } from "../model/athleteDestinations";
import { paymentFixture } from "../model/paymentFixtures.test-helper";
import { consentV3Fixture } from "../model/athleteConsentV3Fixtures.test-helper";

const controls = vi.hoisted(() => ({
  enabled: true, mode: "local", userId: "account-one", accountId: "account-one", loading: false,
  session: { fixtureEpoch: 1 } as Record<string, unknown>,
  getAllocations: vi.fn<() => Promise<RewardAllocationsPage>>(), walletRequests: vi.fn(),
  getDestinations: vi.fn<() => Promise<RewardDestinationsPage>>(),
  getClaims: vi.fn(),
  getClaimsV3: vi.fn(), sponsorAwards: vi.fn(),
  getAllocationsV3: vi.fn(),
  getPayment: vi.fn(), paymentV3: vi.fn(),
}));
vi.mock("@/lib/public-env", () => ({ publicEnv: { get rewardPortalEnabled() { return controls.enabled; }, get rewardDemo() { return { mode: controls.mode }; } } }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: controls.userId },
  account: { userId: controls.accountId, hasAthleteAccess: true }, session: controls.session, isLoading: controls.loading }) }));
vi.mock("../data/sponsorProgramme",()=>({sponsorAwards:controls.sponsorAwards}));
vi.mock("../data/athleteRewards", () => ({ getOwnRewardAllocations: controls.getAllocations }));
vi.mock("../data/athleteAllocationsV3", () => ({ getOwnAllocationsV3: controls.getAllocationsV3 }));
vi.mock("../data/athleteDestinations", () => ({ getOwnRewardDestinations: controls.getDestinations }));
vi.mock("../data/athleteClaims", () => ({ getOwnAthleteClaims: controls.getClaims }));
vi.mock("../data/athleteConsentV3", () => ({ getOwnAthleteClaimsV3: controls.getClaimsV3 }));
vi.mock("../data/athletePaymentStatusV3", () => ({ getAthletePaymentStatusV3: controls.paymentV3 }));
vi.mock("../data/athletePaymentStatus", () => ({ getAthletePaymentStatus: controls.getPayment }));

const award: RewardAllocation = {
  entitlementId: "00000000-0000-4000-8000-000000000001", campaignId: "00000000-0000-4000-8000-000000000002",
  athleteProfileId: "00000000-0000-4000-8000-000000000003", pot: "race", scopeKey: "00000000-0000-4000-8000-000000000004",
  chainId: 31337, environment: "local_simulation", amountWei: "1000000000000000001", identityChanged: true, ageStatus: "minor",
};
function mount(locale: "hr" | "en" = "en") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = () => <QueryClientProvider client={client}><I18nProvider initialLocale={locale}><MemoryRouter><AthleteRewards /></MemoryRouter></I18nProvider></QueryClientProvider>;
  const view = render(tree());
  return { ...view, update: () => view.rerender(tree()), client };
}
beforeEach(() => {
  controls.enabled = true; controls.mode = "local"; controls.userId = "account-one"; controls.accountId = "account-one"; controls.loading = false;
  controls.sponsorAwards.mockReset().mockResolvedValue([]);
  controls.getAllocations.mockReset().mockResolvedValue({ items: [award], nextCursor: null });
  controls.getDestinations.mockReset().mockResolvedValue({ items: [], nextCursor: null });
  controls.getClaims.mockReset().mockResolvedValue({ items: [], nextCursor: null });
  controls.getClaimsV3.mockReset().mockResolvedValue({ schema: "raceson-own-claims-v3", chainId: 31337, items: [], nextCursor: null });
  controls.getAllocationsV3.mockReset().mockResolvedValue({ schema: "raceson-own-allocations-v3", chainId: 31337, items: [], nextCursor: null });
  controls.getPayment.mockReset(); controls.paymentV3.mockReset().mockRejectedValue(new Error("fixture_status_unavailable"));
  controls.walletRequests.mockReset();
  Object.defineProperty(window, "ethereum", { configurable: true, value: undefined });
});

describe("athlete rewards journey", () => {
  it("includes sponsor-only awards in wallet selection and totals, then clears them after access loss",async()=>{
    controls.getAllocations.mockResolvedValue({items:[],nextCursor:null});
    controls.sponsorAwards.mockResolvedValue([{approvalId:award.campaignId,slot:1,entitlementId:`0x${"d".repeat(64)}`,amountWei:"2000000000000000000",athleteProfileId:award.athleteProfileId,claims:[]}]);
    mount();const summary=await screen.findByRole("region",{name:"Reward summary"});
    expect(within(summary).getByText("Total allocated").nextElementSibling).toHaveTextContent("2 test MON");
    expect(screen.getByRole("button",{name:"Connect wallet"})).toBeEnabled();
    expect(screen.queryByText("No allocations linked to your account yet")).not.toBeInTheDocument();
    expect(screen.queryByRole("region",{name:"Prepared reward claims"})).not.toBeInTheDocument();
    controls.sponsorAwards.mockRejectedValue({status:401});fireEvent.click(screen.getByRole("button",{name:"Refresh claims"}));
    expect(await screen.findByRole("alert")).toHaveTextContent("Sign in again");
    expect(screen.queryByRole("region",{name:"Sponsor campaign rewards"})).not.toBeInTheDocument();
    expect(screen.queryByRole("region",{name:"Reward summary"})).not.toBeInTheDocument();
    expect(screen.getByRole("button",{name:"Connect wallet"})).toBeDisabled();
  });
  it("counts one paid award once across multiple confirmed attempts and hides totals after access loss", async () => {
    const f = consentV3Fixture();
    controls.getAllocations.mockResolvedValue({ items: [], nextCursor: null });
    controls.getAllocationsV3.mockResolvedValue({ schema: "raceson-own-allocations-v3", chainId: 31337, items: [f.award], nextCursor: null });
    controls.getClaimsV3.mockResolvedValue({ schema: "raceson-own-claims-v3", chainId: 31337,
      items: [f.claim, { ...f.claim, claimId: "8fe00000-0000-4000-8000-000000000099" }], nextCursor: null });
    controls.paymentV3.mockImplementation(async claim => ({ ...f.payment, ...claim, state: "confirmed", confirmed: true,
      paymentId: claim.claimId, transactionHash: `0x${"a".repeat(64)}`, blockNumber: "400", blockHash: `0x${"b".repeat(64)}` }));
    const view = mount();
    const summary = await screen.findByRole("region", { name: "Reward summary" });
    await waitFor(() => expect(within(summary).getByText("Confirmed payments").nextElementSibling).toHaveTextContent("1 test MON"));
    expect(within(summary).queryByText("Awaiting payment")).not.toBeInTheDocument();
    expect(controls.paymentV3).toHaveBeenCalledTimes(2);
    controls.getClaimsV3.mockRejectedValue({ status: 401 });
    await act(async () => { await view.client.invalidateQueries({ queryKey: ["athlete-programme-claims-v3"] }); });
    await waitFor(() => expect(screen.queryByRole("region", { name: "Reward summary" })).not.toBeInTheDocument());
  });
  it("automatically selects one fully loaded profile and places its single wallet before all rewards", async () => {
    controls.getAllocations.mockResolvedValue({items:[award,{...award,entitlementId:"00000000-0000-4000-8000-000000000009",pot:"league"}],nextCursor:null});
    mount();await screen.findByText("Race reward");
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button",{name:"Connect wallet"})).toHaveLength(1);
    const wallet=screen.getByRole("region",{name:"Your wallet"});
    expect(wallet.compareDocumentPosition(screen.getByText("Race reward")) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(screen.getByRole("button",{name:"Connect wallet"})).toBeEnabled();
    expect(controls.walletRequests).not.toHaveBeenCalled();
  });
  it("does not infer the only profile while another award page remains unread", async () => {
    controls.getAllocations.mockResolvedValue({items:[award],nextCursor:award.entitlementId});
    mount();await screen.findByText("Race reward");
    expect(screen.getByRole("button",{name:"Connect wallet"})).toBeDisabled();
    expect(controls.walletRequests).not.toHaveBeenCalled();
  });
  it("keeps an open wallet flow across identical session re-emission, but closes it on token rotation", async () => {
    controls.session = { access_token: "synthetic-access", refresh_token: "synthetic-refresh",
      user: { id: "account-one" }, expires_at: 9999999999, token_type: "bearer" };
    const view = mount(); await screen.findByText("Race reward");
    fireEvent.click(screen.getByRole("button", { name: "Connect wallet" }));
    fireEvent.click(await screen.findByRole("button", {name:"Advanced · external wallet"}));
    await screen.findByText(/No compatible wallet was detected/);
    const reads = controls.getAllocations.mock.calls.length;
    controls.session = { ...controls.session, user: { id: "account-one" } }; view.update();
    expect(screen.getByText(/No compatible wallet was detected/)).toBeVisible();
    expect(controls.getAllocations).toHaveBeenCalledTimes(reads);
    controls.session = { ...controls.session, access_token: "synthetic-rotated" }; view.update();
    expect(screen.queryByText(/No compatible wallet was detected/)).not.toBeInTheDocument();
  });
  it("does not show legacy empty-state claims that contradict an existing programme reward", async () => {
    const f = consentV3Fixture(); controls.getAllocations.mockResolvedValue({ items: [], nextCursor: null });
    controls.getAllocationsV3.mockResolvedValue({ schema: "raceson-own-allocations-v3", chainId: 31337, items: [f.award], nextCursor: null });
    controls.getClaimsV3.mockResolvedValue({ schema: "raceson-own-claims-v3", chainId: 31337, items: [f.claim], nextCursor: null });
    mount(); await screen.findByText(f.claim.recipientAddress);
    expect(screen.queryByText("No allocations linked to your account yet")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Prepared reward claims" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /League reward · Details/ }));
    if (!screen.getByText("Claim history (1)").closest("details")!.open) fireEvent.click(screen.getByText("Claim history (1)"));
    expect(screen.getByRole("region", { name: "Prepared programme rewards" })).toBeVisible();
  });
  it("hides all private data when the V3 claim history loses authorization", async () => {
    const f = consentV3Fixture(); controls.getClaimsV3.mockResolvedValue({ schema: "raceson-own-claims-v3", chainId: 31337, items: [f.claim], nextCursor: null });
    mount(); await screen.findByText(f.claim.recipientAddress);
    controls.getClaimsV3.mockRejectedValue({ status: 401, message: "private fixture failure" });
    fireEvent.click(screen.getByRole("button", { name: "Refresh allocations" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Sign in again");
    expect(screen.queryByText(f.claim.recipientAddress)).not.toBeInTheDocument();
    expect(screen.queryByText("Race reward")).not.toBeInTheDocument();
    expect(screen.queryByText("private fixture failure")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect wallet" })).toBeDisabled();
  });
  it("does not reuse an in-flight V3 claim read after switching demo networks", async () => {
    const f = consentV3Fixture(); let finish!: (value: unknown) => void;
    controls.getClaimsV3.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const view = mount(); await waitFor(() => expect(finish).toBeTypeOf("function"));
    controls.mode = "local-testnet"; view.update();
    await waitFor(() => expect(controls.getClaimsV3).toHaveBeenCalledWith(10143, null));
    await act(async () => finish({ schema: "raceson-own-claims-v3", chainId: 31337, items: [f.claim], nextCursor: null }));
    expect(screen.queryByText(f.claim.recipientAddress)).not.toBeInTheDocument();
    expect(controls.getClaimsV3).toHaveBeenCalledTimes(2);
  });
  it("shows the V3 allocation separately from legacy claims, preserving exact values and synthetic labels", async () => {
    controls.getAllocationsV3.mockResolvedValue({ schema: "raceson-own-allocations-v3", chainId: 31337, items: [{
      entitlementId: `0x${"a".repeat(64)}`, approvalId: award.campaignId, draftId: award.scopeKey, slot: 1,
      athleteProfileId: award.athleteProfileId, chainId: 31337, sourceKind: "synthetic_rehearsal", amountWei: "2345678901234567891",
      campaignAddress: `0x${"b".repeat(40)}`, recordedAt: "2026-09-10T18:00:00Z", ageStatus: "unverified_adult",
    }], nextCursor: null });
    mount(); expect(await screen.findByText("Round 1 reward")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /Round 1 reward · Details/ }));
    fireEvent.click(screen.getByText("Exact amount"));
    expect(screen.getByText(/2\.345678901234567891/)).toBeVisible();
    expect(screen.getByText(/Synthetic test results/)).toBeVisible();
    expect(screen.getByText(/No action needed yet/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Connect wallet" }));
    fireEvent.click(await screen.findByRole("button", {name:"Advanced · external wallet"}));
    expect(await screen.findByText(/No compatible wallet was detected/)).toBeVisible();
    expect(controls.walletRequests).not.toHaveBeenCalled();
    controls.getAllocationsV3.mockRejectedValue({status:401});
    fireEvent.click(screen.getByRole("button",{name:"Refresh allocations"}));
    expect(await screen.findByRole("alert")).toHaveTextContent("Sign in again");
    expect(screen.queryByText("Round 1 reward")).not.toBeInTheDocument();
    expect(screen.queryByText(/No compatible wallet was detected/)).not.toBeInTheDocument();
  });
  it("tears down a pending receipt read on same-account session replacement and ignores its late response", async () => {
    const f = paymentFixture(); controls.getClaims.mockResolvedValue({ items: [f.history], nextCursor: null });
    let finish!: (value: unknown) => void;
    controls.getPayment.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const view = mount(); fireEvent.click(await screen.findByRole("button", { name: "Payment status" }));
    await waitFor(() => expect(finish).toBeTypeOf("function"));
    controls.session = { fixtureEpoch: 90 }; controls.getClaims.mockResolvedValue({ items: [], nextCursor: null }); view.update();
    expect(screen.queryByRole("region", { name: "Reward payment status" })).not.toBeInTheDocument();
    await act(async () => finish(f.payment));
    expect(screen.queryByText(f.payment.receipt!.transactionHash)).not.toBeInTheDocument();
    expect(controls.getPayment).toHaveBeenCalledOnce();
  });
  it("a receipt endpoint 401 closes all private reward views, not just the receipt panel", async () => {
    const f = paymentFixture(); controls.getClaims.mockResolvedValue({ items: [f.history], nextCursor: null });
    controls.getPayment.mockRejectedValue({ status: 401, message: "private internal failure" }); mount();
    fireEvent.click(await screen.findByRole("button", { name: "Payment status" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Sign in again");
    expect(screen.queryByRole("region", { name: "Reward payment status" })).not.toBeInTheDocument();
    expect(screen.queryByText(f.history.recipientAddress)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect wallet" })).toBeDisabled();
    expect(screen.queryByText("private internal failure")).not.toBeInTheDocument();
  });
  it.each(["en", "hr"] as const)("renders exact allocations, age and merge holds in %s, never a claim button", async locale => {
    mount(locale);
    expect(await screen.findByText(locale === "en" ? "Race reward" : "Nagrada za utrku")).toBeVisible();
    expect(within(screen.getByRole("region", { name: locale === "en" ? "Your allocations" : "Tvoje dodijeljene nagrade" })).getByText(locale === "en" ? /1\.000000000000000001/ : /1,000000000000000001/)).toBeVisible();
    expect(screen.getByText(locale === "en" ? /Payments to minors or guardians/ : /Pilot ne podržava isplate maloljetnicima/)).toBeVisible();
    expect(screen.getByText(locale === "en" ? /Profile history was merged/ : /Povijest profila je spojena/)).toBeVisible();
    expect(screen.getByRole("link", { name: locale === "en" ? "View race" : "Pogledaj utrku" })).toHaveAttribute("href", `/events/${award.scopeKey}`);
    expect(within(screen.getByRole("region",{name:locale === "en" ? "Your allocations" : "Tvoje dodijeljene nagrade"})).queryByRole("button", { name: /claim|preuzmi|isplati|withdraw/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByText(locale === "en" ? "Manage receiving wallet" : "Upravljaj novčanikom primatelja"));
    fireEvent.click(screen.getByText(locale === "en" ? "I do not have a wallet" : "Nemam novčanik"));
    expect(screen.getByText(locale === "en" ? /You do not need a wallet to keep your eligible share reserved/ : /Novčanik ti nije potreban da tvoj pripadajući udio ostane rezerviran/)).toBeVisible();
  });
  it("does not fetch private data or discover a wallet while the feature is disabled", () => {
    controls.enabled = false; mount();
    expect(screen.getByRole("status")).toHaveTextContent("The rewards pilot is being prepared");
    expect(controls.getAllocations).not.toHaveBeenCalled();
    expect(controls.getDestinations).not.toHaveBeenCalled();
    expect(controls.getClaims).not.toHaveBeenCalled();
    expect(controls.getClaimsV3).not.toHaveBeenCalled();
    expect(controls.getAllocationsV3).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Connect wallet" })).not.toBeInTheDocument();
  });
  it("links an empty allocation list to existing profile history, without suggesting a new identity", async () => {
    controls.getAllocations.mockResolvedValue({ items: [], nextCursor: null }); mount();
    expect(await screen.findByText("No allocations linked to your account yet")).toBeVisible();
    expect(screen.getByRole("link", { name: "Review my profile and race history" })).toHaveAttribute("href", "/athlete/account?view=edit#athlete-race-history");
    expect(screen.getByText(/An empty list does not mean you are ineligible/)).toBeVisible();
  });
  it("requires explicit wallet entry and requests no accounts just to list available wallets", async () => {
    Object.defineProperty(window, "ethereum", { configurable: true, value: { request: controls.walletRequests, on: vi.fn(), removeListener: vi.fn() } });
    mount(); await screen.findByText("Race reward");
    expect(screen.queryByRole("button", { name: "Browser wallet" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Connect wallet" }));
    expect(screen.queryByRole("button", { name: "Browser wallet" })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Advanced · external wallet" }));
    expect(await screen.findByRole("button", { name: "Browser wallet" })).toBeVisible();
    expect(controls.walletRequests).not.toHaveBeenCalled();
  });
  it("hides stale allocations and unmounts the wallet flow when a refresh loses authorization", async () => {
    mount(); await screen.findByText("Race reward");
    controls.getAllocations.mockRejectedValue({ status: 401, message: "private raw error" });
    fireEvent.click(screen.getByRole("button", { name: "Refresh allocations" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Sign in again");
    expect(screen.queryByText("Race reward")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect wallet" })).toBeDisabled();
    expect(screen.queryByText("private raw error")).not.toBeInTheDocument();
  });
  it("clears the visible identity immediately during an account change, ignoring a late old read", async () => {
    let resolveOld!: (value: RewardAllocationsPage) => void;
    controls.getAllocations.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
    const view = mount(); await waitFor(() => expect(resolveOld).toBeTypeOf("function"));
    controls.userId = "account-two"; controls.accountId = "account-two";
    controls.getAllocations.mockResolvedValue({ items: [], nextCursor: null }); view.update();
    await screen.findByText("No allocations linked to your account yet");
    await act(async () => resolveOld({ items: [award], nextCursor: null }));
    expect(screen.queryByText("Race reward")).not.toBeInTheDocument();
    expect(controls.getAllocations).toHaveBeenCalledTimes(2);
  });
  it("does not query when account and login identities disagree", () => {
    controls.accountId = "another-account"; mount();
    expect(screen.getByRole("alert")).toHaveTextContent("Sign in again");
    expect(controls.getAllocations).not.toHaveBeenCalled();
  });
  it("closes wallet setup when the same user's session is refreshed or replaced", async () => {
    const view = mount(); await screen.findByText("Race reward");
    fireEvent.click(screen.getByRole("button", { name: "Connect wallet" }));
    fireEvent.click(await screen.findByRole("button", {name:"Advanced · external wallet"}));
    await screen.findByText(/No compatible wallet was detected/);
    controls.session = { fixtureEpoch: 2 }; view.update();
    expect(screen.queryByText(/No compatible wallet was detected/)).not.toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Connect wallet" })).toBeVisible();
  });
  it("does not reuse an in-flight private read across two sessions for the same account", async () => {
    let resolveOld!: (value: RewardAllocationsPage) => void;
    controls.getAllocations.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
    const view = mount(); await waitFor(() => expect(resolveOld).toBeTypeOf("function"));
    controls.session = { fixtureEpoch: 99 };
    controls.getAllocations.mockResolvedValue({ items: [], nextCursor: null }); view.update();
    await screen.findByText("No allocations linked to your account yet");
    await act(async () => resolveOld({ items: [award], nextCursor: null }));
    expect(screen.queryByText("Race reward")).not.toBeInTheDocument(); expect(controls.getAllocations).toHaveBeenCalledTimes(2);
  });
  it("hides both saved addresses and allocations when a private history refresh loses authorization", async () => {
    const address = `0x${"ab".repeat(20)}` as const;
    controls.getDestinations.mockResolvedValue({ items: [{ requestId: award.entitlementId, athleteProfileId: award.athleteProfileId,
      address, chainId: 31337, requestedAt: "2026-09-08T08:00:00Z", withdrawnAt: null, status: "pending_review" }], nextCursor: null });
    mount(); await screen.findByText("Race reward"); expect(screen.getByText(`${address.slice(0, 8)}…${address.slice(-6)}`)).toBeVisible();
    fireEvent.click(screen.getByText("Manage", { selector: "summary" }));
    fireEvent.click(screen.getByText("Wallet history"));
    controls.getDestinations.mockRejectedValue({ status: 401 });
    fireEvent.click(screen.getByRole("button", { name: "Refresh wallet" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Sign in again");
    expect(screen.queryByText(address)).not.toBeInTheDocument(); expect(screen.queryByText("Race reward")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect wallet" })).toBeDisabled();
  });
});
