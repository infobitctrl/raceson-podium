import { apiRequest } from "@/lib/api";
import { publicEnv } from "@/lib/public-env";
import { decodeProgrammeActionsV3, decodeProgrammeActionRequestV3, type ProgrammeActionRequestV3 } from "@raceson/domain/rewards/programme-actions-v3";
import { programmeApprovalRequestIdV3 as uuid } from "@raceson/domain/rewards/programme-approval-v3";
import { requirePortal } from "../model/athleteRewards";
import type { ExecutionContextV3 } from "./programmeExecutionStatusV3";

export async function requestProgrammeActionsV3(input: ExecutionContextV3, change?: ProgrammeActionRequestV3) {
  const c = { ...input }, request = change === undefined ? null : decodeProgrammeActionRequestV3(change);
  requirePortal(publicEnv.rewardDemo && publicEnv.rewardPortalEnabled && [31337, 10143].includes(c.chainId)
    && Number.isInteger(c.slot) && c.slot >= 1 && c.slot <= 4 && (!request || request.packageHash === c.packageHash));
  const path = `/v1/organizer/rewards/drafts/${uuid(c.draftId)}/allocation-actions/${c.slot}/${uuid(c.approvalId)}/${uuid(c.uploadId)}`;
  const result = decodeProgrammeActionsV3(await apiRequest<unknown>({ path, cache: "no-store", ...(request ? { method: "POST", body: request } : {}) }));
  const v = result.execution;
  requirePortal(v.chainId === c.chainId && v.draftId === c.draftId && v.slot === c.slot && v.approvalId === c.approvalId
    && v.uploadId === c.uploadId && v.documentHash === c.documentHash && v.packageHash === c.packageHash
    && v.campaignAddress === c.campaignAddress && v.entitlementCount === c.entitlementCount
    && (request ? result.ack?.kind === request.kind && result.ack.requestId === request.requestId : result.ack === null));
  return result;
}
