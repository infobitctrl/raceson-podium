import { apiRequest } from "@/lib/api";
import { publicEnv } from "@/lib/public-env";
import { decodeProgrammeDepositQuoteV3, decodeProgrammeDepositReviewV3, type ProgrammeDepositQuoteV3 } from "@raceson/domain/rewards/programme-deposit-v3";
import { decodeSavedRewardPlanningDraft, type SavedRewardPlanningDraft } from "@raceson/domain/rewards/programme-draft-v2";
import { requirePortal } from "../model/athleteRewards";
function scope(input: SavedRewardPlanningDraft) {
  const record = decodeSavedRewardPlanningDraft(input);
  requirePortal(publicEnv.rewardDemo && publicEnv.rewardPortalEnabled && record.chainId === (publicEnv.rewardDemo.mode === "local" ? 31337 : 10143));
  return record;
}
export async function reviewProgrammeDepositV3(input: SavedRewardPlanningDraft, amountMon: string) {
  const record = scope(input);
  const result = decodeProgrammeDepositReviewV3(await apiRequest<unknown>({ method: "POST", path: `/v1/organizer/rewards/drafts/${record.draftId}/deposit-review`, body: { amountMon }, cache: "no-store" }));
  if (result.status === "ready") requirePortal(result.quote.chainId === record.chainId && result.quote.draftId === record.draftId && result.quote.rulesRevision === record.revision);
  return result;
}
export async function inspectProgrammeDepositV3(input: SavedRewardPlanningDraft, value: ProgrammeDepositQuoteV3, transactionHash: string) {
  const record = scope(input), quote = decodeProgrammeDepositQuoteV3(value);
  requirePortal(quote.draftId === record.draftId && quote.chainId === record.chainId && /^0x[0-9a-f]{64}$/.test(transactionHash));
  const result = await apiRequest<{ status: string; transactionHash: string }>({ method: "POST", path: `/v1/organizer/rewards/drafts/${record.draftId}/deposit-status`, body: { quote, transactionHash }, cache: "no-store" });
  requirePortal(result && Object.keys(result).length === 2 && ["pending", "confirmed", "reverted"].includes(result.status) && result.transactionHash === transactionHash);
  return result as { status: "pending" | "confirmed" | "reverted"; transactionHash: string };
}
