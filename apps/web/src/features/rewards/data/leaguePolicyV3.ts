import { decodeLeaguePolicyChangeV3, type LeaguePolicyChangeV3 } from "@raceson/domain/rewards/league-standings-v3";
import { decodeLeaguePolicyViewV3 } from "@raceson/domain/rewards/league-policy-view-v3";
import { canonicalRewardProposalV2 as canonical } from "@raceson/domain/rewards/frozen-proposal-v2";
import type { SavedRewardPlanningDraft } from "@raceson/domain/rewards/programme-draft-v2";
import { apiRequest } from "@/lib/api";
import { publicEnv } from "@/lib/public-env";
import { requirePortal } from "../model/athleteRewards";

export async function requestLeaguePolicyV3(record: SavedRewardPlanningDraft, change?: LeaguePolicyChangeV3) {
  requirePortal(publicEnv.rewardDemo && publicEnv.rewardPortalEnabled);
  const captured = change ? decodeLeaguePolicyChangeV3(change) : null;
  const raw = await apiRequest<unknown>({ path: `/v1/organizer/rewards/drafts/${record.draftId}/league-policy`, cache: "no-store",
    ...(captured ? { method: "POST", body: captured } : {}) });
  const view = decodeLeaguePolicyViewV3(raw);
  requirePortal(view.draftId === record.draftId && view.organizationId === record.organizationId && view.chainId === record.chainId && view.revision === record.revision);
  if (captured) { const ack = view.recordedReview;
    requirePortal(ack?.id === captured.requestId && ack.previousReviewId === captured.expectedReviewId && ack.contextHash === captured.contextHash
      && ack.decision === captured.decision && canonical(ack.policy) === canonical(captured.policy));
  } else requirePortal(view.recordedReview === null);
  return view;
}
