import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/shared/i18n/I18nProvider";
import ClubRewards from "./ClubRewards";
import { clubFixture, clubAddress as a } from "../model/clubFixtures.test-helper";
const c = vi.hoisted(() => ({ enabled: true, user: "owner", account: "owner", session: { epoch: 1 } as { epoch: number } | null,
  clubs: vi.fn(), history: vi.fn(), submit: vi.fn(), read: vi.fn(), withdraw: vi.fn(), wallet: vi.fn(), signOut: vi.fn() }));
vi.mock("../components/SponsorClubClaims",()=>({default:()=> <div>Club claim controls</div>}));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: c.user }, account: { userId: c.account }, session: c.session, isLoading: false, signOut:c.signOut }) }));
vi.mock("@/lib/public-env", () => ({ publicEnv: { get rewardPortalEnabled() { return c.enabled; }, rewardDemo: { mode: "local" } } }));
vi.mock("../data/clubTreasuries", () => ({ getRewardOwnedClubs: c.clubs, getClubTreasuryHistory: c.history,
  submitClubTreasury: c.submit, readClubTreasury: c.read, withdrawClubTreasury: c.withdraw }));
function Route(){const l=useLocation();return <span aria-label="Route">{l.pathname+l.search}</span>;}
function mount(locale: "en" | "hr" = "en") {
  const tree = () => <I18nProvider initialLocale={locale}><MemoryRouter initialEntries={['/club/rewards']}><ClubRewards /><Route/></MemoryRouter></I18nProvider>;
  const view = render(tree()); return { ...view, update: () => view.rerender(tree()) };
}
async function open(locale: "en" | "hr" = "en") {
  const label = locale === "en" ? "Nominate a treasury" : "Predloži klupski novčanik";
  await screen.findByText("Synthetic treasury club"); fireEvent.click(screen.getByRole("button", { name: label }));
  return screen.findByRole("region", { name: label });
}
function fill(region: HTMLElement, locale: "en" | "hr" = "en") {
  fireEvent.change(within(region).getByRole("combobox"), { target: { value: clubFixture().request.clubId } });
  const fields = locale === "en" ? ["Safe treasury address", "Safe singleton address", "Compatibility handler address", "Owner address 1", "Owner address 2", "Owner address 3"]
    : ["Adresa Safe novčanika", "Adresa Safe implementacije", "Adresa ugovora za kompatibilnost", "Adresa vlasnika 1", "Adresa vlasnika 2", "Adresa vlasnika 3"];
  fields.forEach((field, i) => fireEvent.change(within(region).getByLabelText(field), { target: { value: a([10, 11, 12, 22, 20, 21][i]) } }));
  fireEvent.click(within(region).getByRole("checkbox"));
}
beforeEach(() => {
  const f = clubFixture(); c.enabled = true; c.user = "owner"; c.account = "owner"; c.session = { epoch: 1 };
  c.clubs.mockReset().mockResolvedValue(f.clubs); c.history.mockReset().mockResolvedValue({ items: [], nextCursor: null });
  c.submit.mockReset().mockResolvedValue(f.request); c.read.mockReset().mockResolvedValue(f.request);
  c.withdraw.mockReset().mockResolvedValue({ ...f.request, status: "withdrawn", withdrawnAt: "2026-09-09T01:01:00Z" }); c.wallet.mockReset();
  Object.defineProperty(window, "ethereum", { configurable: true, value: { request: c.wallet } });
  c.signOut.mockReset().mockResolvedValue(undefined);
});
describe("private club treasury journey", () => {
  it.each(["en", "hr"] as const)("requires named-club selection and explicit nomination in %s without wallet calls", async locale => {
    mount(locale); const region = await open(locale), button = within(region).getByRole("button", { name: locale === "en" ? "Submit treasury nomination" : "Pošalji prijedlog novčanika" });
    expect(button).toBeDisabled(); expect(c.submit).not.toHaveBeenCalled(); expect(within(region).getByRole("combobox")).toHaveValue("");
    fill(region, locale); expect(button).toBeEnabled(); fireEvent.click(button);
    await screen.findByRole("heading", { name: locale === "en" ? "Treasury nomination recorded" : "Prijedlog novčanika je evidentiran" });
    expect(c.submit).toHaveBeenCalledOnce(); expect(c.submit.mock.calls[0][0].owners).toEqual([20, 21, 22].map(a));
    expect(c.wallet).not.toHaveBeenCalled(); expect(c.withdraw).not.toHaveBeenCalled();
  });
  it("preserves the exact candidate and retry key after an uncertain committed response", async () => {
    c.submit.mockRejectedValueOnce({ status: 503, message: "secret transport detail" }); mount(); const region = await open(); fill(region);
    fireEvent.click(within(region).getByRole("button", { name: "Submit treasury nomination" })); await screen.findByRole("alert");
    expect(within(region).getByRole("combobox")).toBeDisabled(); expect(screen.queryByText("secret transport detail")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry the same nomination" })); await screen.findByRole("heading", { name: "Treasury nomination recorded" });
    expect(c.submit.mock.calls[0]).toEqual(c.submit.mock.calls[1]);
  });
  it("retains the saved receipt if the automatic history refresh fails", async () => {
    c.history.mockResolvedValueOnce({ items: [], nextCursor: null }).mockRejectedValue({ status: 503 }); mount(); const region = await open(); fill(region);
    fireEvent.click(within(region).getByRole("button", { name: "Submit treasury nomination" })); await screen.findByRole("heading", { name: "Treasury nomination recorded" });
    await screen.findByRole("alert"); expect(c.submit).toHaveBeenCalledOnce();
  });
  it("loads details only explicitly and requires withdrawal consent, including an exact uncertain retry", async () => {
    c.history.mockResolvedValue(clubFixture().history); c.withdraw.mockRejectedValueOnce({ status: 503 }); mount();
    fireEvent.click(await screen.findByRole("button", { name: "Inspect request" }));
    const withdraw = await screen.findByRole("button", { name: "Withdraw nomination" }); expect(withdraw).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(withdraw); await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Retry the same withdrawal" })); await screen.findByText("Nomination withdrawn");
    expect(c.withdraw.mock.calls[0]).toEqual(c.withdraw.mock.calls[1]); expect(c.wallet).not.toHaveBeenCalled();
  });
  it("keeps previous-owner request history while offering no new nomination to an ownerless account", async () => {
    c.clubs.mockResolvedValue({ items: [], nextCursor: null }); c.history.mockResolvedValue({ ...clubFixture().history, items: [{ ...clubFixture().request, status: "identity_hold" }] });
    mount(); await screen.findByText("On hold — ownership changed"); expect(screen.getByRole("button", { name: "Nominate a treasury" })).toBeDisabled();
    expect(screen.getByText(/No club ownership was found/)).toBeVisible(); expect(c.read).not.toHaveBeenCalled();
  });
  it("does not load private data when disabled, without a session or for a mismatched account", () => {
    c.enabled = false; const view = mount(); c.enabled = true; c.session = null; view.update(); c.session = { epoch: 2 }; c.account = "other"; view.update();
    expect(c.clubs).not.toHaveBeenCalled(); expect(c.history).not.toHaveBeenCalled();
  });
  it("clears the entire private workspace when permission is lost during detail inspection", async () => {
    c.history.mockResolvedValue(clubFixture().history); c.read.mockRejectedValue({ status: 403 }); mount();
    fireEvent.click(await screen.findByRole("button", { name: "Inspect request" })); await screen.findByRole("button", { name: "Check access again" });
    expect(screen.queryByText("Synthetic treasury club")).not.toBeInTheDocument(); expect(screen.queryByText(a(10))).not.toBeInTheDocument();
  });
  it("hides stale history after a failed refresh", async () => {
    c.history.mockResolvedValueOnce(clubFixture().history).mockRejectedValue({ status: 503 }); mount();
    await screen.findByRole("button", { name: "Inspect request" }); fireEvent.click(screen.getByRole("button", { name: "Refresh request history" }));
    await screen.findByRole("alert"); expect(screen.queryByText(a(10))).not.toBeInTheDocument(); expect(screen.getByRole("button", { name: "Nominate a treasury" })).toBeDisabled();
  });
  it("discards a late nomination response across a same-user session replacement", async () => {
    let resolve!: (v: unknown) => void; c.submit.mockImplementation(() => new Promise(r => { resolve = r; }));
    const view = mount(), region = await open(); fill(region); fireEvent.click(within(region).getByRole("button", { name: "Submit treasury nomination" }));
    c.session = { epoch: 2 }; view.update(); await act(async () => resolve(clubFixture().request));
    expect(screen.queryByRole("heading", { name: "Treasury nomination recorded" })).not.toBeInTheDocument(); expect(c.history).toHaveBeenCalledTimes(2);
  });
});


it("keeps claims unmounted during initial access checks and an empty refresh", async () => {
  let resolveClubs!: (value: unknown) => void, resolveHistory!: (value: unknown) => void;
  const empty={items:[],nextCursor:null};
  c.clubs.mockImplementation(()=>new Promise(resolve=>{resolveClubs=resolve;}));
  c.history.mockImplementation(()=>new Promise(resolve=>{resolveHistory=resolve;}));
  mount();
  expect(screen.getByRole('status')).toHaveTextContent('Checking your club reward access');
  expect(screen.queryByText('Club claim controls')).not.toBeInTheDocument();
  await act(async()=>resolveClubs(empty));
  expect(screen.queryByRole('heading',{name:'No club to manage'})).not.toBeInTheDocument();
  expect(screen.queryByText('Club claim controls')).not.toBeInTheDocument();
  await act(async()=>resolveHistory(empty));
  expect(screen.getByRole('region',{name:'No club to manage'})).toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:'Refresh clubs'}));
  expect(screen.getByRole('status')).toHaveTextContent('Checking your club reward access');
  expect(screen.queryByText('Club claim controls')).not.toBeInTheDocument();
  await act(async()=>{resolveHistory(empty);resolveClubs(empty);});
  expect(screen.getByRole('region',{name:'No club to manage'})).toBeVisible();
  expect(c.clubs).toHaveBeenCalledTimes(2);expect(c.history).toHaveBeenCalledTimes(2);
  expect(c.submit).not.toHaveBeenCalled();expect(c.wallet).not.toHaveBeenCalled();
});

it("does not mistake failed ownership verification for an empty account",async()=>{
  c.clubs.mockRejectedValue({status:503});
  mount();
  expect(await screen.findByRole('alert')).toBeVisible();
  expect(screen.queryByRole('heading',{name:'No club to manage'})).not.toBeInTheDocument();
  expect(screen.getByRole('button',{name:'Nominate a treasury'})).toBeDisabled();
});
it('offers an explicit account switch after ownership denial instead of looping through sign-in with the same account',async()=>{
 c.clubs.mockRejectedValue({status:403});c.history.mockRejectedValue({status:403});mount();
 const change=await screen.findByRole('button',{name:'Sign in with the club owner account'});expect(c.signOut).not.toHaveBeenCalled();
 fireEvent.click(change);await screen.findByText('/auth?next=%2Fclub%2Frewards');expect(c.signOut).toHaveBeenCalledOnce();expect(c.submit).not.toHaveBeenCalled();expect(c.wallet).not.toHaveBeenCalled();
});
