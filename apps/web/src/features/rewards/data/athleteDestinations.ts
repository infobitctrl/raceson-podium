import { apiRequest } from "@/lib/api";
import { requirePortal, rewardUuid, type WalletChallenge } from "../model/athleteRewards";
import { decodeDestination, decodeDestinations } from "../model/athleteDestinations";

const path = "/v1/athlete/rewards/destination-requests";
export async function getOwnRewardDestinations(after: string | null = null) {
  requirePortal(after === null || rewardUuid(after));
  return decodeDestinations(await apiRequest<unknown>({ path: `${path}${after ? `?after=${encodeURIComponent(after)}` : ""}`, cache: "no-store" }), after);
}
export async function submitRewardDestination(challenge: WalletChallenge, athleteProfileId: string, idempotencyKey: string) {
  requirePortal(rewardUuid(athleteProfileId) && rewardUuid(challenge.challengeId));
  const fixed = { ...challenge };
  const d = decodeDestination(await apiRequest<unknown>({ path, method: "POST", cache: "no-store",
    body: { challengeId: fixed.challengeId, athleteProfileId, idempotencyKey } }));
  requirePortal(d.athleteProfileId === athleteProfileId && d.chainId === fixed.chainId && d.address === fixed.address.toLowerCase());
  return d;
}
export async function withdrawRewardDestination(requestId: string) {
  requirePortal(rewardUuid(requestId));
  const d = decodeDestination(await apiRequest<unknown>({ path: `${path}/${requestId}/withdraw`, method: "POST", cache: "no-store", body: {} }));
  requirePortal(d.requestId === requestId && d.status === "withdrawn"); return d;
}
