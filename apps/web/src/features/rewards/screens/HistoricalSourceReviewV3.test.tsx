import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { I18nProvider } from "@/shared/i18n/I18nProvider";
import HistoricalSourceReviewV3 from "./HistoricalSourceReviewV3";
import { historicalFixture } from "../data/historicalSourceV3.fixture";
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../data/historicalSourceV3", () => ({ requestHistoricalSourceV3: (...args: unknown[]) => mocks.request(...args) }));
beforeEach(() => { mocks.request.mockReset().mockResolvedValue(historicalFixture().data); });
const mount = (dirty = false, locale: "en" | "hr" = "en") => render(<I18nProvider initialLocale={locale}><HistoricalSourceReviewV3 context={historicalFixture().context} dirty={dirty} /></I18nProvider>);
it("requires deliberate confirmation; saves source review, not award approval or a wallet action", async () => {
  mount(); await screen.findByText("Source not reviewed — V3 awards retained");
  expect(screen.getByRole("button", { name: "Confirm historical final source" })).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox")); mocks.request.mockResolvedValueOnce(historicalFixture("confirmed_final").data);
  fireEvent.click(screen.getByRole("button", { name: "Confirm historical final source" }));
  await screen.findByText("Source decision saved. No prizes were approved or paid.");
  expect(mocks.request.mock.calls[1][1]).toMatchObject({ slot: 1, expectedReviewId: null, decision: "confirmed_final", contextHash: "a".repeat(64) });
  expect(screen.getByText(/2800 test MON proposed/)).toBeVisible(); expect(screen.getByRole("checkbox")).not.toBeChecked();
});
it("hides stale totals after an uncertain response and recovers exactly the same request", async () => {
  mount(); await screen.findByRole("checkbox"); fireEvent.click(screen.getByRole("checkbox"));
  mocks.request.mockRejectedValueOnce(Error("offline")); fireEvent.click(screen.getByRole("button", { name: "Confirm historical final source" }));
  await screen.findByRole("alert"); const sent = mocks.request.mock.calls[1][1];
  expect(screen.queryByText(/V3 calculation:/)).not.toBeInTheDocument();
  mocks.request.mockResolvedValueOnce(historicalFixture("confirmed_final").data);
  fireEvent.click(screen.getByRole("button", { name: "Recover the same review decision" }));
  await screen.findByText("Source decision saved. No prizes were approved or paid.");
  expect(mocks.request.mock.calls[2][1]).toEqual(sent);
});
it("holds explicitly and refuses writes while mapping edits are unsaved", async () => {
  const v = mount(true); await screen.findByRole("checkbox");
  expect(screen.getByRole("button", { name: "Hold this source" })).toBeDisabled(); v.unmount();
  mount(); await screen.findByRole("checkbox"); mocks.request.mockResolvedValueOnce(historicalFixture("held").data);
  fireEvent.click(screen.getByRole("button", { name: "Hold this source" })); await screen.findByText("Source held — V3 awards retained");
  expect(mocks.request.mock.calls.at(-1)?.[1].decision).toBe("held");
});
it("shows a recoverable load error and Croatian labels with no secret/error details", async () => {
  mocks.request.mockRejectedValueOnce(Error("private upstream error")); mount(false, "hr");
  await screen.findByRole("alert"); expect(screen.queryByText(/private upstream/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Osvježi pregled izvora" }));
  await screen.findByText("Izvor nije pregledan — V3 nagrade zadržane");
  expect(screen.getByRole("button", { name: "Potvrdi povijesni službeni izvor" })).toBeDisabled();
});
it("ignores in-flight reads after the account-scoped instance is removed", async () => {
  let finish: (v: unknown) => void = () => {}; mocks.request.mockImplementationOnce(() => new Promise(resolve => finish = resolve));
  const view = mount(); view.unmount(); finish(historicalFixture().data);
  await waitFor(() => expect(screen.queryByText("Source not reviewed — V3 awards retained")).not.toBeInTheDocument());
});

it.each([undefined,"held","confirmed_final"] as const)("source-only view keeps review %s separate from legacy award controls",async decision=>{
 const f=historicalFixture(decision);mocks.request.mockResolvedValue(f.data);const onReviewed=vi.fn();
 render(<I18nProvider initialLocale="en"><HistoricalSourceReviewV3 context={f.context} dirty={false} sourceOnly onReviewed={onReviewed}/></I18nProvider>);
 await screen.findByRole("checkbox");
 expect(screen.getByText(decision==="held"?"The results team has placed this source on hold.":decision==="confirmed_final"?"The current source is confirmed.":"Final-source review has not been recorded.")).toBeVisible();
 expect(screen.queryByText(/V3 calculation:/)).not.toBeInTheDocument();
 expect(onReviewed).not.toHaveBeenCalled();expect(mocks.request).toHaveBeenCalledTimes(1);
 fireEvent.click(screen.getByRole("checkbox"));fireEvent.click(screen.getByRole("button",{name:"Confirm historical final source"}));
 await waitFor(()=>expect(onReviewed).toHaveBeenCalledTimes(1));
});
it("identifies a stale source decision before confirmation",async()=>{
 const f=historicalFixture("confirmed_final");f.data.decisions[0].current=false;mocks.request.mockResolvedValue(f.data);
 render(<I18nProvider initialLocale="en"><HistoricalSourceReviewV3 context={f.context} dirty={false} sourceOnly/></I18nProvider>);
 expect(await screen.findByText("The saved source review is out of date.")).toBeVisible();
 expect(screen.getByRole("button",{name:"Confirm historical final source"})).toBeDisabled();
});
