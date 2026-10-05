import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { createDefaultRewardProgrammeDraftV2, type SavedRewardPlanningDraft } from "@raceson/domain/rewards/programme-draft-v2";
import { emptyRewardSourceMappingV2, type RewardMappingWorkspaceV2 } from "@raceson/domain/rewards/source-mapping-v2";
import { I18nProvider } from "@/shared/i18n/I18nProvider";
import ProgrammeSourceMapping from "./ProgrammeSourceMapping";
const mocks = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn() }));
vi.mock("../data/sourceMapping", () => ({ readSourceMapping: () => mocks.read(), saveSourceMapping: (...args: unknown[]) => mocks.save(...args) }));
const id = (n: number) => `83000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const record: SavedRewardPlanningDraft = { draftId: id(1), organizationId: id(2), seasonId: id(3), chainId: 31337, revision: 11,
  organizationName: "Synthetic org", seasonName: "Synthetic season", updatedAt: "2026-09-09T12:00:00Z", rules: createDefaultRewardProgrammeDraftV2() };
const workspace = (): RewardMappingWorkspaceV2 => ({ draftId: record.draftId, revision: 0, rulesRevision: 11, catalogueHash: "a".repeat(64), boundCatalogueHash: null,
  mapping: emptyRewardSourceMappingV2(), catalogue: { rounds: [{ id: id(4), editionId: id(5), slot: 1, name: "Synthetic round", date: "2026-09-01", status: "draft", races: [] }],
    categories: [{ id: id(6), competitionId: id(7), competitionName: "Long", name: "Female", target: "individual", eligibility: { demoOnly: true } },
      { id: id(8), competitionId: id(9), competitionName: "Clubs", name: "Overall", target: "club", eligibility: { demoOnly: true } }] } });
function mount() { return render(<I18nProvider initialLocale="en"><MemoryRouter><ProgrammeSourceMapping record={record} /></MemoryRouter></I18nProvider>); }
beforeEach(() => { mocks.read.mockReset().mockResolvedValue(workspace()); mocks.save.mockReset().mockImplementation(async (_r, w, m) => ({ ...w, mapping: m, revision: w.revision + 1, boundCatalogueHash: w.catalogueHash })); });
describe("v2 source mapping", () => {
  it("shows pending slots, source IDs and unassigned budgets without inventing results", async () => {
    mount(); await screen.findByText("Mapping revision 0 · Rules revision 11");
    expect(screen.getAllByText("No race is bound to this reward pot.")).toHaveLength(5);
    expect(screen.getByText(/Unassigned: 8000 test MON/)).toBeVisible();
    expect(screen.getByRole("link", { name: "Open league setup" })).toHaveAttribute("href", `/organizer/leagues/${record.seasonId}`);
    fireEvent.change(screen.getByRole("combobox", { name: "Round 1" }), { target: { value: id(4) } });
    expect(screen.getByText("No races linked to competitions")).toBeVisible();
    expect(screen.getByRole("combobox", { name: "Round 5" })).toHaveValue("");
  });
  it("persists per-pot category shares, preserves unassigned balance and shows exact prize slots", async () => {
    mount(); const share = await screen.findByRole("spinbutton", { name: "Long · Female (%)" });
    fireEvent.change(share, { target: { value: "50" } });
    expect(screen.getByText(/Unassigned: 4000 test MON/)).toBeVisible();
    const section = share.closest("fieldset")!;
    fireEvent.click(within(section).getByText("Source rules and prize slots"));
    expect(within(section).getByRole("table").querySelectorAll("tbody tr")).toHaveLength(10);
    expect(within(section).getByText("1400")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Save source mapping" }));
    expect(await screen.findByText(/Mapping saved in the isolated/)).toBeVisible();
    expect(mocks.save.mock.calls[0][2].rounds[0].categories).toEqual([{ categoryId: id(6), shareBps: 5000 }]);
    expect(screen.getByRole("button", { name: "Save source mapping" })).toBeDisabled();
    fireEvent.change(screen.getByRole("combobox", { name: "Category budgets for" }), { target: { value: "5" } });
    expect(screen.getByRole("spinbutton", { name: "Long · Female (%)" })).toHaveValue(0);
    expect(screen.getByText(/The distance pool is separate/)).toBeVisible();
  });
  it("blocks overspending and retains edits on a conflict until explicit reload", async () => {
    mocks.save.mockRejectedValue({ status: 409 }); mount(); const share = await screen.findByRole("spinbutton", { name: "Long · Female (%)" });
    fireEvent.change(share, { target: { value: "101" } }); expect(screen.getByRole("button", { name: "Save source mapping" })).toBeDisabled();
    fireEvent.change(share, { target: { value: "75" } }); fireEvent.click(screen.getByRole("button", { name: "Save source mapping" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Your edit was not saved"); expect(share).toHaveValue(75);
    fireEvent.click(screen.getByRole("button", { name: "Reload mapping (discard edits)" }));
    await waitFor(() => expect(screen.getByRole("spinbutton", { name: "Long · Female (%)" })).toHaveValue(0));
  });
  it("shows changed source evidence and does not silently replace removed categories", async () => {
    const w = workspace(); w.boundCatalogueHash = "b".repeat(64); w.mapping.rounds[0].categories = [{ categoryId: id(99), shareBps: 10000 }];
    mocks.read.mockResolvedValue(w); mount(); expect(await screen.findByText(/The source catalogue changed since/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Save source mapping" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Remove unavailable categories from this draft" }));
    expect(screen.getByRole("button", { name: "Save source mapping" })).toBeEnabled();
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("renders a load error distinctly from an empty catalogue", async () => {
    mocks.read.mockRejectedValue(new Error("offline")); mount(); expect(await screen.findByRole("alert")).toHaveTextContent("could not be loaded");
    expect(screen.queryByText("No categories configured for this family.")).not.toBeInTheDocument();
  });
  it("suggests equal shares only on request without taking the separate club budget", async () => {
    const w = workspace(); w.catalogue.categories.push({ ...w.catalogue.categories[0], id: id(20), name: "Male" });
    mocks.read.mockResolvedValue(w); mount(); await screen.findByText("Mapping revision 0 · Rules revision 11");
    expect(screen.getByRole("spinbutton", { name: "Long · Female (%)" })).toHaveValue(0);
    const athletes = screen.getByRole("group", { name: "Athlete categories" });
    fireEvent.click(within(athletes).getByRole("button", { name: "Suggest equal category shares" }));
    expect(screen.getByRole("spinbutton", { name: "Long · Female (%)" })).toHaveValue(50);
    expect(screen.getByRole("spinbutton", { name: "Long · Male (%)" })).toHaveValue(50);
    expect(screen.getByRole("spinbutton", { name: "Clubs · Overall (%)" })).toHaveValue(0);
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
