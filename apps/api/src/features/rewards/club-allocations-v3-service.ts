import { listRewardClubAllocationsV3, type RewardAccountIdentity, type RewardLedgerRpc } from "@raceson/db/rewards";
import type { RewardPortalConfig } from "./request-identity.js";

export function getClubAllocationsV3(identity: RewardAccountIdentity, clubId: string, after: string | null,
  deps: RewardPortalConfig & { rpc?: RewardLedgerRpc }) {
  return listRewardClubAllocationsV3(identity, { chainId: deps.chainId, clubId, after }, deps.rpc);
}
