import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { I18nProvider } from "@/shared/i18n/I18nProvider";
import ProgrammeExecutionStatusV3 from "./ProgrammeExecutionStatusV3";
import { executionContext, executionWire } from "../data/programmeExecutionStatusV3.fixture";
const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("../data/programmeExecutionStatusV3", () => ({ requestProgrammeExecutionStatusV3: (...args: unknown[]) => mocks.read(...args) }));
beforeEach(() => mocks.read.mockReset().mockResolvedValue(executionWire()));
const element = (dirty = false, locale: "en" | "hr" = "en", context = executionContext) => <I18nProvider initialLocale={locale}>
  <ProgrammeExecutionStatusV3 context={context} dirty={dirty} /></I18nProvider>;
const inspect = () => fireEvent.click(screen.getByRole("button", { name: "Inspect execution / refresh receipts" }));
it("loads on explicit inspection, shows confirmed progress/receipts and does not link local hashes to testnet", async () => {
  render(element()); expect(mocks.read).not.toHaveBeenCalled(); inspect();
  await screen.findByText("20 of 20 awards have confirmed upload receipts");
  expect(screen.getByRole("progressbar")).toHaveAttribute("value", "20");
  expect(screen.getAllByText("Confirmed receipt recorded")).toHaveLength(2);
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
  expect(screen.getByText(/not live balances or recipient payments/)).toBeVisible();
  fireEvent.click(screen.getAllByText("Transaction reference")[0]!);
  expect(screen.getByText(executionWire().steps[0]!.transactionHash)).toBeVisible();
});
it("unconfirmed uploads do not increase progress, and held receipts remain labelled history", async () => {
  mocks.read.mockResolvedValueOnce({ ...executionWire(false), current: false }); render(element()); inspect();
  await screen.findByText("0 of 20 awards have confirmed upload receipts");
  expect(screen.getByText(/no longer current/)).toBeVisible(); expect(screen.getByText(/Submitted · awaiting/)).toBeVisible();
  expect(screen.queryByText(/Award upload confirmed/)).not.toBeInTheDocument();
});
it("failed refresh hides all prior receipt evidence and redacts errors", async () => {
  render(element()); inspect(); await screen.findByText("20 of 20 awards have confirmed upload receipts");
  mocks.read.mockRejectedValueOnce(Error("private provider failure")); inspect(); await screen.findByRole("alert");
  expect(screen.queryByText(/20 of 20|private provider|Confirmed receipt recorded/)).not.toBeInTheDocument();
});
it("dirty rules and allocation/context changes clear prior state and discard late reads", async () => {
  let done: (v: unknown) => void = () => {};
  mocks.read.mockImplementationOnce(() => new Promise(resolve => done = resolve)); const v = render(element()); inspect();
  v.rerender(element(true)); expect(screen.getByRole("button")).toBeDisabled(); done(executionWire());
  await waitFor(() => expect(screen.queryByText(/20 of 20/)).not.toBeInTheDocument());
  v.rerender(element(false, "en", { ...executionContext, uploadId: executionContext.draftId }));
  expect(screen.getByRole("button")).toBeEnabled(); expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
});
it("uses Croatian for an empty ledger without implying a send or payout", async () => {
  mocks.read.mockResolvedValueOnce({ ...executionWire(), steps: [] }); render(element(false, "hr"));
  fireEvent.click(screen.getByRole("button", { name: "Pregledaj izvršenje / osvježi potvrde" }));
  await screen.findByText(/nema zabilježenih koraka izvršenja/);
  expect(screen.getByText(/ne potpisuje niti šalje transakciju/)).toBeVisible();
});
it("uses only a fixed testnet explorer origin when the saved network is Monad testnet", async () => {
  mocks.read.mockResolvedValueOnce({ ...executionWire(), chainId: 10143 }); render(element(false, "en", { ...executionContext, chainId: 10143 })); inspect();
  await screen.findByText("20 of 20 awards have confirmed upload receipts"); fireEvent.click(screen.getAllByText("Transaction reference")[0]!);
  expect(screen.getAllByRole("link")[0]).toHaveAttribute("href", `https://testnet.monadscan.com/tx/${executionWire().steps[0]!.transactionHash}`);
});
