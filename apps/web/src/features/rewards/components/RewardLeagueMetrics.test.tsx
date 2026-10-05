import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { deriveLeagueParticipationMetrics } from "@raceson/domain/rewards/league-participation-metrics";
import { decodeStoredRewardSnapshot } from "@raceson/domain/rewards/published-preview-v2";
import { publishedSnapshot, id } from "../../../../../../apps/api/test/fixtures/published-reward-v2.mjs";
import type { SetupEventSelection } from "./RewardSetupEvent";
import RewardLeagueMetrics from "./RewardLeagueMetrics";

const load = vi.hoisted(() => vi.fn());
vi.mock("../data/participationMetrics", () => ({ readParticipationMetrics: load }));
const selection = { record: { draftId: id(30), revision: 1 }, workspace: { catalogueHash: "a".repeat(64) } } as SetupEventSelection;
function data() {
  const source = publishedSnapshot(); source.results[0].clubId = id(20); source.results[0].clubName = "Club A";
  return deriveLeagueParticipationMetrics(decodeStoredRewardSnapshot(source), "b".repeat(64));
}
beforeEach(() => load.mockReset());
describe("League participation data", () => {
  it("loads on request and explains the actual club contributors", async () => {
    load.mockResolvedValue(data()); render(<RewardLeagueMetrics selection={selection} hr={false}/>);
    expect(load).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole("button", { name: "View data" }));
    expect(await screen.findByText(/4 of 5 rounds/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Clubs" }));
    const table = screen.getByRole("table", { name: "Club contributions" });
    expect(within(table).getByText("Club A")).toBeVisible();
    fireEvent.click(within(table).getByRole("button", { name: "Show contributions" }));
    const details = screen.getByRole("region", { name: "Source contributions" });
    expect(within(details).getByText("Synthetic athlete 0")).toBeVisible();
    expect(within(details).getByText("1. Synthetic short")).toBeVisible();
    expect(within(details).getByText("5")).toBeVisible();
  });
  it("distinguishes missing source from zero and discards previous data on a failed refresh", async () => {
    load.mockResolvedValueOnce(data()).mockRejectedValueOnce(new Error("changed"));
    render(<RewardLeagueMetrics selection={selection} hr={false}/>);
    fireEvent.click(screen.getByRole("button", { name: "View data" }));
    await screen.findByRole("table", { name: "Athlete contributions" });
    fireEvent.click(screen.getByRole("button", { name: "Refresh data" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not verify source data");
    expect(screen.queryByRole("table", { name: "Athlete contributions" })).not.toBeInTheDocument();
    load.mockResolvedValue(null); fireEvent.click(screen.getByRole("button", { name: "View data" }));
    expect(await screen.findByRole("status")).toHaveTextContent("does not mean zero finishes");
  });
  it("never shows a late response after changing the selected programme", async () => {
    let resolve!: (value: ReturnType<typeof data>) => void;
    load.mockReturnValue(new Promise(r => { resolve = r; }));
    const view = render(<RewardLeagueMetrics selection={selection} hr={false}/>);
    fireEvent.click(screen.getByRole("button", { name: "View data" }));
    view.rerender(<RewardLeagueMetrics selection={{ ...selection, record: { ...selection.record, draftId: id(31) } }} hr={false}/>);
    await act(async () => resolve(data()));
    expect(screen.queryByRole("table", { name: "Athlete contributions" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View data" })).toBeEnabled();
  });
  it("searches participants and shows missing distances instead of a complete kilometre total", async () => {
    const metrics = data(); metrics.athletes[0].missingDistances = 1;
    load.mockResolvedValue(metrics); render(<RewardLeagueMetrics selection={selection} hr={false}/>);
    fireEvent.click(screen.getByRole("button", { name: "View data" }));
    await screen.findByRole("table", { name: "Athlete contributions" });
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "athlete 0" } });
    const table = screen.getByRole("table", { name: "Athlete contributions" });
    expect(within(table).getAllByRole("row")).toHaveLength(2);
    expect(within(table).getByText("20 + ?")).toBeVisible();
  });
});
