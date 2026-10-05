import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CANARY_MANIFEST, contractCanaryPlan as plan, type CanaryStatus } from "@raceson/domain/rewards/canary";
import { FINAL_RESULTS_CANARY_MANIFEST, FINAL_RESULTS_CANARY_ADDRESS, FINAL_RESULTS_CANARY_DEPLOYMENT_TX,
  type FinalResultsCanaryStatus } from "@raceson/domain/rewards/final-results-canary";
import { I18nProvider } from "@/shared/i18n/I18nProvider";
import ContractCanary from "./ContractCanary";
const mocks = vi.hoisted(() => ({ read: vi.fn(), v3: vi.fn(), chain: 10143 }));
vi.mock("../data/canaryStatus", () => ({ getCanaryStatus: (...args: unknown[]) => mocks.read(...args), getFinalResultsCanaryStatus: (...args: unknown[]) => mocks.v3(...args) }));
vi.mock("@/lib/public-env", () => ({ publicEnv: { get rewardDemo() { return { chainId: mocks.chain }; } } }));
const initial: CanaryStatus = { schema: "raceson-canary-status-v1", chainId: 10143, manifestHash: CANARY_MANIFEST,
  observedBlock: { number: "123456", hash: `0x${"12".repeat(32)}`, timestamp: "1801000000" },
  wallets: (["funder", "operator", "relayer"] as const).map((role, index) => ({ role, address: plan[role], balanceWei: index === 0 ? "999996858000000000000" : "0" })),
  deployment: "absent", contract: null };
const finalResults: FinalResultsCanaryStatus = { ...initial, schema: "raceson-final-results-canary-status-v3", manifestHash: FINAL_RESULTS_CANARY_MANIFEST,
  deployment: "verified", contract: { address: FINAL_RESULTS_CANARY_ADDRESS, transactionHash: FINAL_RESULTS_CANARY_DEPLOYMENT_TX,
    state: 0, paused: false, fundedWei: "0", allocatedWei: "0", paidWei: "0", returnedWei: "0", balanceWei: "0",
    reviewPeriodSeconds: "0", reviewStartedAt: null, officialPublishedAt: null, allocationApprovedAt: null } };
const mount = (locale: "en" | "hr" = "en") => render(<I18nProvider initialLocale={locale}><MemoryRouter><ContractCanary /></MemoryRouter></I18nProvider>);
beforeEach(() => { mocks.chain = 10143; mocks.read.mockReset().mockResolvedValue(structuredClone(initial)); mocks.v3.mockReset().mockResolvedValue(structuredClone(finalResults)); });
describe("read-only testnet inspection", () => {
  it("defaults to V3 with its separate 0.1-MON trial and programme plan without signing controls", async () => {
    mount(); expect(await screen.findByText("999.996858 test MON")).toBeVisible();
    expect(screen.getByText("Awaiting contract funding")).toBeVisible();
    expect(screen.getByRole("heading", { name: "0.1 test MON · small trial" })).toBeVisible();
    expect(screen.getByText("0.04 test MON")).toBeVisible();
    expect(screen.getByText(/Final publication and allocation approval have not been recorded/)).toBeVisible();
    expect(screen.queryByText(/The 24-hour review has not started/)).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "100,000 test MON · programme" })).toBeVisible();
    expect(screen.getByText(/Verified at finalized block 123456/)).toBeVisible();
    expect(screen.getAllByRole("button")).toHaveLength(3);
    expect(screen.queryByText("0x050Ca3D328F8283CaE4B300567CCa54cF254282B")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View the first test transaction" }).getAttribute("href")).toMatch(/^https:\/\/testnet\.monadvision\.com\/tx\//);
  });
  it("clears old balances and deployment receipts on refresh failure, then recovers with a new observation", async () => {
    mount(); await screen.findByText("999.996858 test MON");
    mocks.v3.mockRejectedValueOnce(Error("private-provider-details")); fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Previous balances have been cleared");
    expect(screen.queryByText("999.996858 test MON")).not.toBeInTheDocument();
    expect(screen.queryByText("Not deployed")).not.toBeInTheDocument();
    expect(screen.queryByText(FINAL_RESULTS_CANARY_ADDRESS)).not.toBeInTheDocument();
    expect(screen.queryByText(/private-provider/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(await screen.findByText("999.996858 test MON")).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
  it("renders verified counters and the actual 24-hour review without claiming automatic activation", async () => {
    mocks.read.mockResolvedValue({ ...initial, deployment: "verified", contract: { address: "0x050Ca3D328F8283CaE4B300567CCa54cF254282B",
      transactionHash: `0x${"13".repeat(32)}`, state: 2, paused: true, fundedWei: "1000000000000000000", allocatedWei: "500000000000000000",
      paidWei: "0", returnedWei: "0", balanceWei: "1000000000000000000", reviewStartedAt: "1801000000", reviewDeadline: "1801086400" } });
    mount(); fireEvent.click(screen.getByRole("button", { name: /V2 · Original/ }));
    expect(await screen.findByText("Awards staged · activation pending · Paused")).toBeVisible();
    expect(screen.getByText(/24-hour review:/)).toBeVisible(); expect(screen.getByText(/does not activate claims automatically/)).toBeVisible();
    expect(screen.getByRole("link", { name: "View deployment transaction" })).toHaveAttribute("href", `https://testnet.monadvision.com/tx/0x${"13".repeat(32)}`);
    expect(screen.getByText("Paid out")).toBeVisible();
  });
  it("localizes public content and decimal balances into Croatian", async () => {
    mount("hr"); expect(await screen.findByText("999,996858 testnih MON")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Pametni ugovor i novčanici na testnoj mreži" })).toBeVisible();
    expect(screen.getByText("Čeka se financiranje ugovora")).toBeVisible();
    expect(screen.getByText("0,04 testnih MON")).toBeVisible();
    expect(screen.getByRole("button", { name: "Osvježi" })).toBeVisible();
  });
  it("does not query Monad in local simulation mode", async () => {
    mocks.chain = 31337; mount(); expect(screen.getByRole("alert")).toHaveTextContent("port 3102");
    expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.v3).not.toHaveBeenCalled(); expect(screen.getByRole("button", { name: "Refresh" })).toBeDisabled();
  });
  it("aborts the request when leaving the page", async () => {
    mocks.v3.mockImplementation(() => new Promise(() => {})); const view = mount();
    await waitFor(() => expect(mocks.v3).toHaveBeenCalledTimes(1)); const signal = mocks.v3.mock.calls[0][0] as AbortSignal;
    view.unmount(); expect(signal.aborted).toBe(true);
  });
  it("aborts an old V3 request on version switch and never shows its late response under V2", async () => {
    let resolve!: (value: FinalResultsCanaryStatus) => void;
    mocks.v3.mockImplementation(() => new Promise<FinalResultsCanaryStatus>(done => { resolve = done; }));
    mount(); const signal = mocks.v3.mock.calls[0][0] as AbortSignal;
    fireEvent.click(screen.getByRole("button", { name: /V2 · Original/ }));
    expect(signal.aborted).toBe(true); await screen.findByText("Not deployed");
    await act(async () => resolve(finalResults));
    expect(screen.queryByText(FINAL_RESULTS_CANARY_ADDRESS)).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "1 test MON · small trial" })).toBeVisible();
  });
  it("shows recorded V3 publication/approval without a second 24-hour deadline", async () => {
    mocks.v3.mockResolvedValue({ ...finalResults, contract: { ...finalResults.contract, state: 3,
      fundedWei: "100000000000000000", allocatedWei: "50000000000000000", balanceWei: "100000000000000000",
      reviewStartedAt: "1800999800", officialPublishedAt: "1800999800", allocationApprovedAt: "1800999900" } });
    mount(); expect(await screen.findByText("Claims active")).toBeVisible();
    expect(screen.getByText(/Recorded final publication:/)).toBeVisible();
    expect(screen.getByText("Checked per recipient")).toBeVisible();
    expect(screen.getByText("Payments recorded").closest("li")).toHaveAttribute("data-confirmed", "false");
    expect(screen.getByText("Claim availability").closest("li")).toHaveAttribute("data-confirmed", "true");
    expect(screen.getByText(/cannot verify sporting results or complaints itself/)).toBeVisible();
    expect(screen.queryByText(/24-hour review:/)).not.toBeInTheDocument();
  });
});
