import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { I18nProvider } from "@/shared/i18n/I18nProvider";
import RewardDestinationChoice from "./RewardDestinationChoice";
import RewardDestinationHistory from "./RewardDestinationHistory";
import type { PreparedWalletProof } from "../data/browserWallet";
import type { RewardDestination } from "../model/athleteDestinations";
const calls = vi.hoisted(() => ({ submit: vi.fn(), withdraw: vi.fn() }));
vi.mock("../data/athleteDestinations", () => ({ submitRewardDestination: calls.submit, withdrawRewardDestination: calls.withdraw }));
const id = (n: number) => `79000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const request: RewardDestination = { requestId: id(1), athleteProfileId: id(2), address: `0x${"ab".repeat(20)}`, chainId: 31337,
  requestedAt: "2026-09-08T08:00:00Z", withdrawnAt: null, status: "pending_review" };
function prepared(): PreparedWalletProof {
  return { challenge: { challengeId: id(3), address: request.address, chainId: 31337, message: "fixture", expiresAt: "2026-09-08T08:10:00Z", alreadyVerified: true },
    assertCurrent: vi.fn().mockResolvedValue(undefined), confirm: vi.fn(), dispose: vi.fn() };
}
const mount = (ui: ReactNode, locale: "en" | "hr" = "en") => render(<I18nProvider initialLocale={locale}><MemoryRouter>{ui}</MemoryRouter></I18nProvider>);
const history = (onRefresh = vi.fn()) => <RewardDestinationHistory items={[request]} pending={false} error={null} refreshing={false} hasMore={false} onRefresh={onRefresh} onMore={vi.fn()} />;
beforeEach(() => {
  calls.submit.mockReset().mockResolvedValue(request);
  calls.withdraw.mockReset().mockResolvedValue({ ...request, status: "withdrawn", withdrawnAt: "2026-09-08T08:01:00Z" });
});
describe("athlete destination interaction", () => {
  it.each(["en", "hr"] as const)("requires explicit choice and reports pending review, not payment, in %s", async locale => {
    const proof = prepared(); const saved = vi.fn();
    mount(<RewardDestinationChoice prepared={proof} athleteProfileId={id(2)} onSaved={saved} />, locale);
    const button = screen.getByRole("button", { name: locale === "en" ? "Save wallet" : "Spremi novčanik" });
    expect(button).toBeDisabled(); expect(calls.submit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(button);
    expect(await screen.findByText(locale === "en" ? /Review is still required/ : /Pregled je još potreban/)).toHaveAttribute("role", "status");
    expect(proof.assertCurrent).toHaveBeenCalledOnce(); expect(proof.confirm).not.toHaveBeenCalled();
    expect(calls.submit).toHaveBeenCalledWith(proof.challenge, id(2), expect.any(String)); expect(saved).toHaveBeenCalledOnce();
  });
  it("retries uncertain submissions with the original key and never fabricates a saved state", async () => {
    calls.submit.mockRejectedValueOnce(new Error("raw private detail"));
    mount(<RewardDestinationChoice prepared={prepared()} athleteProfileId={id(2)} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(screen.getByRole("button", { name: "Save wallet" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("may already have been saved");
    expect(screen.queryByText("raw private detail")).not.toBeInTheDocument(); expect(screen.queryByRole("status")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save wallet" })); await screen.findByRole("status");
    expect(calls.submit.mock.calls[0][2]).toBe(calls.submit.mock.calls[1][2]);
  });
  it("does not submit after leaving during wallet checks or notify a new screen after a late response", async () => {
    const proof = prepared(); let finishCheck!: () => void;
    proof.assertCurrent = () => new Promise(resolve => { finishCheck = resolve; });
    const saved = vi.fn(); const view = mount(<RewardDestinationChoice prepared={proof} athleteProfileId={id(2)} onSaved={saved} />);
    fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(screen.getByRole("button")); view.unmount();
    await act(async () => finishCheck()); expect(calls.submit).not.toHaveBeenCalled();
    let finishPost!: (value: RewardDestination) => void; calls.submit.mockImplementationOnce(() => new Promise(resolve => { finishPost = resolve; }));
    const next = mount(<RewardDestinationChoice prepared={prepared()} athleteProfileId={id(2)} onSaved={saved} />);
    fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(calls.submit).toHaveBeenCalledOnce()); next.unmount();
    await act(async () => finishPost(request)); expect(saved).not.toHaveBeenCalled();
  });
  it("keeps missing profiles in the existing profile-ownership workflow", () => {
    mount(<RewardDestinationChoice prepared={prepared()} athleteProfileId={null} onSaved={vi.fn()} />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/athlete/account?view=edit#athlete-race-history");
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument(); expect(calls.submit).not.toHaveBeenCalled();
  });
  it.each(["en", "hr"] as const)("asks before withdrawal, supports cancellation and preserves allocations in %s", async locale => {
    const refresh = vi.fn(); mount(history(refresh), locale);
    const label = locale === "en" ? "Withdraw destination request" : "Povuci zahtjev za adresu";
    fireEvent.click(screen.getByRole("button", { name: label })); expect(calls.withdraw).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: locale === "en" ? "Keep request" : "Zadrži zahtjev" })); expect(calls.withdraw).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: label }));
    fireEvent.click(screen.getByRole("button", { name: locale === "en" ? "Confirm request withdrawal" : "Potvrdi povlačenje zahtjeva" }));
    expect(await screen.findByRole("heading", { name: locale === "en" ? "Request withdrawn" : "Zahtjev povučen" })).toBeVisible();
    expect(screen.getByText(locale === "en" ? /Your earned allocations remain reserved/ : /Tvoje zarađene nagrade ostaju rezervirane/)).toBeVisible();
    expect(calls.withdraw).toHaveBeenCalledWith(id(1)); expect(refresh).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: label })).not.toBeInTheDocument();
  });
  it("leaves an uncertain withdrawal visibly unconfirmed and allows an idempotent retry", async () => {
    calls.withdraw.mockRejectedValueOnce({ status: 503, message: "raw SQL" }); mount(history());
    fireEvent.click(screen.getByRole("button", { name: "Withdraw destination request" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm request withdrawal" }));
    await screen.findByRole("alert"); expect(screen.getByRole("heading", { name: "Awaiting review" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Request withdrawn" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm request withdrawal" }));
    await screen.findByRole("heading", { name: "Request withdrawn" });
    expect(calls.withdraw.mock.calls).toEqual([[id(1)], [id(1)]]);
  });
});
