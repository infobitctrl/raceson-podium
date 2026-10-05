import { apiRequest } from "@/lib/api";
import { publicEnv } from "@/lib/public-env";
import { decodeProgrammeExecutionStatusV3 } from "@raceson/domain/rewards/programme-execution-status-v3";
import { programmeApprovalRequestIdV3 as uuid } from "@raceson/domain/rewards/programme-approval-v3";
import { requirePortal } from "../model/athleteRewards";
import type { AllocationUploadContextV3 } from "./allocationUploadV3";
export type ExecutionContextV3 = AllocationUploadContextV3 & { uploadId: string; packageHash: string };
export async function requestProgrammeExecutionStatusV3(input: ExecutionContextV3) {
  const c = { ...input };
  requirePortal(publicEnv.rewardDemo && publicEnv.rewardPortalEnabled && [31337, 10143].includes(c.chainId)
    && Number.isInteger(c.slot) && c.slot >= 1 && c.slot <= 4);
  const path = `/v1/organizer/rewards/drafts/${uuid(c.draftId)}/allocation-execution/${c.slot}/${uuid(c.approvalId)}/${uuid(c.uploadId)}`;
  const v = decodeProgrammeExecutionStatusV3(await apiRequest<unknown>({ path, cache: "no-store" }));
  requirePortal(v.chainId === c.chainId && v.draftId === c.draftId && v.slot === c.slot && v.approvalId === c.approvalId
    && v.uploadId === c.uploadId && v.documentHash === c.documentHash && v.packageHash === c.packageHash
    && v.campaignAddress === c.campaignAddress && v.entitlementCount === c.entitlementCount);
  return v;
}
