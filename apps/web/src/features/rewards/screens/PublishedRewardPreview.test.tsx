import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { createDefaultRewardProgrammeDraftV2, type SavedRewardPlanningDraft } from "@raceson/domain/rewards/programme-draft-v2";
import { emptyRewardSourceMappingV2, type RewardMappingWorkspaceV2 } from "@raceson/domain/rewards/source-mapping-v2";
import { previewPublishedRewardsV2, type PublishedRewardSnapshotV2 } from "@raceson/domain/rewards/published-preview-v2";
import { I18nProvider } from "@/shared/i18n/I18nProvider";
import PublishedRewardPreview from "./PublishedRewardPreview";
import { syntheticPilotReviewFixture } from "../data/historicalSourceV3.fixture";
const mocks = vi.hoisted(() => ({ read: vi.fn(), frozen: vi.fn(), historical: vi.fn() }));
vi.mock("../data/publishedPreview", () => ({ readPublishedPreview: (...args: unknown[]) => mocks.read(...args) }));
vi.mock("../data/frozenProposals", () => ({ requestFrozenProposals: (...args: unknown[]) => mocks.frozen(...args) }));
vi.mock("../data/historicalSourceV3", () => ({ requestHistoricalSourceV3: (...args: unknown[]) => mocks.historical(...args) }));
const id = (n: number) => `85000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const record: SavedRewardPlanningDraft = { draftId: id(1), organizationId: id(2), seasonId: id(3), chainId: 31337, revision: 1, organizationName: "Synthetic org", seasonName: "Synthetic season", updatedAt: "2026-09-09T12:00:00Z", rules: createDefaultRewardProgrammeDraftV2() };
function fixture() {
  const s: PublishedRewardSnapshotV2 = { version: 2, sourceOrigin: "https://www.raceson.com", sourceLeagueId: id(4), sourceSeasonId: id(5), capturedAt: "2026-09-09T12:00:00Z",
    catalogue: { rounds: Array.from({ length: 4 }, (_, i) => ({ id: id(100 + i), editionId: id(200 + i), slot: i + 1, name: `Synthetic round ${i + 1}`, date: "2026-09-01", status: "completed",
      races: [{ id: id(300 + i), competitionId: id(8), name: "Synthetic race", distanceMetres: "5000", publicationId: id(400 + i), publicationState: "official", resultCount: 1 }] })),
      categories: [{ id: id(9), competitionId: id(8), competitionName: "Long", name: "Female", target: "individual", eligibility: {} }] },
    results: Array.from({ length: 4 }, (_, i) => ({ id: id(500 + i), publicationId: id(400 + i), publicationState: "official", publishedAt: "2026-09-01T12:00:00Z", runId: id(600 + i), athleteId: id(7), athleteName: "Synthetic Runner", raceId: id(300 + i), classificationIds: [id(9)], participationStatus: "finished", finishTimeMs: 123000, rankOverall: 4, clubId: null, clubName: null })), clubs: [] };
  const mapping = emptyRewardSourceMappingV2(); mapping.rounds.forEach((r, i) => { r.roundId = s.catalogue.rounds[i]?.id ?? null; r.categories = [{ categoryId: id(9), shareBps: 10000 }]; });
  const workspace: RewardMappingWorkspaceV2 = { draftId: record.draftId, revision: 1, rulesRevision: 1, catalogueHash: "a".repeat(64), boundCatalogueHash: "a".repeat(64), mapping, catalogue: s.catalogue };
  return { workspace, data: { snapshot: s, preview: previewPublishedRewardsV2(record.rules, mapping, s), sourceHash: "b".repeat(64) } };
}
beforeEach(() => { mocks.read.mockReset().mockResolvedValue(fixture().data); mocks.frozen.mockReset().mockResolvedValue([]); mocks.historical.mockReset(); });
function mount(dirty = false) { return render(<I18nProvider initialLocale="en"><PublishedRewardPreview record={record} workspace={fixture().workspace} dirty={dirty} /></I18nProvider>); }
it("shows published evidence, unpaid amounts and exact formula without creating a claim", async () => {
  mount(); await screen.findAllByText("Synthetic Runner"); expect(screen.getByRole("table", { name: "Proposed recipients · not payable" })).toBeVisible();
  expect(screen.getByText("2800")).toBeVisible(); fireEvent.click(screen.getByText("Why this amount?"));
  expect(screen.getByText("Published overall place: 4")).toBeVisible(); expect(screen.getByText(/Identity, age or club authority/)).toBeVisible();
  expect(screen.getByText("Unclaimed in demo · unpaid")).toBeVisible(); expect(screen.queryByRole("button", { name: /pay|claim/i })).not.toBeInTheDocument();
});
it("filters recipients and retains fifth-round/league reserves", async () => {
  mount(); await screen.findAllByText("Synthetic Runner"); fireEvent.change(screen.getByRole("textbox", { name: "Find a proposed recipient" }), { target: { value: "missing" } });
  expect(screen.getByText(/No proposed recipients match/)).toBeVisible(); fireEvent.change(screen.getByRole("combobox", { name: "Inspect reward round" }), { target: { value: "5" } });
  expect(screen.getByText(/no verified round source/)).toBeVisible(); fireEvent.click(screen.getByText("League participation · completed kilometres so far"));
  expect(screen.getByText(/entire 50000 test MON league pot is retained/)).toBeVisible(); expect(screen.getByText("20")).toBeVisible();
  await screen.findByText("No frozen proposal for this round yet.");
});
it("distinguishes unsaved edits, absent evidence and failed verification", async () => {
  const view = mount(true); await screen.findAllByText(/last saved mapping/); view.unmount();
  mocks.read.mockResolvedValue(null); const empty = mount(); await screen.findByText(/No published result snapshot/); empty.unmount();
  mocks.read.mockRejectedValue(new Error("offline")); mount(); expect(await screen.findByRole("alert")).toHaveTextContent("could not be verified");
});
it("discards an old in-flight response when the workspace revision changes", async () => {
  let finish: (v: unknown) => void = () => {}; mocks.read.mockImplementationOnce(() => new Promise(resolve => finish = resolve)).mockResolvedValueOnce(null);
  const view = mount(); view.rerender(<I18nProvider initialLocale="en"><PublishedRewardPreview record={record} workspace={{ ...fixture().workspace, revision: 2 }} dirty={false} /></I18nProvider>);
  await screen.findByText(/No published result snapshot/); finish(fixture().data); await waitFor(() => expect(screen.queryByText("Synthetic Runner")).not.toBeInTheDocument());
});
it("keeps hybrid historical previews inspectable without sending them to the old V2 freeze path", async () => {
  const { workspace } = fixture();
  workspace.catalogue = structuredClone(workspace.catalogue);
  workspace.catalogue.rounds.push({ id: id(900), editionId: id(901), slot: 5, name: "Synthetic finale", date: "2026-10-03", status: "draft", races: [] });
  workspace.mapping.rounds[4].roundId = id(900);
  render(<I18nProvider initialLocale="en"><PublishedRewardPreview record={record} workspace={workspace} dirty={false} /></I18nProvider>);
  await screen.findByText(/Historical V2 freeze actions do not apply/);
  expect(screen.getByRole("button", { name: "Review historical source · V3" })).toBeVisible();
  expect(mocks.frozen).not.toHaveBeenCalled();
});
it.each(["en", "hr"] as const)("labels saved pilot provenance in %s and offers V3 review without old freezing or automatic approval", async locale => {
  const f = syntheticPilotReviewFixture();
  mocks.read.mockResolvedValue({ snapshot: f.snapshot, sourceHash: f.context.sourceHash,
    preview: previewPublishedRewardsV2(f.context.record.rules, f.context.workspace.mapping, f.snapshot) });
  mocks.historical.mockResolvedValue(f.data);
  render(<I18nProvider initialLocale={locale}><PublishedRewardPreview record={f.context.record} workspace={f.context.workspace} dirty={false} /></I18nProvider>);
  await screen.findByText(locale === "en" ? /Synthetic 20-athlete pilot/ : /Izmišljeni pilot s 20 natjecatelja/);
  expect(mocks.frozen).not.toHaveBeenCalled(); expect(mocks.historical).not.toHaveBeenCalled();
  expect(screen.queryByText(locale === "en" ? /Published sporting data copied/ : /Objavljeni sportski podaci kopirani/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: locale === "en" ? "Review synthetic pilot source · V3" : "Pregled izmišljenog izvora pilota · V3" }));
  const save = await screen.findByRole("button", { name: locale === "en" ? "Confirm synthetic source" : "Potvrdi izmišljeni izvor" });
  expect(save).toBeDisabled();
  expect(screen.getByText(locale === "en" ? /I reviewed these exact synthetic results/ : /Pregledao\/la sam ove točno navedene izmišljene rezultate/)).toBeVisible();
  expect(mocks.historical).toHaveBeenCalledTimes(1);
  expect(mocks.historical.mock.calls[0]).toHaveLength(1); // Read only; no decision has been sent.
});
it("opens the requested round and clears a previous round's recipient filter without rereading or approving data", async () => {
  const workspace = fixture().workspace;
  const tree = (selectedRound: number) => <I18nProvider initialLocale="en"><PublishedRewardPreview record={record} workspace={workspace} dirty={false} selectedRound={selectedRound} /></I18nProvider>;
  const view = render(tree(2));
  await screen.findAllByText("Synthetic Runner");
  expect(screen.getByRole("combobox", { name: "Inspect reward round" })).toHaveValue("2");
  fireEvent.change(screen.getByRole("textbox", { name: "Find a proposed recipient" }), { target: { value: "missing" } });
  view.rerender(tree(3));
  expect(screen.getByRole("combobox", { name: "Inspect reward round" })).toHaveValue("3");
  expect(screen.getByRole("textbox", { name: "Find a proposed recipient" })).toHaveValue("");
  await screen.findByText("No frozen proposal for this round yet.");
  expect(mocks.read).toHaveBeenCalledTimes(1);
  expect(mocks.historical).not.toHaveBeenCalled();
});
