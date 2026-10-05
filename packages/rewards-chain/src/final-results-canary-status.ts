import { getContractAddress, keccak256, stringToHex, type Abi, type Hex, type PublicClient } from "viem";
import { finalResultsCanaryPlan as plan, FINAL_RESULTS_CANARY_MANIFEST, FINAL_RESULTS_CANARY_DEPLOYMENT_TX,
  decodeFinalResultsCanaryStatus, type FinalResultsCanaryStatus } from "@raceson/domain/rewards/final-results-canary";
import { rewardCampaignV3Abi } from "./campaign-v3.js";
import { rewardCreationCodeFromTransactionV3, verifyRewardRuntimeV3, type RewardDeploymentSpecV3 } from "./deployment-v3.js";
import { readVerifiedRewardDeploymentV3, type RewardDeploymentReaderV3 } from "./deployment-reader-v3.js";
import { demand } from "./validation.js";

export function finalResultsCanaryDeploymentSpec(): RewardDeploymentSpecV3 {
  const hash = (s: string) => keccak256(stringToHex(s));
  demand(hash(JSON.stringify(plan)) === FINAL_RESULTS_CANARY_MANIFEST, "canary_plan_changed");
  return { context: { environment: "monad-testnet", chainId: 10143,
    verifyingContract: getContractAddress({ from: plan.operator, nonce: 4n }) },
    operatorAddress: plan.operator, treasuryAddress: plan.funder,
    programmeId: hash("RacesOn synthetic final-publication canary programme v3"),
    campaignId: hash("RacesOn synthetic final-publication canary campaign v3"),
    programmeManifestHash: FINAL_RESULTS_CANARY_MANIFEST, enabledPot: 0, reviewPeriod: 0n };
}
type Reader = RewardDeploymentReaderV3 & Pick<PublicClient, "getBalance" | "readContract">;
/** Read-only fixed trial. The optional hash is for owned-chain rehearsals;
 * the public API accepts no parameters and always uses the deployed registry. */
export async function readFinalResultsCanaryStatus(reader: Reader,
  deploymentHash: Hex = FINAL_RESULTS_CANARY_DEPLOYMENT_TX): Promise<FinalResultsCanaryStatus> {
  const spec = finalResultsCanaryDeploymentSpec();
  demand(/^0x[0-9a-f]{64}$/.test(deploymentHash), "invalid_canary_deployment_hash");
  demand(await reader.getChainId() === 10143, "canary_wrong_chain");
  const block = await reader.getBlock({ blockTag: "finalized" });
  demand(block.number !== null && block.hash !== null, "canary_finality_unavailable");
  const number = block.number!;
  const [wallets, code] = await Promise.all([
    Promise.all((["funder", "operator", "relayer"] as const).map(async role => ({ role, address: plan[role],
      balanceWei: String(await reader.getBalance({ address: plan[role], blockNumber: number })) }))),
    reader.getCode({ address: spec.context.verifyingContract, blockNumber: number }),
  ]);
  demand(code !== undefined && code !== "0x", "canary_configured_deployment_missing");
  verifyRewardRuntimeV3(spec, code!);
  const expected = { ...spec, deploymentNonce: 4n, deploymentTransactionHash: deploymentHash };
  const creation = rewardCreationCodeFromTransactionV3(expected, await reader.getTransaction({ hash: deploymentHash }));
  const receipt = await readVerifiedRewardDeploymentV3(reader, expected, creation);
  demand(receipt.deploymentBlockNumber <= number, "canary_deployment_after_observation");
  const read = (functionName: string, args: readonly unknown[] = []) => reader.readContract({
    address: spec.context.verifyingContract, abi: rewardCampaignV3Abi as Abi, functionName, args, blockNumber: number });
  const [state, paused, funded, allocated, paid, returned, started, published, approved, protocol, review, balance] = await Promise.all([
    read("state"), read("paused"), read("accountedFunding"), read("allocated", [0n]), read("paid", [0n]),
    read("treasuryReturned"), read("reviewStartedAt"), read("officialPublishedAt"), read("activationNotBefore"), read("PROTOCOL_VERSION"),
    read("reviewPeriod"), reader.getBalance({ address: spec.context.verifyingContract, blockNumber: number }),
  ]);
  demand(protocol === 3n && review === 0n && typeof state === "number" && typeof paused === "boolean", "canary_protocol_mismatch");
  const [chain, again, final] = await Promise.all([reader.getChainId(), reader.getBlock({ blockNumber: number }), reader.getBlock({ blockTag: "finalized" })]);
  demand(chain === 10143 && again.number === number && again.hash === block.hash && again.timestamp === block.timestamp && final.number !== null && final.hash !== null
    && final.number >= number && (final.number !== number || final.hash === block.hash), "canary_observation_changed");
  return decodeFinalResultsCanaryStatus({ schema: "raceson-final-results-canary-status-v3", chainId: 10143, manifestHash: FINAL_RESULTS_CANARY_MANIFEST,
    observedBlock: { number: String(number), hash: block.hash, timestamp: String(block.timestamp) }, wallets, deployment: "verified",
    contract: { address: spec.context.verifyingContract, transactionHash: deploymentHash, state, paused,
      fundedWei: String(funded), allocatedWei: String(allocated), paidWei: String(paid), returnedWei: String(returned), balanceWei: String(balance),
      reviewPeriodSeconds: String(review), reviewStartedAt: started === 0n ? null : String(started),
      officialPublishedAt: published === 0n ? null : String(published), allocationApprovedAt: approved === 0n ? null : String(approved) } });
}
