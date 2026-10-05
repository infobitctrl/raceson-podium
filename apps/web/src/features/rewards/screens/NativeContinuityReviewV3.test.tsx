import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { I18nProvider } from "@/shared/i18n/I18nProvider";
import { nativeContinuityUiFixture } from "../data/nativeContinuityV3.fixture";
import NativeContinuityReviewV3 from "./NativeContinuityReviewV3";
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../data/nativeContinuityV3", () => ({ requestNativeContinuityV3: (...args: unknown[]) => mocks.request(...args) }));
beforeEach(() => mocks.request.mockReset().mockResolvedValue(nativeContinuityUiFixture().data));
function mount(locale: "en" | "hr" = "en", dirty = false) { const f = nativeContinuityUiFixture();
  return render(<I18nProvider initialLocale={locale}><NativeContinuityReviewV3 record={f.record} bindingId={f.bindingId} dirty={dirty} /></I18nProvider>); }
async function select() {
  const { id } = nativeContinuityUiFixture(); await screen.findByText("No saved sporting review");
  fireEvent.change(screen.getByLabelText("Historical athlete for Synthetic Ana"), { target: { value: `historical:${id(20)}` } });
  fireEvent.change(screen.getByLabelText("Historical athlete for Synthetic Luka"), { target: { value: `new_native:${id(11)}` } });
  fireEvent.change(screen.getByLabelText("Historical club for Synthetic club"), { target: { value: `historical:${id(21)}` } });
  fireEvent.change(screen.getByLabelText("Prize category for Synthetic Ana"), { target: { value: id(30) } });
  fireEvent.click(screen.getByRole("checkbox"));
}
it("requires explicit athlete/club/category choices and confirmation; no wallet/profile claim", async () => {
  mount(); await screen.findByText("No saved sporting review"); expect(screen.getByRole("button", { name: "Confirm sporting mappings" })).toBeDisabled();
  expect(screen.getAllByRole("combobox").every(e => (e as HTMLSelectElement).value === "")).toBe(true);
  expect(screen.queryByRole("button", { name: /wallet|pay|claim/i })).not.toBeInTheDocument();
  await select(); expect(screen.getByRole("button", { name: "Confirm sporting mappings" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Confirm sporting mappings" }));
  await screen.findByText(/Decision saved/); const change = mocks.request.mock.calls[1][2];
  expect(change.decision).toBe("confirmed"); expect(change.selection.athletes).toHaveLength(2); expect(change.selection.clubs).toHaveLength(1);
  expect(change.selection.classifications).toHaveLength(1); expect(change).not.toHaveProperty("amount");
});
it("hides stale data after uncertain save and retries exactly without replacing a later hold", async () => {
  mount(); await select(); mocks.request.mockRejectedValueOnce(Error("private detail"));
  fireEvent.click(screen.getByRole("button", { name: "Confirm sporting mappings" })); await screen.findByRole("alert");
  expect(screen.queryByText("Synthetic Ana")).not.toBeInTheDocument(); expect(screen.queryByText(/private detail/)).not.toBeInTheDocument();
  const request = mocks.request.mock.calls[1][2], f = nativeContinuityUiFixture();
  mocks.request.mockResolvedValueOnce({ ...f.data, reviewState: "held", review: { id: f.id(60), previousReviewId: request.requestId,
    contextHash: request.contextHash, selection: request.selection, decision: "held", reviewedAt: "2026-09-10T05:00:00.000Z" } });
  fireEvent.click(screen.getByRole("button", { name: "Retry the same save" })); await screen.findByText("Sporting mappings held");
  expect(mocks.request.mock.calls[2][2]).toEqual(request);
});
it("can save a partial hold, disables dirty writes and renders Croatian", async () => {
  const v = mount(); await screen.findByText("No saved sporting review");
  fireEvent.click(screen.getByRole("button", { name: "Save choices on hold" })); await screen.findByText(/Decision saved/);
  expect(mocks.request.mock.calls[1][2].selection.athletes).toHaveLength(0); expect(mocks.request.mock.calls[1][2].decision).toBe("held");
  v.unmount(); mount("hr", true); await screen.findByText("Nema spremljenog sportskog pregleda");
  expect(screen.getByRole("button", { name: "Spremi odabire uz zadržavanje" })).toBeDisabled();
});
it("discards a response from an unmounted review scope", async () => {
  let resolve!: (value: unknown) => void; mocks.request.mockImplementationOnce(() => new Promise(r => resolve = r));
  const v = mount(); v.unmount(); await act(async () => resolve(nativeContinuityUiFixture().data));
  expect(screen.queryByText("Synthetic Ana")).not.toBeInTheDocument();
});
