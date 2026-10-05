// Fixed, synthetic V3 trial. Testnet funds only; no athlete or production inputs.
import assert from "node:assert/strict";
import { getContractAddress, keccak256, stringToHex } from "viem";
import { encodeRewardDeploymentV3, requireRewardBuildArtifactV3 } from "@raceson/rewards-chain/deployment-v3";
import { finalResultsCanaryPlan as contractCanaryPlan, FINAL_RESULTS_CANARY_MANIFEST } from "@raceson/domain/rewards/final-results-canary";
export { contractCanaryPlan };
const hash = value => keccak256(stringToHex(value));
export function prepareContractCanaryDeployment(artifact) {
  requireRewardBuildArtifactV3(artifact);
  assert.equal(contractCanaryPlan.reviewSeconds, 0);
  const programmeManifestHash = hash(JSON.stringify(contractCanaryPlan));
  assert.equal(programmeManifestHash, FINAL_RESULTS_CANARY_MANIFEST);
  const spec = { context: { environment: "monad-testnet", chainId: 10143,
    verifyingContract: getContractAddress({ from: contractCanaryPlan.operator, nonce: 4n }) },
    operatorAddress: contractCanaryPlan.operator, treasuryAddress: contractCanaryPlan.funder,
    programmeId: hash("RacesOn synthetic final-publication canary programme v3"),
    campaignId: hash("RacesOn synthetic final-publication canary campaign v3"),
    programmeManifestHash, enabledPot: 0, reviewPeriod: 0n };
  const data = encodeRewardDeploymentV3(spec, artifact.bytecode.object);
  return { spec, data, deploymentInputHash: keccak256(data), manifestHash: programmeManifestHash };
}
