import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/shared/i18n/I18nProvider";
import { sportingFixture } from "../../../../../api/test/fixtures/reward-sporting.mjs";
import OrganizerSporting from "./OrganizerSporting";
const c = vi.hoisted(() => ({ read: vi.fn(), capture: vi.fn(), preview: vi.fn(), save: vi.fn(), record: vi.fn(), back: vi.fn(), prepare: vi.fn(), access: vi.fn(), wallet: vi.fn() }));
vi.mock("../data/organizerSporting", () => ({ getOrganizerSportingSource: c.read, captureOrganizerSportingSource: c.capture,
  previewOrganizerSportingReview: c.preview, submitOrganizerSportingReview: c.save, getOrganizerSportingRecord: c.record }));
let f: Awaited<ReturnType<typeof sportingFixture>>;
function mount(locale: "en" | "hr" = "en") {
  return render(<I18nProvider initialLocale={locale}><OrganizerSporting selection={{ ...f.selection, chainId: 31337 }} raceName="Synthetic round"
    onBack={c.back} onPrepare={c.prepare} onAccessLost={c.access} /></I18nProvider>);
}
async function fill(locale: "en" | "hr" = "en") {
  const text = (en: string, hr: string) => locale === "en" ? en : hr;
  fireEvent.change(await screen.findByLabelText(text("Sporting review reference", "Oznaka sportske provjere")), { target: { value: "synthetic-review-1" } });
  const membership = screen.getByRole("region", { name: text("Uncertain classification membership", "Nepotvrđena pripadnost kategoriji") });
  fireEvent.change(within(membership).getByRole("combobox"), { target: { value: f.view.source!.items[4].possibleClassificationIds[1] } });
  fireEvent.change(within(membership).getByRole("textbox"), { target: { value: "synthetic-case-1" } });
  fireEvent.click(screen.getByRole("button", { name: text("Suggest ranks from finish times", "Predloži poredak prema vremenu") }));
  const records = screen.getByRole("region", { name: text("Comparable route records", "Usporedivi rekordi staze") });
  for (const select of within(records).getAllByRole("combobox")) fireEvent.change(select, { target: { value: "none" } });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: text("Validate and preview decisions", "Provjeri i pregledaj odluke") })));
  await screen.findByRole("region", { name: text("Calculated outcome of this review", "Izračun na temelju ove provjere") });
}
async function save(locale: "en" | "hr" = "en") {
  const region = screen.getByRole("region", { name: locale === "en" ? "Calculated outcome of this review" : "Izračun na temelju ove provjere" });
  await act(async () => { fireEvent.click(within(region).getByRole("checkbox")); fireEvent.click(within(region).getByRole("button")); });
}
beforeEach(async () => {
  f = await sportingFixture(); Object.values(c).forEach(fn => fn.mockReset());
  c.read.mockResolvedValue(f.view); c.capture.mockResolvedValue(f.capture); c.save.mockResolvedValue(f.saved);
  c.preview.mockImplementation((_scope, request) => f.preview(request));
  Object.defineProperty(window, "ethereum", { configurable: true, value: { request: c.wallet } });
});
describe("organizer sporting editor", () => {
  it.each(["en", "hr"] as const)("reviews results and saves only an explicitly confirmed calculated decision in %s", async locale => {
    mount(locale); await fill(locale); expect(c.preview).toHaveBeenCalledOnce(); expect(c.save).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: locale === "en" ? "Save this sporting review" : "Spremi ovu sportsku provjeru" })).toBeDisabled();
    await save(locale); await screen.findByRole("heading", { name: locale === "en" ? "Sporting review saved" : "Sportska provjera je spremljena" });
    expect(c.save).toHaveBeenCalledOnce(); expect(c.save.mock.calls[0][1]).toMatchObject({ snapshotId: f.capture.snapshotId, expectedRevision: 0, confirmReview: true });
    expect(screen.queryByLabelText("Sporting review reference")).not.toBeInTheDocument(); expect(c.wallet).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: locale === "en" ? "Prepare allocation" : "Pripremi raspodjelu" })); expect(c.prepare).toHaveBeenCalledOnce();
  });
  it("does not invent sporting decisions; incomplete membership stays editable without a request", async () => {
    mount(); fireEvent.change(await screen.findByLabelText("Sporting review reference"), { target: { value: "synthetic-review-1" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Validate and preview decisions" })));
    expect(await screen.findByRole("alert")).toHaveTextContent("Decide every uncertain membership"); expect(c.preview).not.toHaveBeenCalled(); expect(c.save).not.toHaveBeenCalled();
  });
  it("captures only on confirmation and retries the original uncertain capture key", async () => {
    c.read.mockResolvedValueOnce({ ...f.view, source: null }); c.capture.mockRejectedValueOnce({ status: 503 }); mount();
    const button = await screen.findByRole("button", { name: "Capture published results" }); expect(button).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox")); await act(async () => fireEvent.click(button)); await screen.findByRole("alert");
    expect(screen.getByRole("checkbox")).toBeDisabled(); await act(async () => fireEvent.click(screen.getByRole("button", { name: "Retry the same capture" })));
    await screen.findByLabelText("Sporting review reference"); expect(c.capture.mock.calls[1]).toEqual(c.capture.mock.calls[0]); expect(c.save).not.toHaveBeenCalled();
    expect(c.read).toHaveBeenLastCalledWith({ ...f.selection, chainId: 31337 }, f.capture.snapshotId);
  });
  it("freezes the exact review after an uncertain save and retries it without accepting edits", async () => {
    c.save.mockRejectedValueOnce({ status: 503, message: "private diagnostic" }); mount(); await fill(); await save();
    await screen.findByRole("alert"); expect(screen.queryByText("private diagnostic")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Sporting review reference")).toBeDisabled(); const original = structuredClone(c.save.mock.calls[0]);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Retry the same review" })));
    await screen.findByRole("heading", { name: "Sporting review saved" }); expect(c.save.mock.calls[1]).toEqual(original);
  });
  it("editing a decision invalidates its preview and explicit consent", async () => {
    mount(); await fill(); const region = screen.getByRole("region", { name: "Calculated outcome of this review" });
    fireEvent.click(within(region).getByRole("checkbox")); fireEvent.change(screen.getByLabelText("Sporting review reference"), { target: { value: "synthetic-review-2" } });
    expect(screen.queryByRole("region", { name: "Calculated outcome of this review" })).not.toBeInTheDocument(); expect(c.save).not.toHaveBeenCalled();
  });
  it.each([401, 403, 409])("removes stale private evidence after %s", async status => {
    c.save.mockRejectedValue({ status }); mount(); await fill(); await save(); await screen.findByRole("alert");
    expect(screen.queryByLabelText("Sporting review reference")).not.toBeInTheDocument(); expect(screen.queryByText("Synthetic runner 5")).not.toBeInTheDocument();
    if (status !== 409) expect(c.access).toHaveBeenCalledWith({ status });
    expect(screen.queryByRole("button", { name: "Retry the same review" })).not.toBeInTheDocument();
  });
  it("ignores a late save after session-owned unmount", async () => {
    let done!: (v: unknown) => void; c.save.mockImplementation(() => new Promise(resolve => { done = resolve; }));
    const mounted = mount(); await fill(); await save(); await waitFor(() => expect(done).toBeTypeOf("function")); mounted.unmount();
    await act(async () => done(f.saved)); expect(c.prepare).not.toHaveBeenCalled(); expect(c.access).not.toHaveBeenCalled();
  });
  it("loads every league source page before previewing participation without podium or age decisions", async () => {
    f = await sportingFixture("league");
    const { getOrganizerSportingSource } = await import("../../../../../api/dist/features/rewards/organizer-sporting-service.js");
    const next = await getOrganizerSportingSource(f.identity, f.selection, { snapshotId: f.capture.snapshotId, afterId: f.view.source!.nextCursor }, f.rpc);
    c.read.mockReset().mockResolvedValueOnce(f.view).mockResolvedValueOnce(next); c.save.mockResolvedValue(f.saved); mount();
    const more = await screen.findByRole("button", { name: "Load more results" });
    expect(screen.queryByRole("button", { name: "Validate and preview decisions" })).not.toBeInTheDocument();
    await act(async () => fireEvent.click(more)); const preview = await screen.findByRole("button", { name: "Validate and preview decisions" });
    expect(screen.queryByLabelText("Sporting review reference")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Uncertain classification membership" })).not.toBeInTheDocument();
    await act(async () => fireEvent.click(preview)); await screen.findByRole("region", { name: "Calculated outcome of this review" });
    expect(c.preview.mock.calls[0][1].review).toEqual({ schemaVersion: 1, adjudications: [], roundReviews: [] });
    await save(); await screen.findByRole("heading", { name: "Sporting review saved" }); expect(c.wallet).not.toHaveBeenCalled();
  });
  it("requires an approval UUID, loads its matching baseline and clears it when the reference changes", async () => {
    mount(); await screen.findByLabelText("Sporting review reference");
    const records = screen.getByRole("region", { name: "Comparable route records" }), race = f.view.source!.rounds[0].races[0], approvalId = f.capture.snapshotId;
    fireEvent.change(within(records).getAllByRole("combobox")[0], { target: { value: "approved" } });
    const load = within(records).getByRole("button", { name: "Load and verify record" }), input = within(records).getByRole("textbox");
    expect(load).toBeDisabled(); fireEvent.change(input, { target: { value: "not-a-uuid" } }); expect(load).toBeDisabled();
    c.record.mockResolvedValue({ ...f.selection, snapshotId: f.capture.snapshotId, approvalId, raceId: race.id, gender: "M",
      baseline: { approvalId, publicationId: approvalId, establishedAtMs: "1", finishTimeMs: "1000000", courseComparisonKey: "synthetic-comparison" } });
    fireEvent.change(input, { target: { value: approvalId } }); await act(async () => fireEvent.click(load));
    expect(await within(records).findByRole("status")).toHaveTextContent("Historical baseline verified");
    fireEvent.change(input, { target: { value: "" } }); expect(within(records).queryByRole("status")).not.toBeInTheDocument();
    expect(c.preview).not.toHaveBeenCalled(); expect(c.save).not.toHaveBeenCalled();
  });
});
