import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { encodeFunctionData, keccak256, stringToHex, toHex, parseEther } from "viem";
import { contractCanaryPlan as plan } from "@raceson/domain/rewards/canary";
import { readCanaryStatus } from "../dist/canary-status.js";
import { rewardCampaignV2Abi } from "../dist/campaign-v2.js";
import { prepareContractCanaryDeployment } from "../../../demo/rewards/scripts/contract-canary-plan.mjs";
import { startOwnedRewardChain } from "./owned-chain.mjs";

test("status verifies a real local deployment and reads funding, 24h review and activation; missing receipt never advertises funding", async () => {
  // Fresh non-forked loopback chain only. The public operator address is locally
  // impersonated; no actual operator private key or public RPC is accessed.
  const chain = await startOwnedRewardChain({ chainId: 10143 });
  try {
    const artifact = JSON.parse(readFileSync(new URL("../../../contracts/out/RacesOnRewardCampaignV2.sol/RacesOnRewardCampaignV2.json", import.meta.url), "utf8"));
    const prepared = prepareContractCanaryDeployment(artifact), address = prepared.spec.context.verifyingContract;
    await chain.testClient.impersonateAccount({ address: plan.operator });
    await chain.testClient.setBalance({ address: plan.operator, value: parseEther("10") });
    const send = async (data, value = 0n, deploy = false) => {
      const hash = await chain.testClient.request({ method: "eth_sendTransaction", params: [{ from: plan.operator,
        ...(deploy ? {} : { to: address }), data, value: toHex(value), gas: "0x3d0900" }] });
      await chain.testClient.mine({ blocks: 96, interval: 1 });
      assert.equal((await chain.publicClient.getTransactionReceipt({ hash })).status, "success");
      return hash;
    };
    const tx = await send(prepared.data, 0n, true);
    const withoutReceipt = await readCanaryStatus(chain.publicClient);
    assert.equal(withoutReceipt.deployment, "unverified"); assert.equal(withoutReceipt.contract, null);
    let current = await readCanaryStatus(chain.publicClient, tx);
    assert.equal(current.contract.state, 0); assert.equal(current.contract.fundedWei, "0");
    const call = (functionName, args = [], value = 0n) => send(encodeFunctionData({ abi: rewardCampaignV2Abi, functionName, args }), value);
    await call("completeFunding", [0, parseEther("1")], parseEther("1"));
    current = await readCanaryStatus(chain.publicClient, tx);
    assert.equal(current.contract.fundedWei, String(parseEther("1"))); assert.equal(current.contract.state, 1);
    assert.equal(current.contract.reviewDeadline, null);
    const h = s => keccak256(stringToHex(s));
    await call("uploadAwards", [[{ entitlementId: h("synthetic-status-entitlement"), beneficiaryId: h("synthetic-status-beneficiary"),
      pot: 0, amount: parseEther("0.5"), explanationHash: h("synthetic-status-explanation"), beneficiaryKind: 0 }]]);
    const uploadDigest = await chain.publicClient.readContract({ address, abi: rewardCampaignV2Abi, functionName: "uploadDigest" });
    const publication = (await chain.publicClient.getBlock()).timestamp;
    await call("stageAllocation", [h("synthetic-status-snapshot"), uploadDigest, 1n, publication]);
    current = await readCanaryStatus(chain.publicClient, tx);
    assert.equal(current.contract.state, 2); assert.equal(current.contract.paidWei, "0");
    assert.equal(BigInt(current.contract.reviewDeadline) - BigInt(current.contract.reviewStartedAt), 86400n);
    // Time travel is confined to this disposable test process, never testnet.
    await chain.testClient.increaseTime({ seconds: 86400 }); await chain.testClient.mine({ blocks: 1 });
    const allocationDigest = await chain.publicClient.readContract({ address, abi: rewardCampaignV2Abi, functionName: "allocationDigest" });
    await call("activate", [allocationDigest, h("synthetic-status-snapshot")]);
    current = await readCanaryStatus(chain.publicClient, tx);
    assert.equal(current.contract.state, 3); assert.equal(current.contract.allocatedWei, String(parseEther("0.5")));
    await assert.rejects(readCanaryStatus(chain.publicClient, h("not-a-deployment")));
  } finally { await chain.stop(); }
}, { timeout: 30000 });
