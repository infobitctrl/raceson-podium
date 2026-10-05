import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/shared/i18n/I18nProvider";
import { messagesByLocale as messages, type TranslationKey } from "@/shared/i18n/messages";
import { recordWorkspaceFixture } from "../../../../../api/test/fixtures/reward-record-workspace.mjs";
import { comparisonChoices } from "../model/organizerRecords";
import OrganizerRecords from "./OrganizerRecords";
const c = vi.hoisted(() => ({ read: vi.fn(), list: vi.fn(), capture: vi.fn(), preview: vi.fn(), approve: vi.fn(), withdraw: vi.fn(),
  record: vi.fn(), selected: vi.fn(), back: vi.fn(), access: vi.fn(), wallet: vi.fn() }));
vi.mock("../data/organizerRecords", () => ({ getOrganizerRecordWorkspace: c.read, listOrganizerRecordRaces: c.list, captureOrganizerRecord: c.capture,
  previewOrganizerRecord: c.preview, approveOrganizerRecord: c.approve, withdrawOrganizerRecord: c.withdraw }));
vi.mock("../data/organizerSporting", () => ({ getOrganizerSportingRecord: c.record }));
let h: Awaited<ReturnType<typeof recordWorkspaceFixture>>, locale: "en" | "hr";
const label = (key: string) => messages[locale][`rewards.records.${key}` as TranslationKey];
const button = (key: string) => screen.getByRole("button", { name: label(key) });
function mount(l: "en" | "hr" = "en") {
  locale = l; return render(<I18nProvider initialLocale={l}><OrganizerRecords selection={{ ...h.scope, chainId: 31337 }} raceId={h.draft.targetRaceId} gender="M"
    onBack={c.back} onSelected={c.selected} onAccessLost={c.access} /></I18nProvider>);
}
async function inspect() {
  fireEvent.change(await screen.findByLabelText(label("chooseRace")), { target: { value: h.capture.priorRaceId } });
  await act(async () => fireEvent.click(button("inspect")));
  await screen.findByRole("region", { name: label("baseline") });
}
async function fill() {
  await inspect(); const comparison = screen.getByRole("group", { name: label("comparison") });
  fireEvent.click(screen.getByRole("radio", { name: /Synthetic prior runner 1/ }));
  for (const key of comparisonChoices) fireEvent.change(within(comparison).getByLabelText(label(key)), { target: { value: h.f.comparison[key] } });
  for (const checkbox of within(comparison).getAllByRole("checkbox")) fireEvent.click(checkbox);
  fireEvent.change(within(comparison).getByLabelText(label("rationale")), { target: { value: h.f.comparison.rationale } });
  await act(async () => fireEvent.click(button("preview")));
  await screen.findByRole("region", { name: label("previewTitle") });
}
async function approve() {
  fireEvent.click(screen.getByLabelText(label("confirmApproval")));
  await act(async () => fireEvent.click(button("approve")));
}
beforeEach(async () => {
  h = await recordWorkspaceFixture(); locale = "en"; Object.values(c).forEach(fn => fn.mockReset());
  c.read.mockImplementation((_s, prior = null, after = null) => h.read(prior, after)); c.list.mockResolvedValue(h.racePage);
  c.capture.mockResolvedValue(h.capture); c.preview.mockImplementation((_s, request) => h.preview(request)); c.record.mockResolvedValue(h.record);
  c.approve.mockImplementation(async () => { h.bundle.latestApprovals = [h.latest]; return h.saved; });
  c.withdraw.mockResolvedValue(h.withdrawal);
  Object.defineProperty(window, "ethereum", { configurable: true, value: { request: c.wallet } });
});
describe("organizer prior-record review", () => {
  it.each(["en", "hr"] as const)("explicit comparison, preview, approval and fresh verified selection in %s", async l => {
    mount(l); await fill(); expect(c.capture).not.toHaveBeenCalled(); expect(c.approve).not.toHaveBeenCalled();
    expect(button("approve")).toBeDisabled(); expect(c.preview.mock.calls[0][1]).toEqual(h.draft);
    await approve(); await screen.findByRole("heading", { name: label("saved") });
    expect(c.approve.mock.calls[0][1]).toMatchObject({ ...h.draft, confirmApproval: true, previewDigest: h.verified.previewDigest });
    await act(async () => fireEvent.click(button("use"))); expect(c.selected).toHaveBeenCalledWith(h.record);
    expect(c.read).toHaveBeenLastCalledWith({ ...h.scope, chainId: 31337 }); expect(c.wallet).not.toHaveBeenCalled();
  });
  it("does not preselect a performance, timing or human review evidence", async () => {
    mount(); await inspect(); expect(screen.getAllByRole("radio").every(r => !(r as HTMLInputElement).checked)).toBe(true);
    const group = screen.getByRole("group", { name: label("comparison") });
    expect(within(group).getAllByRole("combobox").every(e => !(e as HTMLSelectElement).value)).toBe(true);
    expect(within(group).getAllByRole("checkbox").every(e => !(e as HTMLInputElement).checked)).toBe(true);
    await act(async () => fireEvent.click(button("preview"))); await screen.findByRole("alert"); expect(c.preview).not.toHaveBeenCalled();
  });
  it("captures only on consent and freezes the original uncertain request for retry", async () => {
    c.capture.mockRejectedValueOnce({ status: 503 }); mount();
    fireEvent.change(await screen.findByLabelText(label("chooseRace")), { target: { value: h.capture.priorRaceId } });
    expect(button("capture")).toBeDisabled(); fireEvent.click(screen.getByLabelText(label("captureConfirm")));
    await act(async () => fireEvent.click(button("capture"))); await screen.findByRole("alert");
    expect(screen.getByLabelText(label("chooseRace"))).toBeDisabled();
    await act(async () => fireEvent.click(button("retry"))); await screen.findByRole("region", { name: label("baseline") });
    expect(c.capture.mock.calls[1]).toEqual(c.capture.mock.calls[0]); expect(c.approve).not.toHaveBeenCalled();
  });
  it("does not offer to repeat a known-saved capture when only its following read fails", async () => {
    mount(); fireEvent.change(await screen.findByLabelText(label("chooseRace")), { target: { value: h.capture.priorRaceId } });
    c.read.mockRejectedValueOnce({ status: 503 }); fireEvent.click(screen.getByLabelText(label("captureConfirm")));
    await act(async () => fireEvent.click(button("capture"))); await screen.findByRole("alert");
    expect(screen.queryByRole("button", { name: label("retry") })).not.toBeInTheDocument(); expect(button("inspect")).toBeEnabled();
  });
  it("invalidates a verified preview and consent after an editable comparison changes", async () => {
    mount(); await fill(); fireEvent.click(screen.getByLabelText(label("confirmApproval")));
    fireEvent.change(screen.getByLabelText(label("rationale")), { target: { value: "A newly reviewed comparison rationale" } });
    expect(screen.queryByRole("region", { name: label("previewTitle") })).not.toBeInTheDocument(); expect(c.approve).not.toHaveBeenCalled();
  });
  it("freezes exact approval through a lost response and preserves consent separately from payment", async () => {
    c.approve.mockRejectedValueOnce({ status: 503 }); mount(); await fill(); await approve(); await screen.findByRole("alert");
    expect(screen.getByLabelText(label("rationale"))).toBeDisabled(); const original = structuredClone(c.approve.mock.calls[0]);
    await act(async () => fireEvent.click(button("retry"))); await screen.findByRole("heading", { name: label("saved") });
    expect(c.approve.mock.calls[1]).toEqual(original); expect(c.wallet).not.toHaveBeenCalled();
  });
  it("withdraws only with a reason and explicit consent and retries the original uncertain withdrawal", async () => {
    h.bundle.latestApprovals = [h.latest]; c.withdraw.mockRejectedValueOnce({ status: 503 }); mount(); await screen.findByRole("button", { name: label("use") });
    fireEvent.click(screen.getByText(label("withdraw"), { selector: "summary" }));
    expect(button("withdraw")).toBeDisabled(); fireEvent.change(screen.getByLabelText(label("reason")), { target: { value: "Synthetic route mismatch" } });
    fireEvent.click(screen.getByLabelText(label("withdrawConfirm"))); await act(async () => fireEvent.click(button("withdraw")));
    await screen.findByRole("alert"); expect(screen.getByLabelText(label("reason"))).toBeDisabled();
    await act(async () => fireEvent.click(button("retry"))); expect(await screen.findByText(label("withdrawn"))).toBeVisible();
    expect(c.withdraw.mock.calls[1]).toEqual(c.withdraw.mock.calls[0]); expect(screen.queryByRole("button", { name: label("use") })).not.toBeInTheDocument();
    expect(screen.getByText(label("withdrawnHelp"))).toBeVisible(); expect(c.wallet).not.toHaveBeenCalled();
  });
  it.each([401, 403, 409])("clears private evidence and uncertain drafts on %s", async status => {
    c.approve.mockRejectedValue({ status }); mount(); await fill(); await approve(); await screen.findByRole("alert");
    expect(screen.queryByRole("region", { name: label("baseline") })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: label("retry") })).not.toBeInTheDocument();
    expect(c.access).toHaveBeenCalledTimes(status === 409 ? 0 : 1);
  });
  it("refuses a selection when the latest approval changed before use", async () => {
    h.bundle.latestApprovals = [h.latest]; mount(); await screen.findByRole("button", { name: label("use") }); h.bundle.latestApprovals = [];
    await act(async () => fireEvent.click(button("use"))); await screen.findByRole("alert"); expect(c.record).not.toHaveBeenCalled(); expect(c.selected).not.toHaveBeenCalled();
  });
  it.each(["withdrawn", "older"] as const)("does not offer a %s approval for use", async kind => {
    h.bundle.latestApprovals = [{ ...h.latest, ...(kind === "withdrawn" ? { withdrawnAt: h.withdrawal.withdrawnAt } : { snapshotId: h.draft.priorSnapshotId }) }];
    mount(); await screen.findByText(label(kind === "withdrawn" ? "withdrawn" : "olderSource"));
    expect(screen.queryByRole("button", { name: label("use") })).not.toBeInTheDocument();
  });
  it("ignores a late verified selection after unmount", async () => {
    h.bundle.latestApprovals = [h.latest]; let done!: (v: unknown) => void; c.record.mockImplementation(() => new Promise(resolve => { done = resolve; }));
    const mounted = mount(); await screen.findByRole("button", { name: label("use") }); await act(async () => fireEvent.click(button("use")));
    mounted.unmount(); await act(async () => done(h.record)); expect(c.selected).not.toHaveBeenCalled();
  });
});
