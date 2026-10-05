import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/shared/i18n/I18nProvider";
import RewardClaimPayment from "./RewardClaimPayment";
import RewardClaimHistory from "./RewardClaimHistory";
import { paymentFixture } from "../model/paymentFixtures.test-helper";
const calls = vi.hoisted(() => ({ read: vi.fn(), wallet: vi.fn() }));
vi.mock("../data/athletePaymentStatus", () => ({ getAthletePaymentStatus: calls.read }));
const fixture = paymentFixture();
const mount = (locale: "en" | "hr" = "en", onAccessLost = vi.fn(), onClose = vi.fn()) =>
  render(<I18nProvider initialLocale={locale}><RewardClaimPayment history={fixture.history} onAccessLost={onAccessLost} onClose={onClose} /></I18nProvider>);
beforeEach(() => {
  calls.read.mockReset().mockResolvedValue(fixture.payment); calls.wallet.mockReset();
  Object.defineProperty(window, "ethereum", { configurable: true, value: { request: calls.wallet } });
});
describe("athlete payment receipt UI", () => {
  it.each(["en", "hr"] as const)("displays exact receipt, destination and expandable evidence in %s without wallet access", async locale => {
    const close = vi.fn(); mount(locale, vi.fn(), close);
    expect(await screen.findByText(fixture.payment.receipt!.transactionHash)).toBeVisible();
    expect(screen.getByRole("region")).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent(locale === "en" ? "Test payment receipt recorded" : "Potvrda testne isplate je zabilježena");
    expect(screen.getByText(locale === "en" ? /1\.000000000000000001/ : /1,000000000000000001/)).toBeVisible();
    expect(screen.getByText(fixture.history.recipientAddress)).toBeVisible();
    fireEvent.click(screen.getByText(locale === "en" ? "Recorded block details" : "Zabilježeni podaci o blokovima"));
    expect(screen.getAllByText(`100 · ${fixture.payment.receipt!.blockHash}`)[0]).toBeVisible();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument(); expect(calls.wallet).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: locale === "en" ? "Close review" : "Zatvori pregled" })); expect(close).toHaveBeenCalledOnce();
  });
  it("requires explicit payment entry from history and does not fetch status for every list item", async () => {
    render(<I18nProvider initialLocale="en"><RewardClaimHistory items={[fixture.history]} pending={false} refreshing={false}
      hasMore={false} onMore={vi.fn()} onRefresh={vi.fn()} onAccessLost={vi.fn()} /></I18nProvider>);
    expect(calls.read).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole("listitem")).getByRole("button", { name: "Payment status" }));
    expect(await screen.findByText(fixture.payment.receipt!.transactionHash)).toBeVisible(); expect(calls.read).toHaveBeenCalledOnce();
    expect(calls.wallet).not.toHaveBeenCalled(); expect(screen.queryByRole("region", { name: "Review reward consent" })).not.toBeInTheDocument();
  });
  it("refreshes an uncertain submission into a recorded receipt without a payment or signature action", async () => {
    calls.read.mockResolvedValueOnce({ ...fixture.payment, status: "submission_unconfirmed", receipt: null }); mount();
    expect(await screen.findByText("Possible submission · confirmation pending")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("does not prove that payment failed");
    expect(screen.queryByText(fixture.payment.receipt!.transactionHash)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Refresh payment status" }));
    expect(await screen.findByText(fixture.payment.receipt!.transactionHash)).toBeVisible(); expect(calls.read).toHaveBeenCalledTimes(2);
    expect(calls.wallet).not.toHaveBeenCalled();
  });
  it("hides a previous receipt while refresh is pending or fails, then allows an explicit read retry", async () => {
    mount(); await screen.findByText(fixture.payment.receipt!.transactionHash);
    let fail!: (error: unknown) => void; calls.read.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
    fireEvent.click(screen.getByRole("button", { name: "Refresh payment status" }));
    expect(screen.queryByText(fixture.payment.receipt!.transactionHash)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh payment status" })).toBeDisabled();
    await act(async () => fail({ status: 503, message: "private database failure" }));
    expect(screen.getByRole("alert")).toHaveTextContent("no earlier receipt is shown");
    expect(screen.queryByText("private database failure")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Refresh payment status" }));
    await screen.findByText(fixture.payment.receipt!.transactionHash); expect(calls.wallet).not.toHaveBeenCalled();
  });
  it("reports revoked authorization to the parent and ignores a late read after the view is closed", async () => {
    const lost = vi.fn(); calls.read.mockRejectedValueOnce({ status: 401 }); const first = mount("en", lost);
    expect(await screen.findByRole("alert")).toHaveTextContent("Sign in again"); expect(lost).toHaveBeenCalledOnce(); first.unmount();
    let finish!: (value: unknown) => void; calls.read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const view = mount(); await waitFor(() => expect(finish).toBeTypeOf("function")); view.unmount();
    await act(async () => finish(fixture.payment)); expect(screen.queryByText(fixture.payment.receipt!.transactionHash)).not.toBeInTheDocument();
    expect(calls.wallet).not.toHaveBeenCalled();
  });
});
