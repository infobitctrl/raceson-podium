import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { I18nProvider } from "@/shared/i18n/I18nProvider";
import ProgrammeActionsV3 from "./ProgrammeActionsV3";
import { actionsContext as context, actionsFixture, activationActionsFixture, actionFees } from "../data/programmeActionsV3.fixture";
const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("../data/programmeActionsV3", () => ({ requestProgrammeActionsV3: (...args: unknown[]) => mocks.read(...args) }));
beforeEach(() => mocks.read.mockReset().mockResolvedValue(actionsFixture()));
const element = (dirty = false, locale: "en" | "hr" = "en", ctx = context) => <I18nProvider initialLocale={locale}><ProgrammeActionsV3 context={ctx} dirty={dirty} /></I18nProvider>;
const inspect = () => fireEvent.click(screen.getByRole("button", { name: "Inspect available contract action" }));
it("loads only on inspection, requires consent, and saves a closure with visible proposed gas ceilings", async () => {
  render(element()); expect(mocks.read).not.toHaveBeenCalled(); inspect(); await screen.findByRole("checkbox");
  expect(screen.getByRole("button", { name: "Prepare this contract action" })).toBeDisabled();
  expect(screen.getByText(/not a live gas estimate/)).toBeVisible(); expect(screen.getByText(/0.6 test MON/)).toBeVisible();
  fireEvent.click(screen.getByRole("checkbox")); mocks.read.mockResolvedValueOnce(actionsFixture("reserved"));
  fireEvent.click(screen.getByRole("button", { name: "Prepare this contract action" }));
  await screen.findByText("Prepared · awaiting operator signature");
  expect(mocks.read.mock.calls[1]![1]).toMatchObject({ kind: "prepare", expectedPredecessorId: null, packageHash: context.packageHash, fees: actionFees });
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument(); expect(screen.getByText(/separately configured private runtime/)).toBeVisible();
});
it("fee edits revoke consent and invalid ceilings cannot be prepared", async () => {
  render(element()); inspect(); await screen.findByRole("checkbox"); fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.change(screen.getByLabelText("Maximum gas units"), { target: { value: "0" } });
  expect(screen.getByRole("checkbox")).not.toBeChecked(); expect(screen.getByRole("checkbox")).toBeDisabled();
  expect(screen.getByRole("button", { name: "Prepare this contract action" })).toBeDisabled();
  expect(screen.getByText(/Enter valid whole-number/)).toBeVisible();
});
it("lost write replies hide stale evidence and retry the identical request once", async () => {
  render(element()); inspect(); await screen.findByRole("checkbox"); fireEvent.click(screen.getByRole("checkbox"));
  mocks.read.mockRejectedValueOnce(Error("private upstream")); fireEvent.click(screen.getByRole("button", { name: "Prepare this contract action" }));
  await screen.findByRole("alert"); const request = mocks.read.mock.calls[1]![1];
  expect(screen.queryByText(/private upstream/)).not.toBeInTheDocument(); expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  mocks.read.mockResolvedValueOnce(actionsFixture("reserved")); fireEvent.click(screen.getByRole("button", { name: "Recover the same action request" }));
  await screen.findByText("Prepared · awaiting operator signature"); expect(mocks.read.mock.calls[2]![1]).toEqual(request);
});
it("queues only the exact saved signature after separate consent and never presents queueing as confirmation", async () => {
  mocks.read.mockResolvedValueOnce(actionsFixture("signed")); render(element()); inspect(); await screen.findByRole("checkbox");
  fireEvent.click(screen.getByText("Saved action and transaction limits"));
  expect(screen.getByText(actionsFixture("signed").execution.steps[0]!.transactionHash!)).toBeVisible();
  expect(screen.getByRole("button", { name: "Queue the saved transaction" })).toBeDisabled(); fireEvent.click(screen.getByRole("checkbox"));
  mocks.read.mockResolvedValueOnce(actionsFixture("queued")); fireEvent.click(screen.getByRole("button", { name: "Queue the saved transaction" }));
  await screen.findByText("Queued · no confirmed receipt");
  expect(mocks.read.mock.calls[1]![1]).toMatchObject({ kind: "queue", intentId: actionsFixture("signed").selected!.intentId,
    attemptId: actionsFixture("signed").selected!.attemptId, transactionHash: actionsFixture("signed").execution.steps[0]!.transactionHash });
  expect(screen.getByText(/An explicit operator run is still required/)).toBeVisible();
  expect(screen.getByRole("button", { name: "Refresh execution status" })).toBeEnabled();
  expect(screen.queryByRole("button", { name: "Schedule the queued transaction" })).not.toBeInTheDocument();
});
it("confirmed closure offers the upload batch while holds and dirty/context changes prevent further actions", async () => {
  mocks.read.mockResolvedValueOnce(actionsFixture("confirmed")); const v = render(element()); inspect(); await screen.findByRole("checkbox");
  expect(screen.getByText("Upload awards 1–20")).toBeVisible();
  const held = actionsFixture("confirmed"); held.execution.current = false; mocks.read.mockResolvedValueOnce(held); inspect();
  await screen.findByText(/no longer current/); expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  expect(screen.queryByText(/Award upload confirmed/)).not.toBeInTheDocument();
  v.rerender(element(true)); expect(screen.getByRole("button")).toBeDisabled(); expect(screen.queryByText(/no longer current/)).not.toBeInTheDocument();
});
it("discards late reads after an allocation switch and renders Croatian preparation controls", async () => {
  let done: (v: unknown) => void = () => {}; mocks.read.mockImplementationOnce(() => new Promise(resolve => done = resolve));
  const v = render(element()); inspect(); v.rerender(element(false, "en", { ...context, uploadId: context.draftId }));
  done(actionsFixture("signed")); await waitFor(() => expect(screen.queryByRole("checkbox")).not.toBeInTheDocument()); v.unmount();
  render(element(false, "hr")); fireEvent.click(screen.getByRole("button", { name: "Pregledaj dostupnu radnju ugovora" }));
  await screen.findByRole("checkbox"); expect(screen.getByRole("button", { name: "Pripremi ovu radnju ugovora" })).toBeDisabled();
  expect(screen.getByText(/Ovdje nema stvaranja novčanika/)).toBeVisible();
});
it("does not offer staging without final publication, even after the review clock has elapsed", async () => {
  mocks.read.mockResolvedValueOnce(activationActionsFixture("review")); render(element()); inspect();
  await screen.findByText(/Time passing alone/); expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  expect(screen.getByRole("list", { name: "Distribution progress" })).toHaveTextContent("Awards uploaded");
  expect(screen.getAllByText("Confirmed in saved records")).toHaveLength(1);
});
it("offers exact publication-bound staging then activation, with no extra review or payout claim", async () => {
  mocks.read.mockResolvedValueOnce(activationActionsFixture("published")); render(element()); inspect();
  await screen.findByText("Commit final allocation to the contract");
  expect(screen.getAllByText("Confirmed in saved records")).toHaveLength(2);
  expect(screen.getByRole("button", { name: "Prepare this contract action" })).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox"));
  const reserved = activationActionsFixture("staged"); reserved.execution.steps.at(-1)!.state = "reserved";
  reserved.execution.steps.at(-1)!.receipt = null; reserved.execution.steps.at(-1)!.transactionHash = null;
  reserved.selected!.attemptId = null; reserved.selected!.jobId = null;
  mocks.read.mockResolvedValueOnce(reserved); fireEvent.click(screen.getByRole("button", { name: "Prepare this contract action" }));
  await screen.findByText("Prepared · awaiting operator signature");
  expect(mocks.read.mock.calls[1]![1]).not.toHaveProperty("publication");
  mocks.read.mockResolvedValueOnce(activationActionsFixture("staged")); inspect();
  await screen.findByText("Activate the approved allocation"); expect(screen.getByText(/without another review period/)).toBeVisible();
  mocks.read.mockResolvedValueOnce(activationActionsFixture("activated")); inspect();
  await screen.findByText(/This is not a payout receipt/); expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  expect(screen.getAllByText("Confirmed in saved records")).toHaveLength(4);
  mocks.read.mockRejectedValueOnce(Error("unavailable")); inspect(); await screen.findByRole("alert");
  expect(screen.queryByText(/Contract activation confirmed/)).not.toBeInTheDocument();
});
