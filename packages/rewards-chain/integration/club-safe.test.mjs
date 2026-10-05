import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { encodeFunctionData, zeroAddress } from "viem";
import { startOwnedRewardChain, fixtureSigner } from "./owned-chain.mjs";
import { deployOriginalClubSafeFixture } from "./safe-deployment-fixture.mjs";
import { readVerifiedRewardClubSafe, readVerifiedRewardClubSafeDeployment, verifyRewardClubSafeConsent, safeRewardConsentMessage, rewardClaimMessages } from "../dist/index.js";
import { h } from "../test/fixtures.mjs";
let chain, safe, expected, artifacts, provenance;
const finalize = () => chain.testClient.mine({ blocks: 96, interval: 1 });
async function receipt(hash) { const r = await chain.publicClient.waitForTransactionReceipt({ hash, timeout: 10000 }); assert.equal(r.status, "success"); return r; }
async function deploy(artifact, args = []) { return (await receipt(await chain.operatorClient.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode, args }))).contractAddress; }
before(async () => {
  chain = await startOwnedRewardChain();
  ({ artifacts, expected, provenance } = await deployOriginalClubSafeFixture(chain)); safe = expected.context.verifyingContract;
  await finalize();
}, { timeout: 30000 });
after(async () => { await chain?.stop(); });
test("original factory atomically deploys and initializes a zero-funded Safe with exact finalized provenance", async () => {
  const result = await readVerifiedRewardClubSafeDeployment(chain.publicClient, provenance);
  assert.equal(result.deploymentTransactionHash, provenance.deploymentTransactionHash);
  assert.equal(result.safe.context.verifyingContract, safe); assert.equal(result.scope, "initialization_only");
  assert.equal(result.executionHistoryReviewRequired, true); assert.equal(await chain.publicClient.getBalance({ address: safe }), 0n);
});
test("a genuine separately initialized proxy or unsupported setup is not accepted merely because current configuration matches", async () => {
  const separate = await deploy(artifacts.proxy, [expected.singletonAddress]);
  const setup = await receipt(await chain.operatorClient.writeContract({ address: separate, abi: artifacts.singleton.abi, functionName: "setup",
    args: [expected.owners, 2n, zeroAddress, "0x", expected.fallbackHandlerAddress, zeroAddress, 0n, zeroAddress] }));
  await finalize();
  const candidate = { ...expected, context: { ...expected.context, verifyingContract: separate } };
  assert.equal((await readVerifiedRewardClubSafe(chain.publicClient, candidate)).threshold, 2);
  await assert.rejects(readVerifiedRewardClubSafeDeployment(chain.publicClient, { ...provenance, safe: candidate, deploymentTransactionHash: setup.transactionHash }),
    { code: "reward_club_deployment_transaction_mismatch" });
  const unsupported = await deployOriginalClubSafeFixture(chain, { paymentReceiver: chain.treasury }); await finalize();
  assert.equal((await readVerifiedRewardClubSafe(chain.publicClient, unsupported.expected)).threshold, 2);
  await assert.rejects(readVerifiedRewardClubSafeDeployment(chain.publicClient, unsupported.provenance), { code: "reward_club_setup_not_supported" });
});
async function consent(claim, campaignContext, signers = chain.clubOwners.slice(0, 2), wrapped = true) {
  const message = wrapped ? safeRewardConsentMessage(campaignContext, claim) : rewardClaimMessages(campaignContext, claim).consent;
  const sorted = [...signers].sort((a, b) => a.address.toLowerCase().localeCompare(b.address.toLowerCase()));
  return `0x${(await Promise.all(sorted.map(s => s.signTypedData(message)))).map(s => s.slice(2)).join("")}`;
}
async function management(functionName, args) {
  const data = encodeFunctionData({ abi: artifacts.singleton.abi, functionName, args });
  const nonce = await chain.publicClient.readContract({ address: safe, abi: artifacts.singleton.abi, functionName: "nonce" });
  const message = { to: safe, value: 0n, data, operation: 0, safeTxGas: 0n, baseGas: 0n, gasPrice: 0n, gasToken: zeroAddress, refundReceiver: zeroAddress, nonce };
  const typed = { domain: { chainId: 31337, verifyingContract: safe }, primaryType: "SafeTx", message, types: { SafeTx: [
    { name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "data", type: "bytes" }, { name: "operation", type: "uint8" },
    { name: "safeTxGas", type: "uint256" }, { name: "baseGas", type: "uint256" }, { name: "gasPrice", type: "uint256" }, { name: "gasToken", type: "address" },
    { name: "refundReceiver", type: "address" }, { name: "nonce", type: "uint256" },
  ] } };
  const signatures = `0x${(await Promise.all(chain.clubOwners.slice(0, 2).sort((a, b) => a.address.toLowerCase().localeCompare(b.address.toLowerCase()))
    .map(o => o.signTypedData(typed)))).map(s => s.slice(2)).join("")}`;
  await receipt(await chain.operatorClient.writeContract({ address: safe, abi: artifacts.singleton.abi, functionName: "execTransaction",
    args: [safe, 0n, data, 0, 0n, 0n, 0n, zeroAddress, zeroAddress, signatures] })); await finalize();
}
test("actual original Safe code/storage and two-owner consent verify at one finalized block", async () => {
  const result = await readVerifiedRewardClubSafe(chain.publicClient, expected); assert.equal(result.threshold, 2); assert.equal(result.owners.length, 3);
  const claim = { entitlementId: h("synthetic club award"), recipient: safe, amount: 100n, pot: "race", nonce: 0n,
    issuedAt: result.finalizedBlock.timestamp, expiresAt: result.finalizedBlock.timestamp + 3600n, allocationDigest: h("synthetic club allocation") };
  const campaignContext = { ...expected.context, verifyingContract: chain.treasury };
  const signature = await consent(claim, campaignContext), input = { safe: expected, campaignContext, claim, signature, checkpoint: result.finalizedBlock };
  const verified = await verifyRewardClubSafeConsent(chain.publicClient, input); assert.equal(verified.signature, signature.toLowerCase());
  assert.equal(verified.observation.finalizedBlock.hash, result.finalizedBlock.hash);
  assert.equal(await chain.publicClient.getBalance({ address: safe }), 0n);
  for (const rejected of [await consent(claim, campaignContext, chain.clubOwners.slice(0, 1)),
    await consent(claim, campaignContext, [chain.clubOwners[0], fixtureSigner(1234)]), await consent(claim, campaignContext, chain.clubOwners.slice(0, 2), false)]) {
    await assert.rejects(verifyRewardClubSafeConsent(chain.publicClient, { ...input, signature: rejected }), { code: "reward_club_consent_observation_unavailable" });
  }
  for (const patch of [{ amount: 101n }, { nonce: 1n }, { allocationDigest: h("changed") }, { pot: "league" }]) {
    await assert.rejects(verifyRewardClubSafeConsent(chain.publicClient, { ...input, claim: { ...claim, ...patch } }));
  }
});
test("a real Safe changing threshold, owners, modules or handler fails the frozen expectation", async t => {
  const owners = await chain.publicClient.readContract({ address: safe, abi: artifacts.singleton.abi, functionName: "getOwners" });
  const changes = [
    ["threshold", "changeThreshold", [1n], "reward_club_two_signatures_required"],
    ["owner", "swapOwner", ["0x0000000000000000000000000000000000000001", owners[0], fixtureSigner(1234).address], "reward_club_owners_changed"],
    ["fourth owner", "addOwnerWithThreshold", [fixtureSigner(1234).address, 2n], "reward_club_three_owners_required"],
    ["module", "enableModule", [fixtureSigner(1234).address], "reward_club_modules_not_supported"],
    ["handler", "setFallbackHandler", [zeroAddress], "reward_club_handler_mismatch"],
  ];
  for (const [name, method, args, code] of changes) await t.test(name, async () => {
    const snapshot = await chain.testClient.snapshot();
    try { await management(method, args); await assert.rejects(readVerifiedRewardClubSafe(chain.publicClient, expected), { code }); }
    finally { await chain.testClient.revert({ id: snapshot }); }
    assert.equal((await readVerifiedRewardClubSafe(chain.publicClient, expected)).threshold, 2);
  });
});
test("an EOA or another genuine Safe component is not a Safe proxy even when supplied as recipient", async () => {
  for (const address of [chain.treasury, expected.fallbackHandlerAddress]) {
    const candidate = { ...expected, context: { ...expected.context, verifyingContract: address },
      ...(address === expected.fallbackHandlerAddress ? { fallbackHandlerAddress: await deploy(artifacts.handler) } : {}) };
    await finalize(); await assert.rejects(readVerifiedRewardClubSafe(chain.publicClient, candidate), { code: "reward_club_proxy_code_mismatch" });
  }
});
test("initialization evidence stays explicitly incomplete even after a quorum action leaves the same visible configuration", async () => {
  await management("changeThreshold", [2n]);
  assert.equal(await chain.publicClient.readContract({ address: safe, abi: artifacts.singleton.abi, functionName: "nonce" }), 1n);
  const result = await readVerifiedRewardClubSafeDeployment(chain.publicClient, provenance);
  assert.equal(result.executionHistoryReviewRequired, true); assert.equal(result.scope, "initialization_only");
  assert.equal(result.safe.threshold, 2);
});
