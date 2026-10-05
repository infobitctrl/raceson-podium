import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/shared/i18n/I18nProvider";
import ClubRewardLedger from "./ClubRewardLedger";
import { clubLedgerFixture } from "../model/clubLedgerFixtures.test-helper";
const c = vi.hoisted(() => ({ awards: vi.fn(), claims: vi.fn(), payment: vi.fn(), wallet: vi.fn(), lost: vi.fn() }));
vi.mock("../data/clubPortal", () => ({ getClubAwards: c.awards, getClubClaims: c.claims, getClubPaymentStatus: c.payment }));
beforeEach(() => { const f = clubLedgerFixture(); c.awards.mockReset().mockResolvedValue(f.awards); c.claims.mockReset().mockResolvedValue(f.claims);
  c.payment.mockReset().mockResolvedValue(f.payment); c.wallet.mockReset(); c.lost.mockReset();
  Object.defineProperty(window, "ethereum", { configurable: true, value: { request: c.wallet } }); });
function mount(locale: "en" | "hr" = "en", clubs = clubLedgerFixture().clubs) {
  return render(<I18nProvider initialLocale={locale}><ClubRewardLedger clubs={clubs} onAccessLost={c.lost} /></I18nProvider>);
}
describe("club allocation and payment ledger", () => {
  it.each(["en", "hr"] as const)("separates allocated shares from an explicitly inspected two-event receipt in %s", async locale => {
    const f = clubLedgerFixture(); mount(locale); await screen.findByRole("button", { name: locale === "en" ? "Payment status" : "Status isplate" });
    expect(c.awards).not.toHaveBeenCalled(); expect(c.payment).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: f.award.clubId } });
    await screen.findByText(locale === "en" ? "Race club-performance reward" : "Nagrada za klupski rezultat na utrci");
    expect(screen.getByText(locale === "en" ? "League · rounds 1–5" : "Liga · kola 1–5")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: locale === "en" ? "Payment status" : "Status isplate" }));
    await screen.findByText(locale === "en" ? "Test payment receipt recorded" : "Potvrda testne isplate je zabilježena");
    expect(screen.getByText(f.payment.receipt!.transactionHash)).toBeVisible();
    fireEvent.click(screen.getByText(locale === "en" ? "Recorded block details" : "Zabilježeni podaci o blokovima")); expect(screen.getByText("0 → 1")).toBeVisible();
    expect(c.wallet).not.toHaveBeenCalled(); expect(c.payment).toHaveBeenCalledOnce();
  });
  it("keeps original-nominee history visible without current club ownership", async () => {
    mount("en", []); await screen.findByRole("button", { name: "Payment status" });
    expect(screen.getByRole("combobox").children).toHaveLength(1); expect(c.awards).not.toHaveBeenCalled();
  });
  it("shows uncertainty without an old receipt after a failed refresh", async () => {
    const f = clubLedgerFixture(); c.payment.mockResolvedValueOnce(f.payment).mockRejectedValue({ status: 503 }); mount();
    fireEvent.click(await screen.findByRole("button", { name: "Payment status" })); await screen.findByText(f.payment.receipt!.transactionHash);
    fireEvent.click(screen.getByRole("button", { name: "Refresh payment status" })); await screen.findByRole("alert");
    expect(screen.queryByText(f.payment.receipt!.transactionHash)).not.toBeInTheDocument(); expect(c.wallet).not.toHaveBeenCalled();
  });
  it("does not present submission uncertainty as confirmed or trigger a replacement", async () => {
    c.payment.mockResolvedValue({ ...clubLedgerFixture().payment, status: "submission_unconfirmed", receipt: null }); mount();
    fireEvent.click(await screen.findByRole("button", { name: "Payment status" })); await screen.findByText("Possible submission · confirmation pending");
    expect(screen.queryByText("Test payment receipt recorded")).not.toBeInTheDocument(); expect(c.payment).toHaveBeenCalledOnce(); expect(c.wallet).not.toHaveBeenCalled();
  });
  it("clears private selection across unmount and ignores late payment responses", async () => {
    let resolve!: (v: unknown) => void; c.payment.mockImplementation(() => new Promise(r => { resolve = r; }));
    const view = mount(); fireEvent.click(await screen.findByRole("button", { name: "Payment status" }));
    view.unmount(); const f = clubLedgerFixture(); await act(async () => resolve(f.payment));
    expect(screen.queryByText(f.payment.receipt!.transactionHash)).not.toBeInTheDocument();
  });
  it("escalates lost access and removes stale award data when refresh fails", async () => {
    const f = clubLedgerFixture(); c.awards.mockResolvedValueOnce(f.awards).mockRejectedValue({ status: 403 }); mount();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: f.award.clubId } }); await screen.findByText("Race club-performance reward");
    fireEvent.click(screen.getByRole("button", { name: "Refresh club allocations" })); await screen.findByRole("alert");
    expect(screen.queryByText("Race club-performance reward")).not.toBeInTheDocument(); expect(c.lost).toHaveBeenCalledWith({ status: 403 });
  });
});
