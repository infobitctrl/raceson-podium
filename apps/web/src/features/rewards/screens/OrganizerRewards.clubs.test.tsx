import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/shared/i18n/I18nProvider";
import OrganizerRewards from "./OrganizerRewards";
import { organizerClubFixture } from "../model/organizerClubFixtures.test-helper";
import { clubAddress, clubId } from "../model/clubFixtures.test-helper";
const c = vi.hoisted(() => ({ session: { epoch: 1 } as { epoch: number } | null, programmes: vi.fn(), clubs: vi.fn(),
  context: vi.fn(), observe: vi.fn(), record: vi.fn(), revoke: vi.fn(), wallet: vi.fn() }));
vi.mock("@/lib/public-env", () => ({ publicEnv: { rewardPortalEnabled: true, rewardDemo: { mode: "local" } } }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "operator" }, account: { userId: "operator", hasAthleteAccess: false }, session: c.session, isLoading: false }) }));
vi.mock("../data/organizerRewards", () => ({ getOrganizerProgrammes: c.programmes, getOrganizerDestinations: vi.fn() }));
vi.mock("../data/organizerClubs", () => ({ getOperatorClubRequests: c.clubs, getOperatorClubContext: c.context,
  observeOperatorClub: c.observe, recordOperatorClub: c.record, revokeOperatorClub: c.revoke }));
type Locale = "en" | "hr";
function mount(locale: Locale = "en") {
  const tree = () => <I18nProvider initialLocale={locale}><MemoryRouter><OrganizerRewards /></MemoryRouter></I18nProvider>;
  const view = render(tree()); return { ...view, update: () => view.rerender(tree()) };
}
async function open(locale: Locale = "en") {
  fireEvent.click(await screen.findByRole("button", { name: locale === "en" ? "Review club treasuries" : "Pregledaj klupske novčanike" }));
  fireEvent.click(await screen.findByRole("button", { name: locale === "en" ? "Review request" : "Pregledaj zahtjev" }));
  await screen.findByText("Synthetic club owner", { exact: false });
}
async function observe(locale: Locale = "en") {
  const f = organizerClubFixture();
  fireEvent.change(screen.getByLabelText(locale === "en" ? "Original Safe factory address" : "Adresa izvornog Safe tvorničkog ugovora"), { target: { value: f.observeInput.factoryAddress } });
  fireEvent.change(screen.getByLabelText(locale === "en" ? "Safe creation transaction hash" : "Hash transakcije stvaranja Safe novčanika"), { target: { value: f.observeInput.deploymentTransactionHash } });
  fireEvent.click(screen.getByRole("button", { name: locale === "en" ? "Check treasury on chain" : "Provjeri novčanik na lancu" }));
  await screen.findByRole("heading", { name: locale === "en" ? "2. Complete the human review" : "2. Dovrši neovisni pregled" });
}
function fill(locale: Locale = "en") {
  const labels = locale === "en" ? ["Club authority audit reference (UUID)", "Independent key-control audit reference (UUID)", "Club wallet recovery audit reference (UUID)", "Wallet execution-history audit reference (UUID)"]
    : ["Oznaka provjere klupskih ovlasti (UUID)", "Oznaka provjere neovisne kontrole ključeva (UUID)", "Oznaka provjere oporavka klupskog novčanika (UUID)", "Oznaka provjere povijesti izvršavanja novčanika (UUID)"];
  labels.forEach((label, i) => fireEvent.change(screen.getByLabelText(label), { target: { value: clubId(40 + i) } }));
  fireEvent.click(screen.getByRole("checkbox", { name: locale === "en" ? /I have independently reviewed/ : /Neovisno sam pregledao/ }));
}
beforeEach(() => {
  const f = organizerClubFixture(); c.session = { epoch: 1 };
  c.programmes.mockReset().mockResolvedValue(f.programmes); c.clubs.mockReset().mockResolvedValue(f.page);
  c.context.mockReset().mockResolvedValue(f.context); c.observe.mockReset().mockResolvedValue(f.preview);
  c.record.mockReset().mockResolvedValue(f.review); c.revoke.mockReset().mockResolvedValue({ ...f.review, revokedAt: "2026-09-09T01:03:00Z", revocationReason: "operator_correction" });
  c.wallet.mockReset(); Object.defineProperty(window, "ethereum", { configurable: true, value: { request: c.wallet } });
});
describe("organizer club treasury review journey", () => {
  it.each(["en", "hr"] as const)("requires separate chain inspection and explicit human evidence in %s, without wallet or payment calls", async locale => {
    const f = organizerClubFixture(); mount(locale); await screen.findByText("Synthetic Šibenik Trail League");
    expect(c.clubs).not.toHaveBeenCalled(); expect(c.context).not.toHaveBeenCalled(); expect(c.observe).not.toHaveBeenCalled();
    await open(locale); expect(c.clubs).toHaveBeenCalledWith(f.selection.programmeId, 31337, null);
    expect(c.context).toHaveBeenCalledExactlyOnceWith(f.selection); expect(c.observe).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: locale === "en" ? "Check treasury on chain" : "Provjeri novčanik na lancu" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: locale === "en" ? "Record club treasury review" : "Evidentiraj pregled klupskog novčanika" })).not.toBeInTheDocument();
    await observe(locale); expect(c.observe).toHaveBeenCalledExactlyOnceWith(f.selection, f.observeInput);
    const record = screen.getByRole("button", { name: locale === "en" ? "Record club treasury review" : "Evidentiraj pregled klupskog novčanika" });
    expect(record).toBeDisabled(); expect(c.record).not.toHaveBeenCalled();
    fill(locale); expect(record).toBeEnabled(); fireEvent.click(record);
    await screen.findByRole("heading", { name: locale === "en" ? "Club treasury review recorded" : "Pregled klupskog novčanika evidentiran" });
    expect(c.record).toHaveBeenCalledOnce(); expect(c.record.mock.calls[0][0]).toEqual(f.selection);
    expect(c.record.mock.calls[0][1]).toEqual({ ...f.input, idempotencyKey: expect.any(String) });
    expect(c.wallet).not.toHaveBeenCalled(); expect(c.revoke).not.toHaveBeenCalled();
  });
  it("invalidates the exact preview and human attestation when the factory or transaction changes", async () => {
    mount(); await open(); await observe(); fill();
    fireEvent.change(screen.getByLabelText("Original Safe factory address"), { target: { value: clubAddress(99) } });
    expect(screen.queryByRole("button", { name: "Record club treasury review" })).not.toBeInTheDocument();
    expect(c.observe).toHaveBeenCalledOnce(); expect(c.record).not.toHaveBeenCalled();
    await observe(); expect(screen.getByLabelText("Club authority audit reference (UUID)")).toHaveValue("");
    expect(screen.getByRole("checkbox", { name: /I have independently reviewed/ })).not.toBeChecked();
    fireEvent.change(screen.getByLabelText("Safe creation transaction hash"), { target: { value: "" } });
    expect(screen.queryByRole("button", { name: "Record club treasury review" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check treasury on chain" })).toBeDisabled();
  });
  it("retries only the exact uncertain review, without new chain IO or a new decision key", async () => {
    c.record.mockRejectedValueOnce({ status: 503, message: "private service detail" }); mount(); await open(); await observe(); fill();
    fireEvent.click(screen.getByRole("button", { name: "Record club treasury review" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("may have been recorded");
    expect(screen.queryByText("private service detail")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Club authority audit reference (UUID)")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry the same decision" }));
    await screen.findByRole("heading", { name: "Club treasury review recorded" });
    expect(c.record.mock.calls[1]).toEqual(c.record.mock.calls[0]); expect(c.observe).toHaveBeenCalledOnce();
    const f = organizerClubFixture(); c.context.mockResolvedValue({ ...f.context, reviewState: "reviewed", latestReview: f.review });
    fireEvent.click(screen.getByRole("button", { name: "Reload review" }));
    await screen.findByText("Treasury review recorded — not payment approval");
    expect(screen.getByLabelText("Original Safe factory address")).toHaveValue("");
    expect(screen.queryByLabelText("Club authority audit reference (UUID)")).not.toBeInTheDocument();
  });
  it("revokes only the selected latest review after a reason and explicit confirmation", async () => {
    const f = organizerClubFixture(); c.context.mockResolvedValue({ ...f.context, reviewState: "reviewed", latestReview: f.review }); mount(); await open();
    const revoke = screen.getByRole("button", { name: "Revoke review" }); expect(revoke).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Reason for revocation"), { target: { value: "operator_correction" } }); expect(revoke).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /I want to revoke this exact/ })); fireEvent.click(revoke);
    await screen.findByRole("heading", { name: "Review revocation recorded" });
    expect(c.revoke).toHaveBeenCalledExactlyOnceWith(f.selection, f.review.reviewId, "operator_correction");
    expect(c.observe).not.toHaveBeenCalled(); expect(c.record).not.toHaveBeenCalled();
  });
  it.each(["identity_hold", "request_withdrawn"])("preserves %s and hides chain/approval controls without removing earned shares", async reviewState => {
    const f = organizerClubFixture(); c.context.mockResolvedValue({ ...f.context, reviewState }); mount(); await open();
    expect(screen.getByText(/club keeps its earned share/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Check treasury on chain" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Record club treasury review" })).not.toBeInTheDocument();
    expect(c.observe).not.toHaveBeenCalled(); expect(c.record).not.toHaveBeenCalled(); expect(c.wallet).not.toHaveBeenCalled();
  });
  it.each(["observe", "record"] as const)("clears private state on same-account session replacement and ignores late %s responses", async action => {
    let finish!: (value: unknown) => void; const view = mount(); await open();
    if (action === "record") { await observe(); fill(); }
    c[action].mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    if (action === "record") fireEvent.click(screen.getByRole("button", { name: "Record club treasury review" }));
    else {
      const f = organizerClubFixture(); fireEvent.change(screen.getByLabelText("Original Safe factory address"), { target: { value: f.observeInput.factoryAddress } });
      fireEvent.change(screen.getByLabelText("Safe creation transaction hash"), { target: { value: f.observeInput.deploymentTransactionHash } });
      fireEvent.click(screen.getByRole("button", { name: "Check treasury on chain" }));
    }
    await waitFor(() => expect(finish).toBeTypeOf("function")); c.session = { epoch: 2 };
    c.programmes.mockResolvedValue({ chainId: 31337, items: [], nextCursor: null }); view.update();
    await act(async () => finish(action === "record" ? organizerClubFixture().review : organizerClubFixture().preview));
    await screen.findByText(/No programmes are available/);
    expect(screen.queryByText("Synthetic treasury club")).not.toBeInTheDocument(); expect(screen.queryByText(organizerClubFixture().selection.address)).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Club treasury review recorded" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Club authority audit reference (UUID)")).not.toBeInTheDocument();
  });
  it.each([401, 403])("clears every private view when chain observation returns %s", async status => {
    c.observe.mockRejectedValue({ status, message: "private RPC details" }); mount(); await open();
    const f = organizerClubFixture(); fireEvent.change(screen.getByLabelText("Original Safe factory address"), { target: { value: f.observeInput.factoryAddress } });
    fireEvent.change(screen.getByLabelText("Safe creation transaction hash"), { target: { value: f.observeInput.deploymentTransactionHash } });
    fireEvent.click(screen.getByRole("button", { name: "Check treasury on chain" })); await screen.findByRole("button", { name: "Check access again" });
    expect(screen.queryByText(f.selection.address)).not.toBeInTheDocument(); expect(screen.queryByText("private RPC details")).not.toBeInTheDocument();
    expect(c.record).not.toHaveBeenCalled();
  });
  it("keeps an empty club list actionable and refreshes without automatic nomination or wallet calls", async () => {
    const f = organizerClubFixture(); c.clubs.mockResolvedValue({ ...f.page, items: [] }); mount();
    fireEvent.click(await screen.findByRole("button", { name: "Review club treasuries" })); await screen.findByText(/Club rewards stay reserved/);
    c.clubs.mockResolvedValue(f.page); fireEvent.click(screen.getByRole("button", { name: "Refresh requests" }));
    await screen.findByText("Synthetic treasury club"); expect(c.context).not.toHaveBeenCalled(); expect(c.wallet).not.toHaveBeenCalled();
  });
});
