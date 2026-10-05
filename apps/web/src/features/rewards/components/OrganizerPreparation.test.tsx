import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/shared/i18n/I18nProvider";
import OrganizerPreparation from "./OrganizerPreparation";
import { preparationFixture } from "../../../../../api/test/fixtures/reward-preparation.mjs";
const c = vi.hoisted(() => ({ read: vi.fn(), reserve: vi.fn(), back: vi.fn(), access: vi.fn(), wallet: vi.fn() }));
vi.mock("../data/organizerPreparation", () => ({ getOrganizerPreparation: c.read, reserveOrganizerAllocation: c.reserve }));
function mount(locale: "en" | "hr" = "en") {
  const f = preparationFixture();
  return render(<I18nProvider initialLocale={locale}><OrganizerPreparation selection={{ ...f.selection, chainId: 31337 }}
    raceName="Synthetic round" onBack={c.back} onAccessLost={c.access} /></I18nProvider>);
}
async function confirm(locale: "en" | "hr" = "en") {
  const checkbox = await screen.findByRole("checkbox");
  await act(async () => {
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole("button", { name: locale === "en" ? "Reserve these awards" : "Rezerviraj ove nagrade" }));
  });
}
beforeEach(() => {
  const f = preparationFixture(); c.read.mockReset().mockResolvedValue(f.view); c.reserve.mockReset().mockResolvedValue(f.receipt);
  c.back.mockReset(); c.access.mockReset(); c.wallet.mockReset();
  Object.defineProperty(window, "ethereum", { configurable: true, value: { request: c.wallet } });
});
describe("organizer preparation consent and recovery", () => {
  it.each(["en", "hr"] as const)("shows reviewed shares in %s and reserves only after explicit confirmation", async locale => {
    mount(locale); await screen.findByText("Synthetic runner");
    const button = screen.getByRole("button", { name: locale === "en" ? "Reserve these awards" : "Rezerviraj ove nagrade" });
    expect(button).toBeDisabled(); expect(screen.getByRole("checkbox")).not.toBeChecked(); expect(c.reserve).not.toHaveBeenCalled();
    expect(screen.getByText(locale === "en" ? /All eligible unclaimed and held shares/ : /Uključeni su svi priznati udjeli/)).toBeVisible();
    await confirm(locale); await screen.findByText(locale === "en" ? "Allocation reserved" : "Raspodjela je rezervirana");
    expect(c.reserve).toHaveBeenCalledOnce(); const [scope, body] = c.reserve.mock.calls[0];
    expect(scope).toEqual(preparationFixture().selection); expect(body).toEqual({ ...preparationFixture().request, idempotencyKey: expect.any(String) });
    expect(Object.keys(body).sort()).toEqual(["confirmAllocation", "idempotencyKey", "previewDigest", "reviewId"]);
    expect(screen.getByText(locale === "en" ? /No tokens were sent/ : /Tokeni nisu poslani/)).toBeVisible();
    expect(screen.queryByText("Synthetic runner")).not.toBeInTheDocument(); expect(c.wallet).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: locale === "en" ? "View saved allocation" : "Pogledaj spremljenu raspodjelu" })); expect(c.back).toHaveBeenCalledOnce();
  });
  it("retries the identical confirmation after an uncertain response without allowing a new decision", async () => {
    c.reserve.mockRejectedValueOnce({ status: 503, message: "private diagnostic" }); mount(); await confirm(); await screen.findByRole("alert");
    const original = structuredClone(c.reserve.mock.calls[0]); expect(screen.getByRole("checkbox")).toBeDisabled();
    expect(screen.queryByText("private diagnostic")).not.toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Retry the same reservation" }))); await screen.findByText("Allocation reserved");
    expect(c.reserve.mock.calls[1]).toEqual(original); expect(c.reserve).toHaveBeenCalledTimes(2);
  });
  it("clears stale preview and consent on refresh, and distinguishes no review from already reserved", async () => {
    mount(); fireEvent.click(await screen.findByRole("checkbox"));
    const f = preparationFixture(); c.read.mockResolvedValue({ ...f.view, stage: "awaiting_review", preview: null });
    fireEvent.click(screen.getByRole("button", { name: "Refresh" })); expect(screen.queryByText("Synthetic runner")).not.toBeInTheDocument();
    await screen.findByText(/No sporting review has been saved/); expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    c.read.mockResolvedValue({ ...f.view, stage: "reserved", allocationId: f.receipt.allocationId, preview: null });
    fireEvent.click(screen.getByRole("button", { name: "Refresh" })); await screen.findByText(/This campaign already has a saved allocation/);
    expect(c.reserve).not.toHaveBeenCalled();
  });
  it("invalidates an obsolete decision on conflict, without offering an exact retry", async () => {
    c.reserve.mockRejectedValue({ status: 409 }); mount(); await confirm(); await screen.findByRole("alert");
    expect(screen.queryByText("Synthetic runner")).not.toBeInTheDocument(); expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry the same reservation" })).not.toBeInTheDocument();
  });
  it.each([401, 403])("escalates lost access %s to the parent workspace", async status => {
    c.reserve.mockRejectedValue({ status }); mount(); await confirm(); await waitFor(() => expect(c.access).toHaveBeenCalledWith({ status }));
  });
  it("ignores a late reservation response after the session-owned component is unmounted", async () => {
    let finish!: (v: unknown) => void; c.reserve.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const view = mount(); await confirm(); await waitFor(() => expect(finish).toBeTypeOf("function")); view.unmount();
    await act(async () => finish(preparationFixture().receipt)); expect(c.access).not.toHaveBeenCalled(); expect(c.back).not.toHaveBeenCalled();
    expect(screen.queryByText("Allocation reserved")).not.toBeInTheDocument();
  });
  it("does not combine pages from different saved-review calculations", async () => {
    const f = preparationFixture(); f.view.preview.nextCursor = f.view.preview.items[0].key; c.read.mockResolvedValueOnce(f.view);
    c.read.mockResolvedValue({ ...f.view, preview: { ...f.view.preview, previewDigest: "b".repeat(64), nextCursor: null } });
    mount(); fireEvent.click(await screen.findByRole("button", { name: "Show more allocations" })); await screen.findByRole("alert");
    expect(screen.queryByText("Synthetic runner")).not.toBeInTheDocument(); expect(c.reserve).not.toHaveBeenCalled();
  });
});
