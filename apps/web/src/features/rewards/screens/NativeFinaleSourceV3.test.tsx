import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { I18nProvider } from "@/shared/i18n/I18nProvider";
import { nativeFinaleFixture } from "../data/nativeFinaleSourceV3.fixture";
import NativeFinaleSourceV3 from "./NativeFinaleSourceV3";
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../data/nativeFinaleSourceV3", () => ({ requestNativeFinaleSourceV3: (...args: unknown[]) => mocks.request(...args) }));
beforeEach(() => mocks.request.mockReset().mockResolvedValue(nativeFinaleFixture().data));
function mount(dirty = false, locale: "en" | "hr" = "en") {
  const f = nativeFinaleFixture();
  return render(<I18nProvider initialLocale={locale}><NativeFinaleSourceV3 record={f.record} bindingId={f.bindingId} dirty={dirty} /></I18nProvider>);
}
it("shows exact native rows and review evidence without offering approval, signing or payment", async () => {
  mount(); await screen.findByText("Official final source observed — prizes not approved");
  expect(screen.getByText("1 result rows · 1 reported finishes · 5000 observed finish metres")).toBeInTheDocument();
  expect(screen.getByText(nativeFinaleFixture().data.document.races[0].rows[0].athleteId)).toBeInTheDocument();
  expect(screen.getByText(/not the approved league denominator/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /approve|sign|pay/i })).not.toBeInTheDocument();
});
it("a failed refresh hides old source data and cannot display a held source as final", async () => {
  mount(); await screen.findByText("Official final source observed — prizes not approved");
  mocks.request.mockRejectedValueOnce(Error("private provider detail")); fireEvent.click(screen.getByRole("button", { name: "Refresh finale evidence" }));
  await screen.findByRole("alert"); expect(screen.queryByText(/Official final source observed/)).not.toBeInTheDocument();
  expect(screen.queryByText(/private provider detail/)).not.toBeInTheDocument();
  const f = nativeFinaleFixture(); f.data.inspection.state = "held"; f.data.inspection.holds = ["review_not_final"];
  mocks.request.mockResolvedValueOnce(f.data); fireEvent.click(screen.getByRole("button", { name: "Refresh finale evidence" }));
  await screen.findByText("Finale source is not ready"); expect(screen.getByText(/complaint\/adjudication is open/)).toBeInTheDocument();
});
it("paginates result rows in Croatian and disables refresh while saved source edits are dirty", async () => {
  const f = nativeFinaleFixture(), row = f.data.document.races[0].rows[0];
  f.data.document.races[0].rows = Array.from({ length: 26 }, (_, i) => ({ ...row, id: `8e000000-0000-4000-8000-${String(i + 100).padStart(12, "0")}`,
    athleteId: `8e000000-0000-4000-8000-${String(i + 200).padStart(12, "0")}` }));
  mocks.request.mockResolvedValueOnce(f.data); mount(true, "hr");
  await screen.findByText("Potvrđena je službena konačna objava — nagrade nisu odobrene");
  expect(screen.getByRole("button", { name: "Osvježi izvor završnice" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Prethodni rezultati" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Sljedeći rezultati" }));
  expect(screen.getAllByRole("row")).toHaveLength(2);
  expect(screen.getByRole("button", { name: "Sljedeći rezultati" })).toBeDisabled();
});
it("discards a late response after unmounting instead of leaking it into another session", async () => {
  let resolve!: (value: ReturnType<typeof nativeFinaleFixture>["data"]) => void;
  mocks.request.mockImplementationOnce(() => new Promise(r => resolve = r));
  const v = mount(); v.unmount(); await act(async () => resolve(nativeFinaleFixture().data));
  expect(screen.queryByText(/Official final source observed/)).not.toBeInTheDocument();
});
