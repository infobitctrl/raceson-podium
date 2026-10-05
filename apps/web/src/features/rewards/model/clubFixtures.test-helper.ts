import type { ClubTreasuryRequest } from "./clubTreasuries";
export const clubId = (n: number) => `7c100000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const clubAddress = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as `0x${string}`;
export function clubFixture() {
  const candidate = { safeAddress: clubAddress(10), singletonAddress: clubAddress(11), fallbackHandlerAddress: clubAddress(12), owners: [20, 21, 22].map(clubAddress) };
  const request: ClubTreasuryRequest = { requestId: clubId(4), clubId: clubId(3), chainId: 31337, candidate,
    requestedAt: "2026-09-09T01:00:00Z", withdrawnAt: null, status: "pending_review" };
  return { candidate, request, nomination: { clubId: clubId(3), ...candidate, idempotencyKey: "synthetic-club-nomination" },
    clubs: { items: [{ clubId: clubId(3), name: "Synthetic treasury club" }], nextCursor: null }, history: { items: [request], nextCursor: null } };
}
