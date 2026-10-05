import assert from "node:assert/strict";
import test from "node:test";
import { decodeCanaryStatus, contractCanaryPlan as plan, CANARY_MANIFEST } from "@raceson/domain/rewards/canary";
import { canaryDeploymentSpec, readCanaryStatus } from "../dist/canary-status.js";
const block = { number: 100n, hash: `0x${"12".repeat(32)}`, timestamp: 1801000000n };
const reader = () => ({ getChainId: async () => 10143, getBlock: async () => block,
  getBalance: async args => { assert.equal(args.blockNumber, block.number); return 1n; }, getCode: async () => undefined });

test("fixed canary status reads all wallets at one finalized block without deployment or signer access", async () => {
  const result = await readCanaryStatus(reader());
  assert.equal(result.manifestHash, CANARY_MANIFEST); assert.equal(result.deployment, "absent"); assert.equal(result.contract, null);
  assert.deepEqual(result.wallets.map(w => w.address), [plan.funder, plan.operator, plan.relayer]);
  assert.equal(canaryDeploymentSpec().context.verifyingContract, "0x050Ca3D328F8283CaE4B300567CCa54cF254282B");
});
test("wrong chain, RPC failure, unverified code, nonfinalized deployment and canonical drift fail closed", async () => {
  for (const patch of [
    { getChainId: async () => 143 }, { getCode: async () => "0x00" },
    { getBlock: async args => args.blockNumber ? { ...block, hash: `0x${"13".repeat(32)}` } : block },
    { getBalance: async () => { throw Error("RPC unavailable"); } },
    { getBlock: async () => ({ ...block, number: null }) },
  ]) await assert.rejects(readCanaryStatus({ ...reader(), ...patch }));
  await assert.rejects(readCanaryStatus(reader(), `0x${"14".repeat(32)}`));
  await assert.rejects(readCanaryStatus(reader(), "https://untrusted.invalid"));
});
test("strict public DTO rejects added secrets, foreign wallets, mismatched deployment, and impossible counters/review clocks", async () => {
  const status = await readCanaryStatus(reader());
  for (const patch of [{ chainId: 143 }, { privateKey: "never-return-this" }, { manifestHash: block.hash },
    { wallets: status.wallets.slice(1) }, { wallets: status.wallets.map(w => ({ ...w, address: plan.funder })) },
    { wallets: status.wallets.map(w => ({ ...w, balanceWei: "-1" })) },
    { observedBlock: { ...status.observedBlock, timestamp: "253402300800" } },
    { contract: { address: canaryDeploymentSpec().context.verifyingContract } }]) assert.throws(() => decodeCanaryStatus({ ...status, ...patch }));
  const contract = { address: canaryDeploymentSpec().context.verifyingContract, transactionHash: `0x${"14".repeat(32)}`,
    state: 2, paused: false, fundedWei: "1000000000000000000", allocatedWei: "500000000000000000", paidWei: "0", returnedWei: "0",
    balanceWei: "1000000000000000000", reviewStartedAt: "1801000000", reviewDeadline: "1801086400" };
  const verified = { ...status, deployment: "verified", contract };
  assert.deepEqual(decodeCanaryStatus(verified), verified);
  for (const patch of [{ state: 7 }, { state: "2" }, { paused: "false" }, { fundedWei: "2000000000000000000" },
    { paidWei: "600000000000000000" }, { balanceWei: "0" }, { reviewStartedAt: null },
    { reviewDeadline: "1801000300" }, { address: plan.operator }, { secret: "never-return-this" }])
    assert.throws(() => decodeCanaryStatus({ ...verified, contract: { ...contract, ...patch } }));
});
