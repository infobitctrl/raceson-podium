import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { I18nProvider } from "@/shared/i18n/I18nProvider";
import type { RoundPublicationViewV3 } from "@raceson/domain/rewards/round-publication-v3";
import RoundPublicationV3 from "./RoundPublicationV3";
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../data/roundPublicationV3", () => ({ requestRoundPublicationV3: (...args: unknown[]) => mocks.request(...args) }));
const id = (n: number) => `8e000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const context = { chainId: 31337, draftId: id(3), slot: 1, approvalId: id(4), uploadId: id(5), packageHash: "a".repeat(64) };
const review = { id: id(6), seconds: 86400, startedAt: "2026-09-10T15:00:00Z", endsAt: "2026-09-11T15:00:00Z" };
const fixture = (patch: Partial<RoundPublicationViewV3> = {}): RoundPublicationViewV3 => ({ ...context, supported: true, current: true,
  observedAt: "2026-09-10T16:00:00Z", review: null, publication: null, canPublish: false, ...patch });
const mount = (dirty = false, locale: "en" | "hr" = "en") => render(<I18nProvider initialLocale={locale}>
  <RoundPublicationV3 context={context} dirty={dirty} /></I18nProvider>);
beforeEach(() => mocks.request.mockReset().mockResolvedValue(fixture()));
it("starts only after explicit consent and displays server deadline without offering an early publication", async () => {
  mount(); await screen.findByRole("checkbox"); expect(screen.getByRole("button", { name: "Start platform review" })).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox")); mocks.request.mockResolvedValueOnce(fixture({ review }));
  fireEvent.click(screen.getByRole("button", { name: "Start platform review" }));
  await screen.findByText("Earliest final publication");
  expect(mocks.request.mock.calls[1][1]).toMatchObject({ action: "start", reviewId: null, packageHash: context.packageHash });
  expect(screen.getByRole("button", { name: "Publish final rehearsal results" })).toBeDisabled();
  expect(screen.getByText(/does not activate the contract or pay anyone/)).toBeVisible();
});
it("publishes only after refreshed server readiness and separate final-results confirmation", async () => {
  mocks.request.mockResolvedValueOnce(fixture({ review, canPublish: true, observedAt: review.endsAt })); mount();
  await screen.findByRole("checkbox"); expect(screen.getByRole("button", { name: "Publish final rehearsal results" })).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox")); mocks.request.mockResolvedValueOnce(fixture({ review,
    publication: { id: id(7), publishedAt: review.endsAt, evidenceHash: `0x${"b".repeat(64)}` } }));
  fireEvent.click(screen.getByRole("button", { name: "Publish final rehearsal results" }));
  await screen.findByText(/Final rehearsal publication recorded:/);
  expect(mocks.request.mock.calls[1][1]).toMatchObject({ action: "publish", reviewId: review.id });
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
});
it("uncertain decisions retain exact request and hide stale status; refresh cannot fabricate readiness", async () => {
  mount(); await screen.findByRole("checkbox"); fireEvent.click(screen.getByRole("checkbox")); mocks.request.mockRejectedValueOnce(Error("private error"));
  fireEvent.click(screen.getByRole("button", { name: "Start platform review" })); await screen.findByRole("alert");
  const request = mocks.request.mock.calls[1][1]; expect(screen.queryByText(/private error/)).not.toBeInTheDocument();
  mocks.request.mockResolvedValueOnce(fixture({ review })); fireEvent.click(screen.getByRole("button", { name: "Recover the same preparation" }));
  await screen.findByText("Earliest final publication"); expect(mocks.request.mock.calls[2][1]).toEqual(request);
  mocks.request.mockRejectedValueOnce(Error("gone")); fireEvent.click(screen.getByRole("button", { name: "Refresh source review" }));
  await screen.findByRole("alert"); expect(screen.queryByText("Earliest final publication")).not.toBeInTheDocument();
});
it("source holds, dirty settings and unsupported imports prevent action; HR state and unmount remain safe", async () => {
  mocks.request.mockResolvedValueOnce(fixture({ current: false })); let v = mount(); await screen.findByText("Previous approval is no longer current");
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument(); v.unmount();
  v = mount(true, "hr"); await screen.findByRole("checkbox"); expect(screen.getByRole("checkbox")).toBeDisabled();
  expect(screen.getByText(/Objava ne aktivira ugovor/)).toBeVisible(); v.unmount();
  mocks.request.mockResolvedValueOnce(fixture({ supported: false })); v = mount(); await screen.findByText(/verified original publication evidence/);
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument(); v.unmount();
  let done: (v: RoundPublicationViewV3) => void = () => {};
  mocks.request.mockImplementationOnce(() => new Promise(resolve => { done = resolve; })); v = mount(); v.unmount(); done(fixture({ review }));
  await waitFor(() => expect(screen.queryByText("Earliest final publication")).not.toBeInTheDocument());
});
it("a changed award context discards consent and ignores the previous context's late response", async () => {
  const view = mount(); await screen.findByRole("checkbox"); fireEvent.click(screen.getByRole("checkbox"));
  let done: (value: RoundPublicationViewV3) => void = () => {};
  mocks.request.mockImplementationOnce(() => new Promise(resolve => { done = resolve; }));
  fireEvent.click(screen.getByRole("button", { name: "Start platform review" }));
  const next = { ...context, packageHash: "b".repeat(64) };
  mocks.request.mockResolvedValueOnce(fixture({ ...next }));
  view.rerender(<I18nProvider initialLocale="en"><RoundPublicationV3 context={next} dirty={false} /></I18nProvider>);
  await screen.findByRole("checkbox"); expect(screen.getByRole("checkbox")).not.toBeChecked();
  done(fixture({ review }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Start platform review" })).toBeDisabled());
  expect(screen.queryByText("Earliest final publication")).not.toBeInTheDocument();
  expect(mocks.request.mock.calls.at(-1)?.[0]).toEqual(next);
});
