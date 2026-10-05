import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { I18nProvider } from "@/shared/i18n/I18nProvider";
import AllocationApprovalV3 from "./AllocationApprovalV3";
import { allocationFixture } from "../data/allocationApprovalV3.fixture";
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../data/allocationApprovalV3", () => ({ requestAllocationApprovalV3: (...args: unknown[]) => mocks.request(...args) }));
vi.mock("./AllocationUploadV3", () => ({ default: ({ context }: { context: Record<string, unknown> }) => <div data-testid="original-upload">{JSON.stringify(context)}</div> }));
beforeEach(() => mocks.request.mockReset().mockResolvedValue(allocationFixture().data));
const mount = (dirty = false, locale: "en" | "hr" = "en") => render(<I18nProvider initialLocale={locale}><AllocationApprovalV3 context={allocationFixture().context} dirty={dirty} /></I18nProvider>);
it("shows exact source recipients, totals and contract; requires separate approval consent", async () => {
  mount(); await screen.findByRole("checkbox"); expect(screen.getByRole("button", { name: "Approve exact allocation" })).toBeDisabled();
  expect(screen.getByText(/2800 test MON proposed/)).toBeVisible(); expect(screen.getByText(/000000000007/)).toBeVisible();
  expect(screen.getByText(/Reward contract:/)).toBeVisible();
  fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(screen.getByRole("button", { name: "Approve exact allocation" }));
  await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(2));
  expect(mocks.request.mock.calls[1][1]).toMatchObject({ expectedApprovalId: null, documentHash: allocationFixture().data.documentHash });
});
it("uncertain writes hide stale totals and retry only the same immutable request", async () => {
  mount(); await screen.findByRole("checkbox"); fireEvent.click(screen.getByRole("checkbox"));
  mocks.request.mockRejectedValueOnce(Error("private upstream")); fireEvent.click(screen.getByRole("button", { name: "Approve exact allocation" }));
  await screen.findByRole("alert"); const request = mocks.request.mock.calls[1][1];
  expect(screen.queryByText(/2800 test MON/)).not.toBeInTheDocument(); expect(screen.queryByText(/private upstream/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Recover the same review decision" }));
  await screen.findByRole("checkbox"); expect(mocks.request.mock.calls[2][1]).toEqual(request);
});
it("funding and source holds prevent consent and unsaved mapping prevents writes", async () => {
  mocks.request.mockResolvedValueOnce({ ...allocationFixture().data, reasons: ["funding_required"] });
  const v = mount(); await screen.findByRole("checkbox"); expect(screen.getByRole("checkbox")).toBeDisabled(); v.unmount();
  mount(true, "hr"); await screen.findByRole("checkbox"); expect(screen.getByRole("button", { name: "Odobri točnu raspodjelu" })).toBeDisabled();
  expect(screen.getByText(/nema isplate/)).toBeVisible();
});
it("ignores completion after the account-scoped panel unmounts", async () => {
  let done: (value: unknown) => void = () => {}; mocks.request.mockImplementationOnce(() => new Promise(resolve => done = resolve));
  const view = mount(); view.unmount(); done(allocationFixture().data);
  await waitFor(() => expect(screen.queryByRole("checkbox")).not.toBeInTheDocument());
});
it("keeps original allocation execution reachable after a hold, without using replacement preview totals", async () => {
  const f = allocationFixture(), original = f.data.document;
  mocks.request.mockResolvedValueOnce({ ...f.data, document: { ...original, recipients: [],
    binding: { ...original.binding, campaignAddress: `0x${"9".repeat(40)}` } },
    approval: { id: "8c000000-0000-4000-8000-000000001002", current: false, contextHash: "c".repeat(64),
      documentHash: f.data.documentHash, document: original, approvedAt: "2026-09-10T04:00:00Z" } });
  mount(); const child = await screen.findByTestId("original-upload"), c = JSON.parse(child.textContent!);
  expect(c.contextHash).toBe("c".repeat(64)); expect(c.campaignAddress).toBe(original.binding!.campaignAddress);
  expect(c.entitlementCount).toBe(String(original.recipients.length)); expect(c.documentHash).toBe(f.data.documentHash);
});
