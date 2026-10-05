import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseEther } from "viem";
import { contractCanaryPlan, prepareContractCanaryDeployment, observeContractCanaryPlan } from "../../../demo/rewards/scripts/contract-canary-plan.mjs";
const artifact = JSON.parse(readFileSync(new URL("../../../contracts/out/RacesOnRewardCampaignV2.sol/RacesOnRewardCampaignV2.json", import.meta.url), "utf8"));
const block = { number: 1n, hash: `0x${"1".repeat(64)}` };
const client = () => ({
  getChainId: async () => 10143, getBlock: async () => block, getBalance: async () => parseEther("1000"),
  getTransactionCount: async () => 0, getCode: async () => undefined,
  estimateGas: async args => {
    assert.equal(args.account, contractCanaryPlan.operator);
    assert.deepEqual(args.stateOverride, [{ address: contractCanaryPlan.operator, balance: parseEther("2") }]);
    return 2208591n;
  },
  estimateFeesPerGas: async () => ({ maxFeePerGas: 122000000000n, maxPriorityFeePerGas: 2000000000n }),
});
test("canary approval plan has exact pinned deployment, separate keys, 1 MON conservation and no implicit authority", () => {
  const plan = prepareContractCanaryDeployment(artifact);
  assert.equal(plan.manifestHash, "0x5517164fe44332ab23819ef3cb21615fcb3a4447cc5f04ccf15ffbe243d39f12");
  assert.equal(plan.deploymentInputHash, "0x6c96a4e8ccc2d08f74901b43f5ba2e47345f1db218ae913e5fb86b4d8971b898");
  assert.equal(plan.spec.context.verifyingContract, "0x050Ca3D328F8283CaE4B300567CCa54cF254282B");
  assert.equal(new Set([contractCanaryPlan.operator, contractCanaryPlan.funder, contractCanaryPlan.relayer]).size, 3);
  assert.match(contractCanaryPlan.approval, /required/); assert.equal(contractCanaryPlan.reviewSeconds, 86400);
  assert.throws(() => prepareContractCanaryDeployment({ ...artifact, bytecode: { ...artifact.bytecode, object: "0x00" } }));
});
test("public preflight estimates exact creation input with read-only override and no signing/sending capability", async () => {
  const result = await observeContractCanaryPlan(client(), artifact);
  assert.equal(result.status, "observed-not-approved"); assert.equal(result.readOnlyDeploymentEstimate.transientBalanceOverrideUsed, true);
  assert.equal(result.readOnlyDeploymentEstimate.estimatedUpperFeeMON, "0.269448102");
  assert.equal(result.data, undefined); assert.equal(result.plan.approval, contractCanaryPlan.approval);
});
test("wrong network, consumed nonce, occupied address, fee/gas excess and canonical drift stop preflight", async () => {
  for (const patch of [
    { getChainId: async () => 143 }, { getTransactionCount: async () => 1 }, { getCode: async () => "0x00" },
    { estimateGas: async () => 4000001n },
    { estimateFeesPerGas: async () => ({ maxFeePerGas: 200000000001n, maxPriorityFeePerGas: 2000000000n }) },
    { getBlock: async args => args.blockTag ? block : { ...block, hash: `0x${"2".repeat(64)}` } },
  ]) await assert.rejects(observeContractCanaryPlan({ ...client(), ...patch }, artifact));
});
