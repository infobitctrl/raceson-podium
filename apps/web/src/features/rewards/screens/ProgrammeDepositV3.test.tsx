import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { createDefaultRewardProgrammeDraftV2, type SavedRewardPlanningDraft } from "@raceson/domain/rewards/programme-draft-v2";
import { decodeProgrammeDepositQuoteV3 } from "@raceson/domain/rewards/programme-deposit-v3";
// Transform the real lazy ABI dependency during collection, not inside the
// one-second UI assertion. Wallet/API actions remain lazy and fully exercised.
import "@raceson/rewards-chain/programme-v3";
import { I18nProvider } from "@/shared/i18n/I18nProvider";
import ProgrammeDepositV3 from "./ProgrammeDepositV3";
const mock = vi.hoisted(() => ({ review: vi.fn(), inspect: vi.fn(), request: vi.fn(), discover: vi.fn() }));
vi.mock("../data/programmeDepositV3", () => ({ reviewProgrammeDepositV3: (...args: unknown[]) => mock.review(...args), inspectProgrammeDepositV3: (...args: unknown[]) => mock.inspect(...args) }));
vi.mock("../data/browserWallet", () => ({ discoverRewardWallets: (_window: unknown, update: (v: unknown[]) => void) => {
  mock.discover(); update([{ id: "test", name: "Synthetic test wallet", provider: { request: mock.request, on: vi.fn(), removeListener: vi.fn() } }]); return vi.fn();
} }));
const id = "89000000-0000-4000-8000-000000000001", hash = `0x${"d".repeat(64)}`;
const record: SavedRewardPlanningDraft = { draftId: id, organizationId: id, seasonId: id, chainId: 31337, organizationName: "Synthetic organization",
  seasonName: "Synthetic league", revision: 1, updatedAt: "2026-09-10T00:00:00Z", rules: createDefaultRewardProgrammeDraftV2() };
const quote = () => decodeProgrammeDepositQuoteV3({ schema: "raceson-programme-deposit-v3", chainId: 31337, draftId: id, rulesRevision: 1, address: `0x${"a".repeat(40)}`,
  funderAddress: `0x${"b".repeat(40)}`, approvalId: id, contextHash: "c".repeat(64), policyHash: `0x${"e".repeat(64)}`,
  expectedDepositedWei: "0", amountWei: "1000000000000000000", budgetWei: "100000000000000000000000", expiresAt: new Date(Date.now() + 120000).toISOString() });
const refreshed = vi.fn();
const ui = (r = record, locale: "en" | "hr" = "en") => <I18nProvider initialLocale={locale}><ProgrammeDepositV3 record={r} onConfirmed={refreshed} /></I18nProvider>;
async function openReview() { fireEvent.click(screen.getByText("Open wallet funding")); await waitFor(() => expect(screen.getByText("Review deposit")).toBeEnabled()); fireEvent.click(screen.getByText("Review deposit")); await screen.findByText("Review the exact deposit"); }
beforeEach(() => {
  localStorage.clear(); vi.clearAllMocks(); const q = quote();
  mock.review.mockReset().mockResolvedValue({ status: "ready", quote: q }); mock.inspect.mockReset().mockResolvedValue({ status: "confirmed", transactionHash: hash });
  mock.request.mockReset().mockImplementation(async ({ method }) => method === "eth_chainId" ? "0x7a69" : method === "eth_sendTransaction" ? hash : [q.funderAddress]);
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request: async (_n: unknown, _o: unknown, callback: (v: unknown) => Promise<unknown>) => callback({ name: "test" }) } });
});
it("loads discovery only on opening, requires explicit wallet consent, and refreshes balances only after exact finalized receipt", async () => {
  render(ui()); expect(mock.discover).not.toHaveBeenCalled(); expect(mock.request).not.toHaveBeenCalled();
  await openReview(); expect(screen.getByText("1.0 MON")).toBeVisible(); expect(screen.getByText(quote().address)).toBeVisible();
  expect(screen.getByText("Confirm deposit in wallet")).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Wallet"), { target: { value: "test" } }); expect(mock.request).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(screen.getByText("Confirm deposit in wallet"));
  await waitFor(() => expect(screen.getByLabelText("Transaction hash")).toHaveValue(hash));
  expect(refreshed).not.toHaveBeenCalled(); expect(mock.review).toHaveBeenCalledTimes(2);
  await waitFor(() => expect(screen.getByText("Check finalized receipt")).toBeEnabled()); fireEvent.click(screen.getByText("Check finalized receipt"));
  await screen.findByText(/Exact deposit confirmed on the local chain/); expect(refreshed).toHaveBeenCalledOnce();
  expect(mock.request.mock.calls.filter(([r]) => r.method === "eth_sendTransaction")).toHaveLength(1);
});
it("editing amount invalidates the reviewed wallet consent without sending", async () => {
  render(ui()); await openReview(); fireEvent.change(screen.getByLabelText("Deposit amount (MON, decimal point)"), { target: { value: "2" } });
  expect(screen.queryByText("Confirm deposit in wallet")).not.toBeInTheDocument(); expect(mock.request).not.toHaveBeenCalled();
});
it("unmount during review prevents a stale response from reaching the wallet", async () => {
  let finish!: (v: unknown) => void; mock.review.mockImplementation(() => new Promise(r => { finish = r; }));
  const rendered = render(ui()); fireEvent.click(screen.getByText("Open wallet funding")); await waitFor(() => expect(screen.getByText("Review deposit")).toBeEnabled());
  fireEvent.click(screen.getByText("Review deposit")); rendered.unmount(); await act(async () => finish({ status: "ready", quote: quote() }));
  expect(mock.request).not.toHaveBeenCalled();
});
it("public testnet has an explicit gate and never discovers or opens wallets", () => {
  render(ui({ ...record, chainId: 10143 })); expect(screen.getByText(/Public-testnet programme deposits are not enabled yet/)).toBeVisible();
  expect(screen.queryByRole("button")).not.toBeInTheDocument(); expect(mock.discover).not.toHaveBeenCalled(); expect(mock.review).not.toHaveBeenCalled();
});
it("fully funded programmes do not request another wallet deposit", async () => {
  mock.review.mockResolvedValue({ status: "blocked", reason: "fully_funded" }); render(ui()); fireEvent.click(screen.getByText("Open wallet funding"));
  await waitFor(() => expect(screen.getByText("Review deposit")).toBeEnabled()); fireEvent.click(screen.getByText("Review deposit"));
  await screen.findByText("The programme is fully funded. No further deposit is needed."); expect(mock.request).not.toHaveBeenCalled();
});
it("restores unresolved hash after remount, localizes Croatian and never auto-sends", async () => {
  const rendered = render(ui()); await openReview(); fireEvent.change(screen.getByLabelText("Wallet"), { target: { value: "test" } });
  fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(screen.getByText("Confirm deposit in wallet"));
  await waitFor(() => expect(screen.getByLabelText("Transaction hash")).toHaveValue(hash)); rendered.unmount(); mock.request.mockClear();
  render(ui(record, "hr")); fireEvent.click(screen.getByText("Otvori uplatu iz novčanika"));
  await waitFor(() => expect(screen.getByLabelText("Identifikator transakcije")).toHaveValue(hash));
  expect(screen.getByText("Nerazriješena transakcija novčanika")).toBeVisible(); expect(mock.request).not.toHaveBeenCalled();
});
