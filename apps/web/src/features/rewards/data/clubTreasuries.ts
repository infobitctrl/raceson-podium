import { apiRequest } from "@/lib/api";
import { publicEnv } from "@/lib/public-env";
import { requireClaimNetwork } from "./athleteClaims";
import { requirePortal, rewardUuid } from "../model/athleteRewards";
import { decodeClubNomination, decodeClubRewardPage, decodeClubTreasuryRequest, decodeRewardOwnedClubs,
  type ClubTreasuryNomination, type ClubTreasuryRequest } from "../model/clubTreasuries";
const base = "/v1/athlete/rewards/club-treasury-requests";
function network() { const chainId = publicEnv.rewardDemo?.mode === "local" ? 31337 : 10143; requireClaimNetwork(chainId); return chainId; }
function cursor(after: string | null) { requirePortal(after === null || rewardUuid(after)); return after ? `?after=${encodeURIComponent(after)}` : ""; }
export async function getRewardOwnedClubs(after: string | null = null) {
  const chainId = network(), query = cursor(after);
  const raw = await apiRequest<unknown>({ path: `/v1/athlete/rewards/owned-clubs${query}`, cache: "no-store" }); requireClaimNetwork(chainId);
  return decodeRewardOwnedClubs(raw, chainId, after);
}
export async function getClubTreasuryHistory(after: string | null = null) {
  const chainId = network(), query = cursor(after);
  const raw = await apiRequest<unknown>({ path: base + query, cache: "no-store" }); requireClaimNetwork(chainId);
  return decodeClubRewardPage(raw, after, v => decodeClubTreasuryRequest(v, chainId), v => v.requestId);
}
export async function submitClubTreasury(input: ClubTreasuryNomination) {
  const chainId = network(), body = decodeClubNomination(input);
  const raw = await apiRequest<unknown>({ path: base, method: "POST", body, cache: "no-store" }); requireClaimNetwork(chainId);
  const r = decodeClubTreasuryRequest(raw, chainId), { clubId, idempotencyKey: _key, ...candidate } = body;
  requirePortal(r.clubId === clubId && JSON.stringify(r.candidate) === JSON.stringify(candidate)); return r;
}
export async function readClubTreasury(requestId: string) {
  const chainId = network(); requirePortal(rewardUuid(requestId));
  const raw = await apiRequest<unknown>({ path: `${base}/${requestId}`, cache: "no-store" }); requireClaimNetwork(chainId);
  const r = decodeClubTreasuryRequest(raw, chainId); requirePortal(r.requestId === requestId); return r;
}
export async function withdrawClubTreasury(request: ClubTreasuryRequest) {
  const chainId = network(), fixed = decodeClubTreasuryRequest(request, chainId);
  const raw = await apiRequest<unknown>({ path: `${base}/${fixed.requestId}/withdraw`, method: "POST", body: {}, cache: "no-store" }); requireClaimNetwork(chainId);
  const r = decodeClubTreasuryRequest(raw, chainId);
  requirePortal(r.requestId === fixed.requestId && r.clubId === fixed.clubId && r.requestedAt === fixed.requestedAt
    && JSON.stringify(r.candidate) === JSON.stringify(fixed.candidate) && r.status === "withdrawn"); return r;
}
