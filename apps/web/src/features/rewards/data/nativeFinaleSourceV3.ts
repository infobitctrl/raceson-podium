import { decodeNativeFinaleSourceV3, inspectNativeFinaleSourceV3 } from "@raceson/domain/rewards/native-finale-source-v3";
import { canonicalRewardProposalV2 as canonical } from "@raceson/domain/rewards/frozen-proposal-v2";
import type { SavedRewardPlanningDraft } from "@raceson/domain/rewards/programme-draft-v2";
import { apiRequest } from "@/lib/api";
import { publicEnv } from "@/lib/public-env";
import { requirePortal } from "../model/athleteRewards";

export async function requestNativeFinaleSourceV3(record: SavedRewardPlanningDraft, bindingId: string) {
  requirePortal(publicEnv.rewardDemo && publicEnv.rewardPortalEnabled);
  const raw = await apiRequest<Record<string, unknown>>({ path: `/v1/organizer/rewards/drafts/${record.draftId}/native-finale`, cache: "no-store" });
  requirePortal(raw && Object.keys(raw).sort().join(",") === "document,inspection,observedAt,sourceHash");
  const source = decodeNativeFinaleSourceV3({ document: raw.document, observedAt: raw.observedAt });
  requirePortal(source.document.draftId === record.draftId && source.document.chainId === record.chainId
    && source.document.organizationId === record.organizationId && source.document.recordRevision === record.revision
    && source.document.binding?.id === bindingId);
  const inspection = inspectNativeFinaleSourceV3(source);
  requirePortal(canonical(inspection) === canonical(raw.inspection));
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical(source.document)));
  const sourceHash = [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, "0")).join("");
  requirePortal(sourceHash === raw.sourceHash);
  return { ...source, inspection, sourceHash };
}
