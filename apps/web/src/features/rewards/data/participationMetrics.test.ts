import { beforeEach, expect, it, vi } from "vitest";
import { createDefaultRewardProgrammeDraftV2 } from "@raceson/domain/rewards/programme-draft-v2";
import { decodeStoredRewardSnapshot } from "@raceson/domain/rewards/published-preview-v2";
import { decodeRewardSourceMappingV2 } from "@raceson/domain/rewards/source-mapping-v2";
import { deriveLeagueParticipationMetrics } from "@raceson/domain/rewards/league-participation-metrics";
import { publishedSnapshot, publishedMapping, id } from "../../../../../../apps/api/test/fixtures/published-reward-v2.mjs";
import { readParticipationMetrics } from "./participationMetrics";
import type { SetupEventSelection } from "../components/RewardSetupEvent";

const request = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ apiRequest: request }));
vi.mock("@/lib/public-env", () => ({ publicEnv: { rewardDemo: true, rewardPortalEnabled: true } }));
function fixture() {
  const snapshot = decodeStoredRewardSnapshot(publishedSnapshot()), sourceHash = "b".repeat(64);
  const selection: SetupEventSelection = {
    record: { draftId: id(30), organizationId: id(31), seasonId: id(32), chainId: 31337,
      organizationName: "Synthetic", seasonName: "Synthetic", revision: 1, updatedAt: "2026-09-09T12:00:00Z", rules: createDefaultRewardProgrammeDraftV2() },
    workspace: { draftId: id(30), revision: 1, rulesRevision: 1, catalogueHash: "a".repeat(64),
      boundCatalogueHash: "a".repeat(64), mapping: decodeRewardSourceMappingV2(publishedMapping()), catalogue: snapshot.catalogue },
  };
  return { selection, raw: { ...structuredClone(selection), snapshot, sourceHash, metrics: deriveLeagueParticipationMetrics(snapshot, sourceHash) } };
}
beforeEach(() => request.mockReset());
it("checks server metrics against the exact selected source and uses private no-store reads", async () => {
  const { selection, raw } = fixture(); request.mockResolvedValue(raw);
  expect(await readParticipationMetrics(selection)).toEqual(raw.metrics);
  expect(request).toHaveBeenCalledWith({ path: `/v1/organizer/rewards/drafts/${id(30)}/participation-metrics`, cache: "no-store" });
});
it("rejects a changed source, programme, rules revision or computed total", async () => {
  for (const mutate of [
    (r: ReturnType<typeof fixture>["raw"]) => { r.metrics.summary.rawClubMetres = "999"; },
    (r: ReturnType<typeof fixture>["raw"]) => { r.record.draftId = id(90); },
    (r: ReturnType<typeof fixture>["raw"]) => { r.record.revision++; },
    (r: ReturnType<typeof fixture>["raw"]) => { r.workspace.catalogueHash = "c".repeat(64); },
    (r: ReturnType<typeof fixture>["raw"]) => { r.snapshot.catalogue.rounds[0].name = "Changed"; },
  ]) {
    const { selection, raw } = fixture(); mutate(raw); request.mockResolvedValue(raw);
    await expect(readParticipationMetrics(selection)).rejects.toThrow();
  }
});
it("requires an entirely empty source result when no import exists", async () => {
  const { selection, raw } = fixture(); request.mockResolvedValue({ ...raw, snapshot: null, sourceHash: null, metrics: null });
  expect(await readParticipationMetrics(selection)).toBeNull();
  request.mockResolvedValue({ ...raw, snapshot: null }); await expect(readParticipationMetrics(selection)).rejects.toThrow();
});
