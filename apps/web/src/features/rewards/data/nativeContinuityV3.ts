import { decodeNativeContinuityChangeV3, decodeNativeContinuityViewV3, type NativeContinuityChangeV3 } from "@raceson/domain/rewards/native-finale-continuity-v3";
import { canonicalRewardProposalV2 as canonical } from "@raceson/domain/rewards/frozen-proposal-v2";
import { previewRewardProgrammeDraftV2, type SavedRewardPlanningDraft } from "@raceson/domain/rewards/programme-draft-v2";
import { apiRequest } from "@/lib/api";
import { publicEnv } from "@/lib/public-env";
import { requirePortal } from "../model/athleteRewards";

export async function requestNativeContinuityV3(record: SavedRewardPlanningDraft, bindingId: string, change?: NativeContinuityChangeV3) {
  requirePortal(publicEnv.rewardDemo && publicEnv.rewardPortalEnabled);
  const captured = change ? decodeNativeContinuityChangeV3(change) : null;
  const raw = await apiRequest<unknown>({ path: `/v1/organizer/rewards/drafts/${record.draftId}/native-continuity`, cache: "no-store",
    ...(captured ? { method: "POST", body: captured } : {}) });
  const view = decodeNativeContinuityViewV3(raw);
  requirePortal(view.draftId === record.draftId && view.organizationId === record.organizationId && view.chainId === record.chainId
    && view.revision === record.revision && view.bindingId === bindingId);
  requirePortal(BigInt(view.proposedWei) + BigInt(view.retainedWei) === previewRewardProgrammeDraftV2(record.rules).rounds[4].amountWei);
  if (view.reviewState !== "confirmed_selection") requirePortal(view.proposedWei === "0");
  if (captured) { const ack = view.recordedReview;
    requirePortal(ack?.id === captured.requestId && ack.previousReviewId === captured.expectedReviewId && ack.contextHash === captured.contextHash
      && ack.decision === captured.decision && canonical(ack.selection) === canonical(captured.selection));
  } else requirePortal(view.recordedReview === null);
  return view;
}
