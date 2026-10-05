import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultRewardProgrammeDraftV2, type SavedRewardPlanningDraft } from "@raceson/domain/rewards/programme-draft-v2";
import { emptyProgrammeFundingV3 } from "@raceson/domain/rewards/programme-funding-v3";
import { I18nProvider } from "@/shared/i18n/I18nProvider";
import OrganizerProgrammeOverview from "./OrganizerProgrammeOverview";
const mock = vi.hoisted(() => ({ read: vi.fn(), navigate: vi.fn() }));
vi.mock("../data/programmeFundingV3", () => ({ readProgrammeFundingV3: (...args: unknown[]) => mock.read(...args) }));
const record: SavedRewardPlanningDraft = { draftId: "86000000-0000-4000-8000-000000000005", organizationId: "86000000-0000-4000-8000-000000000002",
  seasonId: "86000000-0000-4000-8000-000000000004", chainId: 31337, organizationName: "Fixture organization", seasonName: "Fixture league",
  revision: 1, updatedAt: "2026-09-09T12:00:00Z", rules: createDefaultRewardProgrammeDraftV2() };
const tree = (r = record) => <I18nProvider initialLocale="en"><OrganizerProgrammeOverview record={r} navigate={mock.navigate} /></I18nProvider>;
beforeEach(() => { mock.read.mockReset().mockResolvedValue(emptyProgrammeFundingV3(record)); mock.navigate.mockReset(); });
describe("organizer programme overview", () => {
  it("shows six planned pots and a funding next step without inventing zero observations", async () => {
    render(tree()); await waitFor(() => expect(screen.getByRole("button", { name: "Refresh overview" })).toBeEnabled());
    expect(screen.getAllByText("100,000 test MON")[0]).toBeVisible();
    expect(screen.getAllByRole("row")).toHaveLength(7);
    expect(screen.queryByText("0 test MON")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Funding & contract" })); expect(mock.navigate).toHaveBeenCalledWith("funding");
  });
  it("ignores an old request after the saved revision changes", async () => {
    let resolve!: (value: unknown) => void;
    mock.read.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const view = render(tree()); const next = { ...record, revision: 2, rules: { ...record.rules, budgetMon: "120000" } };
    mock.read.mockResolvedValueOnce(emptyProgrammeFundingV3(next)); view.rerender(tree(next));
    await waitFor(() => expect(screen.getByRole("button", { name: "Refresh overview" })).toBeEnabled());
    await act(async () => resolve(emptyProgrammeFundingV3(record)));
    expect(screen.getAllByText("120,000 test MON")[0]).toBeVisible();
    expect(screen.queryByText("100,000 test MON")).not.toBeInTheDocument();
  });
  it("offers a retry after a failed observation without exposing provider details", async () => {
    mock.read.mockRejectedValueOnce(new Error("private provider detail")); render(tree());
    expect(await screen.findByRole("alert")).toBeVisible(); expect(screen.queryByText("private provider detail")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Refresh overview" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });
});

vi.mock("../components/DistributionFlowChart", () => ({default:()=>null}));
