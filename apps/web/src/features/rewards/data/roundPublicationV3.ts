import { apiRequest } from "@/lib/api";
import { publicEnv } from "@/lib/public-env";
import { decodeRoundPublicationV3, decodeRoundPublicationChangeV3, type RoundPublicationScopeV3,
  type RoundPublicationChangeV3 } from "@raceson/domain/rewards/round-publication-v3";
import { requirePortal } from "../model/athleteRewards";
export async function requestRoundPublicationV3(scope: RoundPublicationScopeV3, change?: RoundPublicationChangeV3) {
  const c = { chainId: scope.chainId, draftId: scope.draftId, slot: scope.slot, approvalId: scope.approvalId, uploadId: scope.uploadId, packageHash: scope.packageHash };
  const fixed = change && decodeRoundPublicationChangeV3(change);
  requirePortal(publicEnv.rewardDemo && publicEnv.rewardPortalEnabled && [31337, 10143].includes(c.chainId)
    && Number.isInteger(c.slot) && c.slot >= 1 && c.slot <= 4 && /^[0-9a-f]{64}$/.test(c.packageHash));
  for (const id of [c.draftId, c.approvalId, c.uploadId]) requirePortal(/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(id)
    && id !== "00000000-0000-0000-0000-000000000000");
  if (fixed) requirePortal(fixed.packageHash === c.packageHash);
  const path = `/v1/organizer/rewards/drafts/${c.draftId}/round-publication/${c.slot}/${c.approvalId}/${c.uploadId}/${c.packageHash}`;
  const result = decodeRoundPublicationV3(await apiRequest<unknown>({ path, cache: "no-store", ...(fixed ? { method: "POST", body: fixed } : {}) }), c);
  if (fixed) requirePortal((fixed.action === "start" ? result.review?.id : result.publication?.id) === fixed.requestId);
  return result;
}
