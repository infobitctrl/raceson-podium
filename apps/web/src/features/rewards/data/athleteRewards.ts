import { apiRequest } from "@/lib/api";
import { decodeAllocations, decodeWalletChallenge, decodeWalletProof, type WalletChallenge } from "../model/athleteRewards";

export async function getOwnRewardAllocations(after: string | null = null) {
  const suffix = after === null ? "" : `?after=${encodeURIComponent(after)}`;
  return decodeAllocations(await apiRequest<unknown>({ path: `/v1/athlete/rewards/allocations${suffix}`, cache: "no-store" }), after);
}
export async function prepareWalletChallenge(address: string, idempotencyKey: string) {
  return decodeWalletChallenge(await apiRequest<unknown>({ path: "/v1/athlete/rewards/wallet-challenges", method: "POST",
    cache: "no-store", body: { address, idempotencyKey } }), address);
}
export async function confirmWalletProof(challenge: WalletChallenge, signature: string) {
  return decodeWalletProof(await apiRequest<unknown>({ path: "/v1/athlete/rewards/wallet-proofs", method: "POST",
    cache: "no-store", body: { challengeId: challenge.challengeId, signature } }), challenge);
}
