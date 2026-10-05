import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { I18nProvider } from "@/shared/i18n/I18nProvider";
import FinaleBindingV3 from "./FinaleBindingV3";
import { historicalFixture } from "../data/historicalSourceV3.fixture";
const mocks = vi.hoisted(() => ({ request: vi.fn(), saved: vi.fn() }));
vi.mock("../data/finaleBindingV3", () => ({ requestFinaleBindingV3: (...args: unknown[]) => mocks.request(...args) }));
vi.mock("./NativeContinuityReviewV3", () => ({ default: ({ bindingId, dirty }: { bindingId: string; dirty: boolean }) =>
  <p data-testid="continuity-scope">{bindingId} · {String(dirty)}</p> }));
const id = (n: number) => `8d000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function data() { const { record, workspace } = historicalFixture().context; return { schema: "raceson-finale-binding-v3", draftId: record.draftId,
  chainId: 31337, recordRevision: 1, contextHash: "a".repeat(64), sourceHash: "b".repeat(64), categories: workspace.catalogue.categories,
  editions: [{ id: id(1), name: "Synthetic finale", date: "2026-10-03", races: [{ id: id(2), name: "Synthetic short", distanceMetres: "5000" }] }],
  binding: null, recordedId: null, locked: false }; }
beforeEach(() => { mocks.request.mockReset().mockResolvedValue(data()); mocks.saved.mockReset(); });
function mount(dirty = false, locale: "en" | "hr" = "en") {
  return render(<I18nProvider initialLocale={locale}><FinaleBindingV3 record={historicalFixture().context.record} dirty={dirty} onSaved={mocks.saved} /></I18nProvider>);
}
async function choose() {
  fireEvent.change(await screen.findByLabelText("Final-round demo race"), { target: { value: id(1) } });
  fireEvent.change(screen.getByLabelText("Demo race for Short"), { target: { value: id(2) } });
  fireEvent.click(screen.getByRole("checkbox"));
}
it("requires explicit event, race and confirmation, then reloads the shared mapping without approving prizes", async () => {
  mount(); await screen.findByText("Synthetic finale · 2026-10-03");
  expect(screen.getByRole("button", { name: "Save finale connection" })).toBeDisabled();
  await choose(); fireEvent.click(screen.getByRole("button", { name: "Save finale connection" }));
  await screen.findByText(/Connection saved. Select it for round 5/);
  expect(mocks.saved).toHaveBeenCalledOnce();
  expect(mocks.request.mock.calls[1][1]).toMatchObject({ editionId: id(1), expectedBindingId: null, races: [{ raceId: id(2) }] });
});
it("uncertain saves hide stale choices and retry exactly the same request", async () => {
  mount(); await choose(); mocks.request.mockRejectedValueOnce(Error("secret upstream error"));
  fireEvent.click(screen.getByRole("button", { name: "Save finale connection" })); await screen.findByRole("alert");
  expect(screen.queryByLabelText("Final-round demo race")).not.toBeInTheDocument();
  expect(screen.queryByText(/secret upstream/)).not.toBeInTheDocument(); const sent = mocks.request.mock.calls[1][1];
  fireEvent.click(screen.getByRole("button", { name: "Recover the same finale connection" }));
  await screen.findByText(/Connection saved/); expect(mocks.request.mock.calls[2][1]).toEqual(sent);
});
it("refuses edits after deployment reservation or while source mapping has unsaved edits", async () => {
  mocks.request.mockResolvedValueOnce({ ...data(), locked: true }); const v = mount();
  await screen.findByText(/Deployment has been reserved/); expect(screen.getByLabelText("Final-round demo race")).toBeDisabled();
  v.unmount(); mount(true); expect(await screen.findByLabelText("Final-round demo race")).toBeDisabled();
});
it("Croatian empty state clearly requires a local demo race", async () => {
  mocks.request.mockResolvedValueOnce({ ...data(), editions: [] }); mount(false, "hr");
  await screen.findByText(/Nema odgovarajuće lokalne demo utrke/);
  expect(screen.getByRole("button", { name: "Spremi povezivanje završnice" })).toBeDisabled();
});
it("shared finale connection opens the saved continuity review and fences unsaved binding changes", async () => {
  const view = data(); mocks.request.mockResolvedValueOnce({ ...view, binding: { id: id(5), editionId: id(1),
    races: [{ raceId: id(2), competitionId: view.categories.find(c => c.target === "individual")!.competitionId }] } });
  mount(); const open = await screen.findByRole("button", { name: "Review finale identities and categories · V3" });
  expect(screen.queryByTestId("continuity-scope")).not.toBeInTheDocument(); fireEvent.click(open);
  expect(await screen.findByTestId("continuity-scope")).toHaveTextContent(`${id(5)} · false`);
  fireEvent.change(screen.getByLabelText("Final-round demo race"), { target: { value: "" } });
  expect(screen.getByTestId("continuity-scope")).toHaveTextContent(`${id(5)} · true`);
});
