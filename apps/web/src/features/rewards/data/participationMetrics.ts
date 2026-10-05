import { deriveLeagueParticipationMetrics } from "@raceson/domain/rewards/league-participation-metrics";
import { decodeStoredRewardSnapshot } from "@raceson/domain/rewards/published-preview-v2";
import { decodeSavedRewardPlanningDraft } from "@raceson/domain/rewards/programme-draft-v2";
import { decodeRewardMappingWorkspaceV2 } from "@raceson/domain/rewards/source-mapping-v2";
import { requireHistoricalCatalogueV3 } from "@raceson/domain/rewards/historical-catalogue-v3";
import { apiRequest } from "@/lib/api";
import { publicEnv } from "@/lib/public-env";
import { requirePortal } from "../model/athleteRewards";
import type { SetupEventSelection } from "../components/RewardSetupEvent";

const canonical = (value: unknown): string => JSON.stringify(value, (_key, v: unknown) =>
  v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);

export async function readParticipationMetrics(selection: SetupEventSelection) {
  const raw = await apiRequest<Record<string, unknown>>({
    path: `/v1/organizer/rewards/drafts/${selection.record.draftId}/participation-metrics`, cache: "no-store",
  });
  requirePortal(publicEnv.rewardDemo && publicEnv.rewardPortalEnabled && raw &&
    Object.keys(raw).sort().join() === "metrics,record,snapshot,sourceHash,workspace");
  const record = decodeSavedRewardPlanningDraft(raw.record), workspace = decodeRewardMappingWorkspaceV2(raw.workspace);
  requirePortal(canonical(record) === canonical(selection.record) && canonical(workspace) === canonical(selection.workspace));
  if (raw.snapshot === null) { requirePortal(raw.metrics === null && raw.sourceHash === null); return null; }
  const snapshot = decodeStoredRewardSnapshot(raw.snapshot);
  requireHistoricalCatalogueV3(snapshot, workspace.catalogue);
  requirePortal(typeof raw.sourceHash === "string" && /^[0-9a-f]{64}$/.test(raw.sourceHash));
  const metrics = deriveLeagueParticipationMetrics(snapshot, raw.sourceHash as string);
  requirePortal(canonical(metrics) === canonical(raw.metrics));
  return metrics;
}
