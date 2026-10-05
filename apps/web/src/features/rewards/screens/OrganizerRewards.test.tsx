import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/shared/i18n/I18nProvider";
import OrganizerRewards from "./OrganizerRewards";
import { organizerFixture, organizerId as id } from "../model/organizerFixtures.test-helper";
const c = vi.hoisted(() => ({ enabled: true, userId: "operator", accountId: "operator", session: { epoch: 1 } as { epoch: number } | null,
  getProgrammes: vi.fn(), getDestinations: vi.fn(), getReadiness: vi.fn(), record: vi.fn(), revoke: vi.fn(), wallet: vi.fn() }));
vi.mock("@/lib/public-env", () => ({ publicEnv: { get rewardPortalEnabled() { return c.enabled; }, rewardDemo: { mode: "local" } } }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: c.userId }, account: { userId: c.accountId, hasAthleteAccess: false }, session: c.session, isLoading: false }) }));
vi.mock("../data/organizerRewards", () => ({ getOrganizerProgrammes: c.getProgrammes, getOrganizerDestinations: c.getDestinations,
  getOrganizerReadiness: c.getReadiness, recordOrganizerReview: c.record, revokeOrganizerReview: c.revoke }));
function mount(locale: "en" | "hr" = "en") {
  const tree = () => <I18nProvider initialLocale={locale}><MemoryRouter><OrganizerRewards /></MemoryRouter></I18nProvider>;
  const view = render(tree()); return { ...view, update: () => view.rerender(tree()) };
}
async function open(locale: "en" | "hr" = "en") {
  fireEvent.click(await screen.findByRole("button", { name: locale === "en" ? "Open programme" : "Otvori program" }));
  fireEvent.click(await screen.findByRole("button", { name: locale === "en" ? "Review request" : "Pregledaj zahtjev" }));
  await screen.findByText(locale === "en" ? "No readiness review recorded" : "Pregled spremnosti nije evidentiran");
}
function fill(locale: "en" | "hr" = "en") {
  fireEvent.change(screen.getByLabelText(locale === "en" ? "Independently verified date of birth" : "Neovisno provjeren datum rođenja"), { target: { value: "1990-01-01" } });
  const names = locale === "en" ? ["Identity audit reference (UUID)", "Adulthood audit reference (UUID)", "Wallet MFA audit reference (UUID)", "Wallet recovery audit reference (UUID)"]
    : ["Oznaka provjere identiteta (UUID)", "Oznaka provjere punoljetnosti (UUID)", "Oznaka provjere MFA novčanika (UUID)", "Oznaka provjere oporavka novčanika (UUID)"];
  names.forEach((name, i) => fireEvent.change(screen.getByLabelText(name), { target: { value: id(10 + i) } }));
  fireEvent.click(screen.getByRole("checkbox", { name: locale === "en" ? /I have verified this athlete/ : /Provjerio\/la sam identitet/ }));
}
beforeEach(() => {
  const f = organizerFixture(); c.enabled = true; c.userId = "operator"; c.accountId = "operator"; c.session = { epoch: 1 };
  c.getProgrammes.mockReset().mockResolvedValue(f.programmes); c.getDestinations.mockReset().mockResolvedValue(f.destinations);
  c.getReadiness.mockReset().mockResolvedValue(f.context); c.record.mockReset().mockResolvedValue(f.review);
  c.revoke.mockReset().mockResolvedValue({ ...f.review, revokedAt: "2026-09-08T09:00:02Z", revocationReason: "operator_correction" }); c.wallet.mockReset();
  Object.defineProperty(window, "ethereum", { configurable: true, value: { request: c.wallet } });
});
describe("independent organizer reward workflow", () => {
  it.each(["en", "hr"] as const)("requires an explicit, complete operator review in %s without wallet calls or payment claims", async locale => {
    mount(locale); await screen.findByText("Synthetic Šibenik Trail League");
    expect(c.getDestinations).not.toHaveBeenCalled(); expect(c.getReadiness).not.toHaveBeenCalled();
    expect(screen.getByText(locale === "en" ? /100\.000000000000000001/ : /100,000000000000000001/)).toBeVisible();
    await open(locale); const record = screen.getByRole("button", { name: locale === "en" ? "Record readiness review" : "Evidentiraj pregled spremnosti" });
    expect(record).toBeDisabled(); expect(c.record).not.toHaveBeenCalled();
    expect(screen.getByLabelText(locale === "en" ? "Independently verified date of birth" : "Neovisno provjeren datum rođenja")).toHaveValue("");
    fill(locale); expect(record).toBeEnabled(); fireEvent.click(record);
    expect(await screen.findByRole("heading", { name: locale === "en" ? "Readiness review recorded" : "Pregled spremnosti evidentiran" })).toBeVisible();
    expect(c.record).toHaveBeenCalledOnce(); expect(c.record.mock.calls[0][1]).toMatchObject({ expectedRevision: 0, expectedProfileFingerprintSha256: "a".repeat(64) });
    expect(c.wallet).not.toHaveBeenCalled(); expect(c.revoke).not.toHaveBeenCalled();
  });
  it("keeps the original idempotency key and full decision after an uncertain write, then reloads before a new decision", async () => {
    const f = organizerFixture(); c.record.mockRejectedValueOnce({ status: 503, message: "private service secret" });
    mount(); await open(); fill(); fireEvent.click(screen.getByRole("button", { name: "Record readiness review" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("may have been recorded");
    expect(screen.queryByText("private service secret")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry the same decision" }));
    await screen.findByRole("heading", { name: "Readiness review recorded" });
    expect(c.record.mock.calls[1]).toEqual(c.record.mock.calls[0]);
    c.getReadiness.mockResolvedValue({ ...f.context, reviewState: "reviewed", latestReview: f.review });
    fireEvent.click(screen.getByRole("button", { name: "Reload review" }));
    await screen.findByText("Readiness review recorded — not payment approval");
    expect(screen.getByRole("button", { name: "Record readiness review" })).toBeDisabled();
    expect(screen.getByLabelText("Identity audit reference (UUID)")).toHaveValue("");
  });
  it("revokes only the selected latest review with an explicit reason and confirmation", async () => {
    const f = organizerFixture(); c.getReadiness.mockResolvedValue({ ...f.context, reviewState: "reviewed", latestReview: f.review });
    mount(); fireEvent.click(await screen.findByRole("button", { name: "Open programme" }));
    fireEvent.click(await screen.findByRole("button", { name: "Review request" }));
    const revoke = await screen.findByRole("button", { name: "Revoke review" }); expect(revoke).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Reason for revocation"), { target: { value: "operator_correction" } });
    expect(revoke).toBeDisabled(); fireEvent.click(screen.getByRole("checkbox", { name: /I want to revoke this exact/ }));
    fireEvent.click(revoke); await screen.findByRole("heading", { name: "Review revocation recorded" });
    expect(c.revoke).toHaveBeenCalledExactlyOnceWith(f.selection, f.review.reviewId, "operator_correction"); expect(c.record).not.toHaveBeenCalled();
  });
  it.each(["age_hold", "identity_hold", "request_withdrawn"])("preserves %s without rendering a review-approval form", async reviewState => {
    const f = organizerFixture(); c.getReadiness.mockResolvedValue({ ...f.context, reviewState }); mount();
    fireEvent.click(await screen.findByRole("button", { name: "Open programme" })); fireEvent.click(await screen.findByRole("button", { name: "Review request" }));
    await screen.findByText(/A payout hold remains/); expect(screen.queryByRole("button", { name: "Record readiness review" })).not.toBeInTheDocument();
    expect(c.record).not.toHaveBeenCalled(); expect(c.wallet).not.toHaveBeenCalled();
  });
  it("does not fetch while disabled, without a session or with mismatched account identity", () => {
    c.enabled = false; const view = mount(); expect(c.getProgrammes).not.toHaveBeenCalled();
    c.enabled = true; c.session = null; view.update(); expect(c.getProgrammes).not.toHaveBeenCalled();
    c.session = { epoch: 2 }; c.accountId = "other"; view.update(); expect(c.getProgrammes).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/auth?next=%2Forganizer%2Frewards");
  });
  it("removes private detail and pending evidence on same-account session replacement, ignoring a late write", async () => {
    let finish!: (value: unknown) => void; c.record.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const view = mount(); await open(); fill(); fireEvent.click(screen.getByRole("button", { name: "Record readiness review" }));
    await waitFor(() => expect(finish).toBeTypeOf("function")); c.session = { epoch: 2 };
    c.getProgrammes.mockResolvedValue({ chainId: 31337, items: [], nextCursor: null }); view.update();
    expect(screen.queryByText("Synthetic Runner")).not.toBeInTheDocument();
    await act(async () => finish(organizerFixture().review));
    expect(screen.queryByRole("heading", { name: "Readiness review recorded" })).not.toBeInTheDocument();
    await screen.findByText(/No programmes are available/); expect(c.record).toHaveBeenCalledOnce();
  });
  it.each([401, 403])("hides every private view after an explicit read returns %s", async status => {
    mount(); await open(); c.getReadiness.mockRejectedValue({ status, message: "private raw detail" });
    fireEvent.click(screen.getByRole("button", { name: "Reload review" }));
    await screen.findByRole("button", { name: "Check access again" });
    expect(screen.queryByText("Synthetic Runner")).not.toBeInTheDocument(); expect(screen.queryByText(organizerFixture().selection.address)).not.toBeInTheDocument();
    expect(screen.queryByText("1990-01-01")).not.toBeInTheDocument(); expect(screen.queryByText("private raw detail")).not.toBeInTheDocument();
  });
  it("clears DOB and the form during failed refresh and makes no automatic approval or retry", async () => {
    mount(); await open(); let fail!: (reason: unknown) => void;
    c.getReadiness.mockImplementation(() => new Promise((_, reject) => { fail = reject; }));
    fireEvent.click(screen.getByRole("button", { name: "Reload review" }));
    expect(screen.queryByText("1990-01-01")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Record readiness review" })).not.toBeInTheDocument();
    await act(async () => fail({ status: 503 })); await screen.findByRole("alert");
    expect(c.record).not.toHaveBeenCalled(); expect(c.getReadiness).toHaveBeenCalledTimes(2);
  });
});
