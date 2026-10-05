import { getContractAddress, keccak256, stringToHex, type Abi, type Hex, type PublicClient } from "viem";
import { contractCanaryPlan as plan, CANARY_MANIFEST, decodeCanaryStatus, type CanaryStatus } from "@raceson/domain/rewards/canary";
import { rewardCampaignV2Abi } from "./campaign-v2.js";
import { rewardCreationCodeFromTransactionV2, verifyRewardRuntimeV2, type RewardDeploymentSpecV2 } from "./deployment-v2.js";
import { readVerifiedRewardDeploymentV2, type RewardDeploymentReaderV2 } from "./deployment-reader-v2.js";
import { demand } from "./validation.js";

export function canaryDeploymentSpec(): RewardDeploymentSpecV2 {
  const hash = (s: string) => keccak256(stringToHex(s));
  demand(hash(JSON.stringify(plan)) === CANARY_MANIFEST, "canary_plan_changed");
  return { context: { environment: "monad-testnet", chainId: 10143,
    verifyingContract: getContractAddress({ from: plan.operator, nonce: 0n }) },
    operatorAddress: plan.operator, treasuryAddress: plan.funder,
    programmeId: hash("RacesOn synthetic canary 2026-09-09 programme v1"),
    campaignId: hash("RacesOn synthetic canary 2026-09-09 campaign v1"), programmeManifestHash: CANARY_MANIFEST, enabledPot: 0 };
}
type Reader = RewardDeploymentReaderV2 & Pick<PublicClient, "getBalance" | "readContract">;
/** Fixed public trial only. No journal/Keychain/DB, signing, provider configuration
 * or caller-selected address. A configured tx hash is only a hint to reverify. */
export async function readCanaryStatus(reader: Reader, deploymentHash: Hex | null = null): Promise<CanaryStatus> {
  const spec = canaryDeploymentSpec();
  demand(deploymentHash === null || /^0x[0-9a-f]{64}$/.test(deploymentHash), "invalid_canary_deployment_hash");
  demand(await reader.getChainId() === 10143, "canary_wrong_chain");
  const block = await reader.getBlock({ blockTag: "finalized" });
  demand(block.number !== null && block.hash !== null, "canary_finality_unavailable");
  const number = block.number!;
  const [wallets, code] = await Promise.all([
    Promise.all((["funder", "operator", "relayer"] as const).map(async role => ({ role, address: plan[role],
      balanceWei: String(await reader.getBalance({ address: plan[role], blockNumber: number })) }))),
    reader.getCode({ address: spec.context.verifyingContract, blockNumber: number }),
  ]);
  let deployment: CanaryStatus["deployment"] = "absent", contract: CanaryStatus["contract"] = null;
  if (code && code !== "0x") {
    verifyRewardRuntimeV2(spec, code);
    deployment = "unverified";
    if (deploymentHash) {
      const expected = { ...spec, deploymentNonce: 0n, deploymentTransactionHash: deploymentHash };
      const creation = rewardCreationCodeFromTransactionV2(expected, await reader.getTransaction({ hash: deploymentHash }));
      const receipt = await readVerifiedRewardDeploymentV2(reader, expected, creation);
      demand(receipt.deploymentBlockNumber <= number, "canary_deployment_after_observation");
      const read = (functionName: string, args: readonly unknown[] = []) => reader.readContract({
        address: spec.context.verifyingContract, abi: rewardCampaignV2Abi as Abi, functionName, args, blockNumber: number });
      const [state, paused, funded, allocated, paid, returned, started, deadline, protocol, review, balance] = await Promise.all([
        read("state"), read("paused"), read("accountedFunding"), read("allocated", [0n]), read("paid", [0n]),
        read("treasuryReturned"), read("reviewStartedAt"), read("activationNotBefore"), read("PROTOCOL_VERSION"),
        read("REVIEW_PERIOD"), reader.getBalance({ address: spec.context.verifyingContract, blockNumber: number }),
      ]);
      demand(protocol === 2n && review === 86400n && typeof state === "number" && typeof paused === "boolean", "canary_protocol_mismatch");
      deployment = "verified";
      contract = { address: spec.context.verifyingContract, transactionHash: deploymentHash, state: state as number, paused: paused as boolean,
        fundedWei: String(funded), allocatedWei: String(allocated), paidWei: String(paid), returnedWei: String(returned), balanceWei: String(balance),
        reviewStartedAt: started === 0n ? null : String(started), reviewDeadline: deadline === 0n ? null : String(deadline) };
    }
  } else demand(deploymentHash === null, "canary_configured_deployment_missing");
  const [chain, again, final] = await Promise.all([reader.getChainId(), reader.getBlock({ blockNumber: number }), reader.getBlock({ blockTag: "finalized" })]);
  demand(chain === 10143 && again.number === number && again.hash === block.hash && again.timestamp === block.timestamp && final.number !== null && final.hash !== null
    && final.number >= number && (final.number !== number || final.hash === block.hash), "canary_observation_changed");
  return decodeCanaryStatus({ schema: "raceson-canary-status-v1", chainId: 10143, manifestHash: CANARY_MANIFEST,
    observedBlock: { number: String(number), hash: block.hash, timestamp: String(block.timestamp) }, wallets, deployment, contract });
}
