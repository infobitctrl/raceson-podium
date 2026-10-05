import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { I18nProvider } from "@/shared/i18n/I18nProvider";
import { leaguePolicyUiFixture } from "../data/leaguePolicyV3.fixture";
import LeaguePolicyReviewV3 from "./LeaguePolicyReviewV3";
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../data/leaguePolicyV3", () => ({ requestLeaguePolicyV3: (...args: unknown[]) => mocks.request(...args) }));
beforeEach(() => mocks.request.mockReset().mockResolvedValue(leaguePolicyUiFixture().missing));
function mount(locale: "en" | "hr" = "en", dirty = false) { const f = leaguePolicyUiFixture();
  return render(<I18nProvider initialLocale={locale}><LeaguePolicyReviewV3 record={f.record} dirty={dirty} /></I18nProvider>); }
it("starts blank, requires all categories and confirmation, edits independently and saves only a policy", async () => {
  mount(); await screen.findByText("No scoring policy selected");
  expect(screen.getAllByRole("textbox").every(e => (e as HTMLInputElement).value === "")).toBe(true);
  expect(screen.getByRole("button", { name: "Save scoring policy" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Use example policy for all categories" }));
  expect(screen.getByRole("button", { name: "Save scoring policy" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Best rounds counted (1–5)"), { target: { value: "3" } });
  fireEvent.change(screen.getByLabelText("Category to edit"), { target: { value: leaguePolicyUiFixture().data.categories[1].id } });
  expect(screen.getByLabelText("Best rounds counted (1–5)")).toHaveValue("4");
  fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(screen.getByRole("button", { name: "Save scoring policy" }));
  await screen.findByText(/Decision saved/); const c = mocks.request.mock.calls[1][1];
  expect(c.policy.categories).toHaveLength(7); expect(c.policy.categories[0].bestN).toBe(3); expect(c.policy.club.membersPerRound).toBe(3);
  expect(c.decision).toBe("selected"); expect(c).not.toHaveProperty("source"); expect(c).not.toHaveProperty("payableWei");
});
it("retains the exact uncertain save, hides old tables and displays a later hold on retry", async () => {
  const f = leaguePolicyUiFixture(); mocks.request.mockResolvedValueOnce(f.data); mount(); await screen.findByText("Scoring policy selected");
  fireEvent.click(screen.getByRole("checkbox")); mocks.request.mockRejectedValueOnce(Error("private failure"));
  fireEvent.click(screen.getByRole("button", { name: "Save scoring policy" })); await screen.findByRole("alert");
  expect(screen.queryByText("Calculated standings · Not published")).not.toBeInTheDocument(); expect(screen.queryByText("private failure")).not.toBeInTheDocument();
  const change = mocks.request.mock.calls[1][1];
  mocks.request.mockResolvedValueOnce({ ...f.missing, reviewState: "held", review: { ...f.data.review, decision: "held" } });
  fireEvent.click(screen.getByRole("button", { name: "Retry the same save" })); await screen.findByText("Scoring policy held");
  expect(mocks.request.mock.calls[2][1]).toEqual(change);
});
it("inspects athlete rounds, club contributions and all participation distances; edits hide proposal", async () => {
  const f = leaguePolicyUiFixture(); mocks.request.mockResolvedValueOnce(f.data); mount(); await screen.findByText("Scoring policy selected");
  const panel = screen.getByRole("region", { name: "Calculated standings · Not published" });
  fireEvent.click(within(panel).getAllByText("Explain scores and source results")[0]);
  expect(within(panel).getAllByText(/Not counted/).length).toBeGreaterThan(0);
  fireEvent.click(within(panel).getByRole("button", { name: "Club contributions" }));
  expect(within(panel).getByLabelText("Club table scope")).toHaveValue("league");
  fireEvent.change(within(panel).getByLabelText("Club table scope"), { target: { value: "5" } });
  expect(within(panel).getByText("Synthetic club 5001")).toBeInTheDocument();
  fireEvent.click(within(panel).getByRole("button", { name: "Participation distance" }));
  expect(within(panel).getByText(/6,705,000 m/)).toBeInTheDocument();
  fireEvent.click(within(panel).getByRole("button", { name: "Next result rows" })); expect(within(panel).getByText("Page 2 of 9")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Best rounds counted (1–5)"), { target: { value: "3" } });
  expect(screen.queryByRole("region", { name: "Calculated standings · Not published" })).not.toBeInTheDocument();
});
it("blocks dirty mapping writes, invalid minimum, and supports Croatian hold review", async () => {
  const mounted = mount(); await screen.findByText("No scoring policy selected"); fireEvent.click(screen.getByRole("button", { name: "Use example policy for all categories" }));
  fireEvent.change(screen.getByLabelText("Minimum finishes for a league rank"), { target: { value: "5" } });
  expect(screen.getByRole("checkbox")).toBeDisabled(); mounted.unmount();
  mount("hr", true); await screen.findByText("Pravila bodovanja nisu odabrana"); expect(screen.getByRole("button", { name: "Spremi pravila bodovanja" })).toBeDisabled();
});
it("discards responses from an unmounted account/draft scope", async () => {
  let resolve!: (v: unknown) => void; mocks.request.mockImplementationOnce(() => new Promise(r => resolve = r));
  const m = mount(); m.unmount(); await act(async () => resolve(leaguePolicyUiFixture().data));
  expect(screen.queryByText("Scoring policy selected")).not.toBeInTheDocument();
});
