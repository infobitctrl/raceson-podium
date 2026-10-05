import type { TranslationKey } from "@/shared/i18n/messages";
import { requirePortal, rewardRecord, rewardUuid, walletAddress } from "./athleteRewards";
import { claimTimestamp } from "./athleteClaims";
export type ClubRewardNetwork = 31337 | 10143;
export type RewardOwnedClub = { clubId: string; name: string };
export type ClubTreasuryCandidate = { safeAddress: `0x${string}`; singletonAddress: `0x${string}`;
  fallbackHandlerAddress: `0x${string}`; owners: `0x${string}`[] };
export type ClubTreasuryRequest = { requestId: string; clubId: string; chainId: ClubRewardNetwork; candidate: ClubTreasuryCandidate;
  requestedAt: string; withdrawnAt: string | null; status: "pending_review" | "identity_hold" | "withdrawn" };
export type ClubTreasuryNomination = ClubTreasuryCandidate & { clubId: string; idempotencyKey: string };
export type ClubRewardPage<T> = { items: T[]; nextCursor: string | null };
function record(raw: unknown, keys: string[]) {
  const d = rewardRecord(raw, keys), fields = Object.getOwnPropertyDescriptors(d);
  requirePortal((Object.getPrototypeOf(d) === Object.prototype || Object.getPrototypeOf(d) === null)
    && !Object.getOwnPropertySymbols(d).length && keys.every(k => fields[k].enumerable && "value" in fields[k])); return d;
}
function address(raw: unknown): `0x${string}` { requirePortal(walletAddress(raw) && raw === raw.toLowerCase() && BigInt(raw) > 1n); return raw; }
export function decodeClubTreasuryCandidate(raw: unknown): ClubTreasuryCandidate {
  const c = record(raw, ["safeAddress", "singletonAddress", "fallbackHandlerAddress", "owners"]);
  const safeAddress = address(c.safeAddress), singletonAddress = address(c.singletonAddress), fallbackHandlerAddress = address(c.fallbackHandlerAddress);
  requirePortal(new Set([safeAddress, singletonAddress, fallbackHandlerAddress]).size === 3 && Array.isArray(c.owners) && c.owners.length === 3);
  const owners = Array.from(c.owners, address);
  requirePortal(owners[0] < owners[1] && owners[1] < owners[2] && !owners.includes(safeAddress));
  return { safeAddress, singletonAddress, fallbackHandlerAddress, owners };
}
export function decodeClubTreasuryRequest(raw: unknown, chainId: ClubRewardNetwork): ClubTreasuryRequest {
  const r = record(raw, ["requestId", "clubId", "chainId", "candidate", "requestedAt", "withdrawnAt", "status"]);
  requirePortal((chainId === 31337 || chainId === 10143) && r.chainId === chainId && rewardUuid(r.requestId) && rewardUuid(r.clubId)
    && claimTimestamp(r.requestedAt) && ["pending_review", "identity_hold", "withdrawn"].includes(String(r.status))
    && (r.withdrawnAt === null || (claimTimestamp(r.withdrawnAt) && Date.parse(r.withdrawnAt) >= Date.parse(r.requestedAt)))
    && (r.status === "withdrawn") === (r.withdrawnAt !== null));
  return { ...r, candidate: decodeClubTreasuryCandidate(r.candidate) } as ClubTreasuryRequest;
}
export function decodeClubNomination(raw: unknown): ClubTreasuryNomination {
  const r = record(raw, ["clubId", "safeAddress", "singletonAddress", "fallbackHandlerAddress", "owners", "idempotencyKey"]);
  requirePortal(rewardUuid(r.clubId) && typeof r.idempotencyKey === "string" && r.idempotencyKey.length >= 8 && r.idempotencyKey.length <= 128);
  const { clubId, idempotencyKey, ...candidate } = r;
  return { clubId, idempotencyKey, ...decodeClubTreasuryCandidate(candidate) } as ClubTreasuryNomination;
}
export function decodeClubRewardPage<T>(raw: unknown, after: string | null, decode: (v: unknown) => T, id: (v: T) => string): ClubRewardPage<T> {
  requirePortal(after === null || rewardUuid(after)); const p = record(raw, ["items", "nextCursor"]);
  requirePortal(Array.isArray(p.items) && p.items.length <= 25); let previous = after;
  const items = Array.from(p.items, v => { const item = decode(v), key = id(item); requirePortal(previous === null || key > previous); previous = key; return item; });
  requirePortal(p.nextCursor === null || (items.length === 25 && rewardUuid(p.nextCursor) && p.nextCursor === previous));
  return { items, nextCursor: p.nextCursor as string | null };
}
export function decodeRewardOwnedClubs(raw: unknown, chainId: ClubRewardNetwork, after: string | null) {
  const p = record(raw, ["chainId", "items", "nextCursor"]); requirePortal(p.chainId === chainId);
  return decodeClubRewardPage({ items: p.items, nextCursor: p.nextCursor }, after, v => {
    const c = record(v, ["clubId", "name"]);
    requirePortal(rewardUuid(c.clubId) && typeof c.name === "string" && c.name.trim().length > 0 && c.name.length <= 1000);
    return { clubId: c.clubId, name: c.name };
  }, c => c.clubId);
}
export function clubAccessLost(error: unknown) {
  return !!error && typeof error === "object" && "status" in error && (error.status === 401 || error.status === 403);
}
export function clubTreasuryErrorKey(error: unknown): TranslationKey {
  const code = error && typeof error === "object" && "code" in error ? error.code : null;
  const status = error && typeof error === "object" && "status" in error ? error.status : null;
  if (status === 401) return "rewards.error.signIn";
  if (status === 403) return "rewards.club.error.owner";
  if (status === 404) return "rewards.club.error.missing";
  if (status === 409) return "rewards.club.error.conflict";
  if (status === 400 || code === "invalid_response") return "rewards.club.error.invalid";
  return "rewards.error.generic";
}
