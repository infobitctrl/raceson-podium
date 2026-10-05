import { readOwnRewardAllocationsV3, type RewardAccountIdentity, type RewardLedgerRpc } from "@raceson/db/rewards";

/** Chain comes from the isolated server configuration, identity from verified
 * login. Neither is accepted as an athlete-controlled query parameter. */
export function getAthleteAllocationsV3(identity: RewardAccountIdentity, after: string | null,
  config: { chainId: 10143 | 31337; rpc?: RewardLedgerRpc }) {
  return readOwnRewardAllocationsV3({ ...identity }, config.chainId, after, config.rpc);
}
