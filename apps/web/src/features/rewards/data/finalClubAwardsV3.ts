import { apiRequest } from "@/lib/api";
import { requireClaimNetwork } from "./athleteClaims";
import { requirePortal, rewardRecord, rewardUuid } from "../model/athleteRewards";
import type { OrganizerClubAwardScopeV3 } from "@raceson/domain/rewards/organizer-club-awards-v3";
import type { SavedRewardPlanningDraft } from "@raceson/domain/rewards/programme-draft-v2";
const hash = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
const amount = (v: unknown): v is string => typeof v === "string" && /^(0|[1-9][0-9]{0,77})$/.test(v) && BigInt(v) < 2n ** 256n;
/** Discovers the server's original finale/league upload. No caller-entered IDs,
 * new allocation, publication, approval or upload is submitted here. */
export async function getFinalClubAwardsV3(record: Pick<SavedRewardPlanningDraft,"draftId"|"chainId">, slot: 5 | 6) {
  const c = { draftId: record.draftId, chainId: record.chainId, slot };
  requireClaimNetwork(c.chainId); requirePortal(rewardUuid(c.draftId) && [5,6].includes(slot));
  const base = `/v1/organizer/rewards/drafts/${c.draftId}`;
  const a = rewardRecord(await apiRequest<unknown>({ path: `${base}/final-allocation-approval/${slot}`, cache: "no-store" }),
    ["schema","draftId","chainId","slot","contextHash","documentHash","calculation","reasons","approval","recorded","historicalAcknowledgement","allocationApproved","stageReady","payableWei"]);
  requireClaimNetwork(c.chainId);
  requirePortal(a.schema === "raceson-final-allocation-approval-view-v3" && a.draftId === c.draftId && a.chainId === c.chainId && a.slot === slot
    && hash(a.contextHash) && a.stageReady === false && a.payableWei === "0" && a.historicalAcknowledgement === false && typeof a.allocationApproved === "boolean");
  if (a.approval === null) { requirePortal(a.allocationApproved === false); return null; }
  const approval = rewardRecord(a.approval,["id","previousApprovalId","contextHash","documentHash","approvedAt","approvedByUserId","current"]);
  requirePortal(rewardUuid(approval.id) && hash(approval.contextHash) && hash(approval.documentHash) && typeof approval.current === "boolean"
    && a.allocationApproved === approval.current && (approval.current ? a.contextHash === approval.contextHash : true));
  const u = rewardRecord(await apiRequest<unknown>({ path: `${base}/final-allocation-upload/${slot}/${approval.id}`, cache: "no-store" }),
    ["schema","chainId","draftId","slot","enabledPot","approvalId","contextHash","documentHash","current","campaignAddress","budgetWei","allocatedWei","unallocatedWei","entitlementCount","prepared","stageReady","payableWei"]);
  requireClaimNetwork(c.chainId);
  requirePortal(u.schema === "raceson-final-allocation-upload-view-v3" && u.chainId === c.chainId && u.draftId === c.draftId && u.slot === slot
    && u.enabledPot === (slot === 5 ? 0 : 1) && u.approvalId === approval.id && u.documentHash === approval.documentHash
    && hash(u.contextHash) && typeof u.current === "boolean" && u.stageReady === false && u.payableWei === "0"
    && typeof u.campaignAddress === "string" && /^0x[0-9a-f]{40}$/.test(u.campaignAddress) && BigInt(u.campaignAddress) > 1n
    && [u.budgetWei,u.allocatedWei,u.unallocatedWei,u.entitlementCount].every(amount));
  requirePortal(BigInt(u.budgetWei as string) === BigInt(u.allocatedWei as string) + BigInt(u.unallocatedWei as string));
  if (u.prepared === null) return null;
  const prepared = rewardRecord(u.prepared,["id","packageHash","preparedAt"]);
  requirePortal(rewardUuid(prepared.id) && hash(prepared.packageHash) && typeof prepared.preparedAt === "string" && Number.isFinite(Date.parse(prepared.preparedAt)));
  return { current: approval.current && u.current && u.contextHash === a.contextHash,
    context: { ...c, uploadId: prepared.id, approvalId: approval.id, campaignAddress: u.campaignAddress } as OrganizerClubAwardScopeV3 };
}
