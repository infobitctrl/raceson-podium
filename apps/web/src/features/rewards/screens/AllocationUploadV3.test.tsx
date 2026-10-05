import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { I18nProvider } from "@/shared/i18n/I18nProvider";
import AllocationUploadV3 from "./AllocationUploadV3";
import { uploadContext, uploadFixture } from "../data/allocationUploadV3.fixture";
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../data/allocationUploadV3", () => ({ requestAllocationUploadV3: (...args: unknown[]) => mocks.request(...args) }));
vi.mock("./RoundPublicationV3", () => ({ default: () => null }));
beforeEach(() => mocks.request.mockReset().mockResolvedValue(uploadFixture()));
const mount = (dirty = false, locale: "en" | "hr" = "en") => render(<I18nProvider initialLocale={locale}>
  <AllocationUploadV3 context={uploadContext} dirty={dirty} /></I18nProvider>);
it("requires explicit consent, saves once, shows a package reference and never says paid", async () => {
  mount(); await screen.findByRole("checkbox"); expect(screen.getByRole("button", { name: "Prepare contract awards" })).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox")); mocks.request.mockResolvedValueOnce(uploadFixture(true));
  fireEvent.click(screen.getByRole("button", { name: "Prepare contract awards" }));
  await screen.findByText(/Package saved for 20 recipients/);
  expect(mocks.request.mock.calls[1][1]).toMatchObject({ contextHash: uploadContext.contextHash, documentHash: uploadContext.documentHash });
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument(); expect(screen.getByText(/no transaction, activation or payment/)).toBeVisible();
});
it("uncertain writes hide status and recover the same request without another confirmation", async () => {
  mount(); await screen.findByRole("checkbox"); fireEvent.click(screen.getByRole("checkbox"));
  mocks.request.mockRejectedValueOnce(Error("private upstream")); fireEvent.click(screen.getByRole("button", { name: "Prepare contract awards" }));
  await screen.findByRole("alert"); const request = mocks.request.mock.calls[1][1];
  expect(screen.queryByText(/private upstream|Package saved/)).not.toBeInTheDocument();
  mocks.request.mockResolvedValueOnce(uploadFixture(true)); fireEvent.click(screen.getByRole("button", { name: "Recover the same preparation" }));
  await screen.findByText(/Package saved/); expect(mocks.request.mock.calls[2][1]).toEqual(request);
});
it("holds and dirty rules prevent writes; Croatian copy distinguishes preparation from payment", async () => {
  mocks.request.mockResolvedValueOnce({ ...uploadFixture(), current: false }); const v = mount();
  await screen.findByRole("checkbox"); expect(screen.getByRole("checkbox")).toBeDisabled(); v.unmount();
  mount(true, "hr"); await screen.findByRole("checkbox"); expect(screen.getByRole("button", { name: "Pripremi nagrade za ugovor" })).toBeDisabled();
  expect(screen.getByText(/nema transakcije, aktivacije ni isplate/)).toBeVisible();
});
it("ignores late responses after the Auth-scoped component is removed and hides old data after a failed refresh", async () => {
  let done: (value: unknown) => void = () => {};
  mocks.request.mockImplementationOnce(() => new Promise(resolve => done = resolve)); const v = mount(); v.unmount();
  done(uploadFixture(true)); await waitFor(() => expect(screen.queryByText(/Package saved/)).not.toBeInTheDocument());
  mocks.request.mockResolvedValueOnce(uploadFixture(true)); mount(); await screen.findByText(/Package saved/);
  mocks.request.mockRejectedValueOnce(Error("gone")); fireEvent.click(screen.getByRole("button", { name: "Refresh source review" }));
  await screen.findByRole("alert"); expect(screen.queryByText(/Package saved/)).not.toBeInTheDocument();
});
