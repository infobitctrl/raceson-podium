import { decodeRewardClubTreasuryCandidate, requestRewardClubTreasury, readRewardClubTreasury, listRewardClubTreasuries, withdrawRewardClubTreasury, listRewardOwnedClubs,
  type RewardAccountIdentity, type RewardLedgerRpc } from "@raceson/db/rewards";
import { normalizeRewardClubSafeExpectation } from "@raceson/rewards-chain";
import { RewardCalculationError } from "@raceson/domain/rewards";
import type { RewardPortalConfig } from "./request-identity.js";

type Options = RewardPortalConfig & { rpc?: RewardLedgerRpc };
export type ClubTreasuryNomination = { clubId: string; safeAddress: `0x${string}`; singletonAddress: `0x${string}`;
  fallbackHandlerAddress: `0x${string}`; owners: `0x${string}`[]; idempotencyKey: string };
function publicRequest(r: Awaited<ReturnType<typeof readRewardClubTreasury>>) {
  return { requestId: r.requestId, clubId: r.clubId, chainId: r.chainId, candidate: r.candidate,
    requestedAt: r.requestedAt, withdrawnAt: r.withdrawnAt, status: r.status };
}
/** Explicit nomination, not a verified Safe, treasury review or consent. Wallet
 * owners are proposed public addresses, never generated keys or RacesOn users. */
export async function nominateClubRewardTreasury(identity: RewardAccountIdentity, input: ClubTreasuryNomination, deps: Options) {
  let candidate;
  try {
  const normalized = normalizeRewardClubSafeExpectation({ context: { environment: deps.chainId === 31337 ? "local-simulation" : "monad-testnet",
    chainId: deps.chainId, verifyingContract: input.safeAddress }, singletonAddress: input.singletonAddress,
    fallbackHandlerAddress: input.fallbackHandlerAddress, owners: input.owners });
  candidate = decodeRewardClubTreasuryCandidate({ safeAddress: normalized.context.verifyingContract.toLowerCase(),
    singletonAddress: normalized.singletonAddress.toLowerCase(), fallbackHandlerAddress: normalized.fallbackHandlerAddress.toLowerCase(), owners: normalized.owners });
  } catch { throw new RewardCalculationError("invalid_reward_club_treasury_request"); }
  return publicRequest(await requestRewardClubTreasury(identity, deps.chainId, { clubId: input.clubId, candidate, idempotencyKey: input.idempotencyKey }, deps.rpc));
}
export async function getClubRewardTreasury(identity: RewardAccountIdentity, requestId: string, deps: Options) {
  return publicRequest(await readRewardClubTreasury(identity, deps.chainId, requestId, deps.rpc));
}
export async function getClubRewardTreasuries(identity: RewardAccountIdentity, afterId: string | null, deps: Options) {
  const result = await listRewardClubTreasuries(identity, deps.chainId, afterId, deps.rpc);
  return { items: result.items.map(publicRequest), nextCursor: result.nextCursor };
}
export async function getRewardOwnedClubs(identity: RewardAccountIdentity, afterId: string | null, deps: Options) {
  return listRewardOwnedClubs(identity, deps.chainId, afterId, deps.rpc);
}
export async function withdrawClubRewardTreasury(identity: RewardAccountIdentity, requestId: string, deps: Options) {
  return publicRequest(await withdrawRewardClubTreasury(identity, deps.chainId, requestId, deps.rpc));
}
