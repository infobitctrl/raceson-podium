// Public-data-only preflight. Does NOT load Keychain, sign, deploy, fund or approve.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { createPublicClient, formatEther, getContractAddress, http, keccak256, parseEther, stringToHex } from "viem";
import { monadTestnet } from "viem/chains";
import { encodeRewardDeploymentV2, requireRewardBuildArtifactV2, rewardCampaignV2Build } from "@raceson/rewards-chain/deployment-v2";
import { contractCanaryPlan } from "@raceson/domain/rewards/canary";
export { contractCanaryPlan } from "@raceson/domain/rewards/canary";

const hash = s => keccak256(stringToHex(s));
export function prepareContractCanaryDeployment(artifact) {
  requireRewardBuildArtifactV2(artifact);
  assert.equal(contractCanaryPlan.buildId, rewardCampaignV2Build.id);
  assert.equal(contractCanaryPlan.creationCodeHash, rewardCampaignV2Build.creationCodeHash);
  assert.equal(parseEther(contractCanaryPlan.budgetMON), parseEther(contractCanaryPlan.singleClaimMON)
    + parseEther(contractCanaryPlan.walletlessReserveMON) + parseEther(contractCanaryPlan.unallocatedMON));
  const programmeManifestHash = hash(JSON.stringify(contractCanaryPlan));
  const spec = { context: { environment: "monad-testnet", chainId: 10143,
    verifyingContract: getContractAddress({ from: contractCanaryPlan.operator, nonce: 0n }) },
    operatorAddress: contractCanaryPlan.operator, treasuryAddress: contractCanaryPlan.funder,
    programmeId: hash("RacesOn synthetic canary 2026-09-09 programme v1"),
    campaignId: hash("RacesOn synthetic canary 2026-09-09 campaign v1"), programmeManifestHash, enabledPot: 0 };
  const data = encodeRewardDeploymentV2(spec, artifact.bytecode.object);
  return { spec, data, deploymentInputHash: keccak256(data), manifestHash: programmeManifestHash };
}
export async function observeContractCanaryPlan(client, artifact) {
  const deployment = prepareContractCanaryDeployment(artifact);
  assert.equal(await client.getChainId(), 10143);
  const block = await client.getBlock({ blockTag: "finalized" }); assert.ok(block.number !== null && block.hash);
  const accounts = await Promise.all(["funder", "operator", "relayer"].map(async role => ({ role, address: contractCanaryPlan[role],
    balanceMON: formatEther(await client.getBalance({ address: contractCanaryPlan[role], blockNumber: block.number })),
    latestNonce: await client.getTransactionCount({ address: contractCanaryPlan[role], blockTag: "latest" }),
    pendingNonce: await client.getTransactionCount({ address: contractCanaryPlan[role], blockTag: "pending" }),
  })));
  const operator = accounts.find(a => a.role === "operator");
  assert.equal(operator.latestNonce, 0); assert.equal(operator.pendingNonce, 0);
  const code = await client.getCode({ address: deployment.spec.context.verifyingContract, blockNumber: block.number });
  assert.ok(!code || code === "0x", "Expected canary address already contains code; inspect before proceeding");
  // eth_estimateGas with a transient balance override is read-only simulation.
  // The actual operator remains unfunded; this is not a deposit or paid receipt.
  const [gas, fees] = await Promise.all([
    client.estimateGas({ account: contractCanaryPlan.operator, data: deployment.data,
      stateOverride: [{ address: contractCanaryPlan.operator, balance: parseEther(contractCanaryPlan.operatorTopUpMON) }] }),
    client.estimateFeesPerGas(),
  ]);
  assert.ok(gas > 0n && gas <= BigInt(contractCanaryPlan.deploymentGasLimitCeiling));
  assert.ok(fees.maxFeePerGas <= BigInt(contractCanaryPlan.feeCeilingPerGasWei));
  assert.ok(gas * fees.maxFeePerGas <= parseEther(contractCanaryPlan.operatorTotalFeeCeilingMON));
  const [check, chain] = await Promise.all([client.getBlock({ blockNumber: block.number }), client.getChainId()]);
  assert.equal(chain, 10143); assert.equal(check.hash, block.hash);
  return { status: "observed-not-approved", plan: contractCanaryPlan, ...deployment, data: undefined,
    accounts, observedBlock: String(block.number), observedBlockHash: block.hash,
    readOnlyDeploymentEstimate: { gas: String(gas), maxFeePerGasWei: String(fees.maxFeePerGas),
      maxPriorityFeePerGasWei: String(fees.maxPriorityFeePerGas), estimatedUpperFeeMON: formatEther(gas * fees.maxFeePerGas),
      transientBalanceOverrideUsed: true },
    limitations: ["No transaction signed or submitted", "Owner deployment/funding approval required",
      "Recipient wallet and consent still required", "Fee/state observations must be repeated before execution",
      "Source verification is required after deployment; the source is not yet submitted to an explorer"] };
}
async function main() {
  assert.deepEqual(process.argv.slice(2), ["inspect"]);
  const artifact = JSON.parse(readFileSync(new URL("../../../contracts/out/RacesOnRewardCampaignV2.sol/RacesOnRewardCampaignV2.json", import.meta.url), "utf8"));
  const client = createPublicClient({ chain: monadTestnet, transport: http("https://testnet-rpc.monad.xyz", { timeout: 15_000, retryCount: 0 }) });
  console.log(JSON.stringify(await observeContractCanaryPlan(client, artifact), null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(() => {
  console.error("Read-only canary preflight failed. No transaction was signed/sent. Inspect artifact, nonce, RPC availability and fee limits; do not bypass them.");
  process.exitCode = 1;
});
