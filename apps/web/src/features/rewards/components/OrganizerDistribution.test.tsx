import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/shared/i18n/I18nProvider";
import { decodeRewardCampaigns, decodeRewardAwardPage, decodeRewardAwardDetail } from "@raceson/domain/rewards";
import OrganizerRewards from "../screens/OrganizerRewards";
import { distributionFixture } from "../../../../../api/test/fixtures/reward-distribution.mjs";

const c = vi.hoisted(() => ({ programmes: vi.fn(), destinations: vi.fn(), campaigns: vi.fn(), awards: vi.fn(), detail: vi.fn(),
  wallet: vi.fn(), session: { epoch: 1 } as { epoch: number } | null }));
const amountText = (value: string) => (_content: string, node: Element | null) => node?.tagName === "SPAN"
  && node.classList.contains("tabular-nums") && node.textContent === value;
vi.mock("@/lib/public-env", () => ({ publicEnv: { rewardPortalEnabled: true, rewardDemo: { mode: "local" } } }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "operator" }, account: { userId: "operator" }, session: c.session, isLoading: false }) }));
vi.mock("../data/organizerRewards", () => ({ getOrganizerProgrammes: c.programmes, getOrganizerDestinations: c.destinations }));
vi.mock("../data/organizerDistribution", () => ({ getOrganizerCampaigns: c.campaigns, getOrganizerAwards: c.awards, getOrganizerAwardEvidence: c.detail }));
function fixture() {
  const f = distributionFixture(), scope = { ...f.scope, chainId: 31337 as const }, allocation = { ...f.allocation, chainId: scope.chainId }, selected = { ...f.selected, chainId: scope.chainId };
  return { ...f, scope, allocation, selected, campaigns: decodeRewardCampaigns(f.campaigns, scope), page: decodeRewardAwardPage(f.page, allocation), detail: decodeRewardAwardDetail(f.detail, selected) };
}
function mount(locale: "en" | "hr" = "en") {
  const tree = () => <I18nProvider initialLocale={locale}><MemoryRouter><OrganizerRewards /></MemoryRouter></I18nProvider>;
  const view = render(tree()); return { ...view, update: () => view.rerender(tree()) };
}
async function open(locale: "en" | "hr" = "en") {
  fireEvent.click(await screen.findByRole("button", { name: locale === "en" ? "Explore awards" : "Istraži nagrade" }));
  fireEvent.click(await screen.findByRole("button", { name: locale === "en" ? "View awards" : "Pogledaj nagrade" }));
  fireEvent.click(await screen.findByRole("button", { name: locale === "en" ? "Why this award?" : "Zašto ova nagrada?" }));
  return screen.findByRole("region", { name: locale === "en" ? "Award evidence" : "Podloga nagrade" });
}
beforeEach(() => {
  const f = fixture(); c.session = { epoch: 1 };
  c.programmes.mockReset().mockResolvedValue({ chainId: 31337, items: [{ programmeId: f.scope.programmeId, year: 2026,
    leagueName: "Synthetic league", seasonName: "2026", budgetWei: f.campaigns.budgetWei }], nextCursor: null });
  c.destinations.mockReset(); c.campaigns.mockReset().mockResolvedValue(f.campaigns); c.awards.mockReset().mockResolvedValue(f.page);
  c.detail.mockReset().mockResolvedValue(f.detail); c.wallet.mockReset();
  Object.defineProperty(window, "ethereum", { configurable: true, value: { request: c.wallet } });
});
describe("organizer saved distribution explorer", () => {
  it.each(["en", "hr"] as const)("connects programme → campaign → award → sporting evidence in %s without eager reads or wallet calls", async locale => {
    mount(locale); await screen.findByText("Synthetic league"); expect(c.campaigns).not.toHaveBeenCalled(); expect(c.awards).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: locale === "en" ? "Explore awards" : "Istraži nagrade" }));
    await screen.findByText("Synthetic round 5"); expect(c.awards).not.toHaveBeenCalled(); expect(c.detail).not.toHaveBeenCalled();
    expect(screen.getAllByText(locale === "en" ? /Awaiting a reviewed allocation/ : /Čeka se pregledana raspodjela/)).toHaveLength(5);
    fireEvent.click(screen.getByRole("button", { name: locale === "en" ? "View awards" : "Pogledaj nagrade" }));
    await screen.findByText("Synthetic runner"); expect(c.detail).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: locale === "en" ? "Why this award?" : "Zašto ova nagrada?" }));
    const region = await screen.findByRole("region", { name: locale === "en" ? "Award evidence" : "Podloga nagrade" });
    await within(region).findByText("Synthetic division");
    const unit = locale === "en" ? "test MON" : "testni MON";
    expect(within(region).getByText(amountText(`70 ${unit}`))).toBeVisible(); expect(within(region).getByText(amountText(`50 ${unit}`))).toBeVisible();
    expect(within(region).getByText(amountText(`20 ${unit}`))).toBeVisible(); expect(within(region).getByText("0:16:40.000")).toBeVisible();
    expect(screen.getByText(locale === "en" ? /This is not proof of funding/ : /Nije potvrda financiranja/)).toBeVisible();
    fireEvent.click(within(region).getByText(locale === "en" ? "Inspect result references" : "Pregledaj oznake rezultata"));
    expect(within(region).getByText(fixture().detail.sources[0].publicationId)).toBeVisible();
    expect(c.detail).toHaveBeenCalledExactlyOnceWith(fixture().selected, null); expect(c.destinations).not.toHaveBeenCalled(); expect(c.wallet).not.toHaveBeenCalled();
  });
  it("returns through award and campaign lists and refreshes saved history without retaining a private detail cache", async () => {
    mount(); const region = await open(); await within(region).findByText("Synthetic division");
    fireEvent.click(within(region).getByRole("button", { name: "Back to awards" })); await screen.findByRole("button", { name: "Why this award?" });
    expect(screen.queryByText("Synthetic division")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back to reward pots" })); await screen.findByText("Synthetic round 5");
    expect(c.campaigns).toHaveBeenCalledTimes(2); expect(c.detail).toHaveBeenCalledTimes(1);
  });
  it("clears all old award evidence while refresh is pending and after a failed response", async () => {
    mount(); const region = await open(); await within(region).findByText("Synthetic division");
    let fail!: (reason: unknown) => void; c.detail.mockImplementation(() => new Promise((_, reject) => { fail = reject; }));
    fireEvent.click(within(region).getByRole("button", { name: "Refresh" })); expect(screen.queryByText("Synthetic division")).not.toBeInTheDocument();
    expect(screen.queryByText(amountText("70 test MON"))).not.toBeInTheDocument();
    await act(async () => fail({ status: 503, message: "private diagnostic" })); expect(await screen.findByRole("alert")).toBeVisible();
    expect(screen.queryByText("private diagnostic")).not.toBeInTheDocument(); expect(c.detail).toHaveBeenCalledTimes(2);
  });
  it.each([401, 403])("hides the entire private explorer when access returns %s", async status => {
    mount(); const region = await open(); await within(region).findByText("Synthetic division"); c.detail.mockRejectedValue({ status });
    fireEvent.click(within(region).getByRole("button", { name: "Refresh" })); await screen.findByRole("button", { name: "Check access again" });
    expect(screen.queryByText("Synthetic runner")).not.toBeInTheDocument(); expect(screen.queryByText(amountText("70 test MON"))).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Award evidence" })).not.toBeInTheDocument();
  });
  it("ignores late detail after same-account session replacement", async () => {
    let finish!: (data: unknown) => void; c.detail.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const view = mount(); await open(); await waitFor(() => expect(finish).toBeTypeOf("function"));
    c.session = { epoch: 2 }; view.update(); await screen.findByText("Synthetic league");
    await act(async () => finish(fixture().detail)); expect(screen.queryByText("Synthetic division")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Award evidence" })).not.toBeInTheDocument();
  });
  it("offers an explicit empty-allocation state, never an invented winner", async () => {
    const f = fixture(); f.campaigns.items[0].allocation!.awardCount = 0;
    f.campaigns.items[0].allocation!.allocatedWei = "0"; f.campaigns.items[0].allocation!.unallocatedWei = f.campaigns.items[0].budgetWei;
    c.campaigns.mockResolvedValue(f.campaigns);
    c.awards.mockResolvedValue({ ...f.page, items: [] }); mount();
    fireEvent.click(await screen.findByRole("button", { name: "Explore awards" })); fireEvent.click(await screen.findByRole("button", { name: "View awards" }));
    expect(await screen.findByText("This saved allocation has no awarded shares.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Why this award?" })).not.toBeInTheDocument(); expect(c.detail).not.toHaveBeenCalled();
  });
});
