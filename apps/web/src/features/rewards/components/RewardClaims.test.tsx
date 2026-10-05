import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/shared/i18n/I18nProvider";
import RewardClaimReview from "./RewardClaimReview";
import RewardClaimHistory from "./RewardClaimHistory";
import { decodeAthleteClaimReview } from "../model/athleteClaimConsent";
import { claimFixture, claimSigner } from "../model/claimFixtures.test-helper";
import type { RewardWalletProvider } from "../data/browserWallet";

const calls = vi.hoisted(() => ({ read: vi.fn(), submit: vi.fn() }));
vi.mock("../data/athleteClaimConsent", () => ({ getAthleteClaimReview: calls.read, submitAthleteClaimConsent: calls.submit }));
const fixture = claimFixture();
const request = vi.fn(async ({ method }: { method: string; params?: unknown[] }): Promise<unknown> => {
  if (method === "eth_accounts" || method === "eth_requestAccounts") return [claimSigner.address];
  if (method === "eth_chainId") return "0x7a69";
  if (method === "eth_signTypedData_v4") return claimSigner.signTypedData(fixture.signing);
  throw new Error("unexpected method");
});
const listeners = new Map<string, (...args: unknown[]) => void>();
const provider: RewardWalletProvider = { request, on: (event, cb) => { listeners.set(event, cb); }, removeListener: event => { listeners.delete(event); } };
function mount(locale: "en" | "hr" = "en", onRecorded = vi.fn(), onAccessLost = vi.fn()) {
  return render(<I18nProvider initialLocale={locale}><RewardClaimReview history={fixture.history} onRecorded={onRecorded} onAccessLost={onAccessLost} onClose={vi.fn()} /></I18nProvider>);
}
beforeEach(() => {
  calls.read.mockReset().mockResolvedValue(decodeAthleteClaimReview(fixture.raw, fixture.history));
  calls.submit.mockReset().mockResolvedValue(fixture.receipt); request.mockClear(); listeners.clear();
  Object.defineProperty(window, "ethereum", { configurable: true, value: provider });
});
describe("athlete reward consent UI", () => {
  it.each(["en", "hr"] as const)("requires an explicit wallet and checkbox, then shows consent rather than payment in %s", async locale => {
    const recorded = vi.fn(); mount(locale, recorded);
    await screen.findByText(fixture.history.recipientAddress);
    expect(request).not.toHaveBeenCalled();
    expect(screen.getByRole("region")).toHaveFocus();
    fireEvent.click(await screen.findByRole("button", { name: locale === "en" ? "Advanced · external wallet" : "Napredno · vanjski novčanik" })); fireEvent.click(screen.getByRole("button", { name: locale === "en" ? "Browser wallet" : "Novčanik preglednika" }));
    const sign = await screen.findByRole("button", { name: locale === "en" ? "Sign reward consent" : "Potpiši suglasnost za nagradu" });
    expect(sign).toBeDisabled(); expect(calls.submit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(sign);
    expect(await screen.findByRole("status")).toHaveTextContent(locale === "en" ? "Your consent is recorded" : "Tvoja suglasnost je zabilježena");
    expect(screen.getByRole("status")).toHaveTextContent(locale === "en" ? "does not queue or send a payment" : "ne stavlja isplatu u red čekanja niti je šalje");
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument(); expect(recorded).toHaveBeenCalledOnce();
    expect(listeners.size).toBe(0);
  });
  it("reports uncertainty and retries the same signature/key without a second wallet prompt", async () => {
    calls.submit.mockRejectedValueOnce(new Error("private raw SQL")); mount();
    fireEvent.click(await screen.findByRole("button", { name: "Advanced · external wallet" })); fireEvent.click(await screen.findByRole("button", { name: "Browser wallet" }));
    fireEvent.click(await screen.findByRole("checkbox")); fireEvent.click(screen.getByRole("button", { name: "Sign reward consent" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("consent may have been saved");
    expect(screen.queryByText("private raw SQL")).not.toBeInTheDocument(); expect(screen.queryByRole("status")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sign reward consent" })); await screen.findByRole("status");
    expect(calls.submit.mock.calls[0]).toEqual(calls.submit.mock.calls[1]);
    expect(request.mock.calls.filter(([r]) => r.method === "eth_signTypedData_v4")).toHaveLength(1);
  });
  it("renders recorded history after reload without a wallet prompt or consent control", async () => {
    calls.read.mockResolvedValue(decodeAthleteClaimReview(fixture.recorded, fixture.history)); mount();
    await screen.findByRole("status"); expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Browser wallet" })).not.toBeInTheDocument(); expect(request).not.toHaveBeenCalled();
  });
  it("shows safe holds and handles lost authorization without showing an old signing payload", async () => {
    for (const status of [409, 401]) {
      calls.read.mockRejectedValue({ status, code: "reward_claim_readiness_required", message: "private identity evidence" });
      const lost = vi.fn(), view = mount("en", vi.fn(), lost);
      await screen.findByRole("alert"); expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
      expect(screen.queryByText("private identity evidence")).not.toBeInTheDocument();
      expect(lost).toHaveBeenCalledTimes(status === 401 ? 1 : 0); view.unmount();
    }
  });
  it("ignores a late review after unmount and cleans wallet subscriptions", async () => {
    let finish!: (value: unknown) => void; calls.read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const view = mount(); await waitFor(() => expect(finish).toBeTypeOf("function")); view.unmount();
    await act(async () => finish(decodeAthleteClaimReview(fixture.raw, fixture.history)));
    expect(request).not.toHaveBeenCalled(); expect(calls.submit).not.toHaveBeenCalled();
  });
  it("keeps renewals as separate history records, never totals them as earned balances", async () => {
    const next = { ...fixture.history, intentId: "79000000-0000-4000-8000-000000000007" };
    render(<I18nProvider initialLocale="en"><RewardClaimHistory items={[fixture.history, next]} pending={false} refreshing={false}
      hasMore={false} onRefresh={vi.fn()} onMore={vi.fn()} onAccessLost={vi.fn()} /></I18nProvider>);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText(/Renewed claims for the same allocation must not be added together/)).toBeVisible();
    expect(screen.queryByText(/2\.000000000000000002/)).not.toBeInTheDocument();
    expect(calls.read).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getAllByRole("listitem")[0]).getByRole("button", { name: "Review reward consent" }));
    expect(await screen.findByRole("region", { name: "Review reward consent" })).toBeVisible();
  });
});
