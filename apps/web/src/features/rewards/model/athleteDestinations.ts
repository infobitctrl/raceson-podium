import { requirePortal, rewardRecord as record, rewardUuid as uuid, walletAddress } from "./athleteRewards";

export type RewardDestination = {
  requestId: string; athleteProfileId: string; address: `0x${string}`; chainId: 10143 | 31337;
  requestedAt: string; withdrawnAt: string | null; status: "pending_review" | "identity_hold" | "withdrawn";
};
export type RewardDestinationsPage = { items: RewardDestination[]; nextCursor: string | null };
const stamp = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d\d-\d\dT/.test(v) && Number.isFinite(Date.parse(v));
export function decodeDestination(value: unknown): RewardDestination {
  const d = record(value, ["requestId", "athleteProfileId", "address", "chainId", "requestedAt", "withdrawnAt", "status"]);
  requirePortal(uuid(d.requestId) && uuid(d.athleteProfileId) && walletAddress(d.address)
    && d.address === d.address.toLowerCase() && (d.chainId === 10143 || d.chainId === 31337) && stamp(d.requestedAt)
    && ["pending_review", "identity_hold", "withdrawn"].includes(String(d.status))
    && (d.withdrawnAt === null || (stamp(d.withdrawnAt) && Date.parse(d.withdrawnAt) >= Date.parse(d.requestedAt)))
    && (d.status === "withdrawn") === (d.withdrawnAt !== null));
  return { ...d } as RewardDestination;
}
export function decodeDestinations(value: unknown, after: string | null = null): RewardDestinationsPage {
  requirePortal(after === null || uuid(after));
  const page = record(value, ["items", "nextCursor"]);
  requirePortal(Array.isArray(page.items) && page.items.length <= 50);
  let previous = after;
  const items = page.items.map(value => {
    const d = decodeDestination(value); requirePortal(previous === null || d.requestId > previous); previous = d.requestId; return d;
  });
  requirePortal(page.nextCursor === null || (uuid(page.nextCursor) && items.length === 50 && page.nextCursor === previous));
  return { items, nextCursor: page.nextCursor as string | null };
}
