import assert from "node:assert/strict";
import test from "node:test";
import { decodeFunctionData, getContractAddress, keccak256, serializeTransaction, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { encodeRewardFunding, normalizeRewardFundingPlan, readVerifiedRewardFunding, rewardCampaignAbi, verifySignedRewardFunding } from "../dist/index.js";
import { h } from "./fixtures.mjs";

// Predictable synthetic signers only, never user/operator production keys.
const operator = privateKeyToAccount(toHex(0xA11CEn, { size: 32 }));
const stranger = privateKeyToAccount(toHex(0xB0Bn, { size: 32 }));
const input = () => ({ deployment: { context: { environment: "local-simulation", chainId: 31337,
  verifyingContract: getContractAddress({ from: operator.address, nonce: 0n }) }, operatorAddress: operator.address,
  treasuryAddress: stranger.address, programmeId: h("programme"), campaignId: h("campaign"), programmeManifestHash: h("manifest"),
  enabledPot: 0, deploymentNonce: 0n, deploymentTransactionHash: h("deployment") }, nonce: 6n, expectedAccountedFunding: 3n, expectedBudget: 12n });
const signing = (plan = input()) => ({ ...encodeRewardFunding(plan), type: "eip1559", gas: 200000n, maxFeePerGas: 20000000000n, maxPriorityFeePerGas: 100000000n });
const code = (expected) => (error) => error.code === expected;

test("funding encoding binds the positive fixed budget and exact explicit remainder, including zero-value closure", () => {
  const plan = input(); const normalized = normalizeRewardFundingPlan(plan);
  assert.deepEqual(normalized, plan); assert.notEqual(normalized.deployment, plan.deployment); assert.notEqual(normalized.deployment.context, plan.deployment.context);
  const encoded = encodeRewardFunding(plan); assert.equal(encoded.value, 9n); assert.equal(encoded.nonce, 6);
  assert.equal(encoded.to, plan.deployment.context.verifyingContract);
  assert.deepEqual(decodeFunctionData({ abi: rewardCampaignAbi, data: encoded.data }), { functionName: "completeFunding", args: [3n, 12n] });
  assert.equal(encodeRewardFunding({ ...plan, expectedAccountedFunding: 12n }).value, 0n);
  assert.equal(encodeRewardFunding({ ...plan, expectedAccountedFunding: 0n, expectedBudget: (1n << 256n) - 1n }).value, (1n << 256n) - 1n);
  assert.equal(encodeRewardFunding({ ...plan, deployment: { ...plan.deployment, context: { ...plan.deployment.context, environment: "monad-testnet", chainId: 10143 } } }).chainId, 10143);
});

test("invalid budgets/nonces/networks and mismatched deployment identities fail closed", () => {
  for (const patch of [{ expectedBudget: 0n }, { expectedBudget: 2n }, { expectedBudget: 12 }, { expectedBudget: 1n << 256n },
    { expectedAccountedFunding: -1n }, { expectedAccountedFunding: "3" }, { nonce: 0n }, { nonce: -1n }, { nonce: 1 }, { nonce: BigInt(Number.MAX_SAFE_INTEGER) + 1n }]) {
    assert.throws(() => encodeRewardFunding({ ...input(), ...patch }));
  }
  const plan = input();
  assert.throws(() => encodeRewardFunding({ ...plan, deployment: { ...plan.deployment, context: { ...plan.deployment.context, chainId: 143 } } }), code("unsupported_reward_chain"));
  assert.throws(() => encodeRewardFunding({ ...plan, deployment: { ...plan.deployment, campaignId: "0x00" } }));
});

test("canonical signed funding copies exact economics and permits fee changes without changing them", async () => {
  const plan = input(); const tx = signing(plan); const signed = await operator.signTransaction(tx);
  const result = await verifySignedRewardFunding(plan, signed);
  assert.equal(result.transactionHash, keccak256(signed)); assert.equal(result.value, 9n); assert.equal(result.expectedBudget, 12n);
  assert.equal(result.expectedAccountedFunding, 3n); assert.equal(result.calldataHash, keccak256(tx.data)); assert.equal(result.signedTransaction, signed);
  const feeChange = await verifySignedRewardFunding(plan, await operator.signTransaction({ ...tx, maxFeePerGas: 30000000000n }));
  assert.notEqual(feeChange.transactionHash, result.transactionHash); assert.equal(feeChange.nonce, result.nonce); assert.equal(feeChange.value, result.value);
  assert.equal(feeChange.calldataHash, result.calldataHash);
  const closedPlan = { ...plan, expectedAccountedFunding: 12n };
  assert.equal((await verifySignedRewardFunding(closedPlan, await operator.signTransaction(signing(closedPlan)))).value, 0n);
});

test("signed funding rejects another sender, chain, destination, nonce, value, calldata and access list", async () => {
  const plan = input(); const tx = signing(plan);
  await assert.rejects(verifySignedRewardFunding(plan, await stranger.signTransaction(tx)), code("reward_funding_sender_mismatch"));
  for (const [patch, expected] of [
    [{ chainId: 143 }, "reward_funding_transaction_chain_mismatch"], [{ to: stranger.address }, "reward_funding_destination_mismatch"],
    [{ to: undefined }, "reward_funding_destination_mismatch"], [{ nonce: 7 }, "reward_funding_nonce_mismatch"],
    [{ value: 10n }, "reward_funding_input_mismatch"], [{ data: "0x" }, "reward_funding_input_mismatch"],
    [{ data: `${tx.data}00` }, "reward_funding_input_mismatch"],
    [{ data: encodeRewardFunding({ ...plan, expectedBudget: 13n }).data }, "reward_funding_input_mismatch"],
    [{ accessList: [{ address: stranger.address, storageKeys: [] }] }, "reward_funding_destination_mismatch"],
    [{ gas: 0n }, "invalid_reward_funding_fees"], [{ maxFeePerGas: 0n, maxPriorityFeePerGas: 0n }, "invalid_reward_funding_fees"],
  ]) await assert.rejects(verifySignedRewardFunding(plan, await operator.signTransaction({ ...tx, ...patch })), code(expected));
});

test("unsigned, malformed, oversized and noncanonical signed funding is never accepted", async () => {
  const plan = input(); const tx = signing(plan);
  await assert.rejects(verifySignedRewardFunding(plan, serializeTransaction(tx)), code("reward_unsigned_funding"));
  for (const malformed of [null, "0x", "0x02", "0x02aa", "0x1a", "0x02f", `0x02${"aa".repeat(1025)}`, `${await operator.signTransaction(tx)}00`]) {
    await assert.rejects(verifySignedRewardFunding(plan, malformed));
  }
});

test("funding values are copied before signature recovery yields", async () => {
  const plan = input(); const signed = await operator.signTransaction(signing(plan));
  const pending = verifySignedRewardFunding(plan, signed);
  plan.expectedBudget = 900n; plan.deployment.operatorAddress = stranger.address; plan.deployment.context.chainId = 143;
  const result = await pending;
  assert.equal(result.expectedBudget, 12n); assert.equal(result.chainId, 31337); assert.equal(result.operatorAddress, operator.address.toLowerCase());
});

test("funding reader rejects unsupported contexts and unpinned code before RPC access", async () => {
  let calls = 0; const reader = { getChainId() { calls++; throw new Error("must not call"); } };
  const plan = input();
  await assert.rejects(readVerifiedRewardFunding(reader, plan, "0x02aa", "0x00"), code("reward_creation_code_mismatch"));
  await assert.rejects(readVerifiedRewardFunding(reader, { ...plan, deployment: { ...plan.deployment, context: { ...plan.deployment.context, chainId: 143 } } }, "0x02aa", "0x00"), code("unsupported_reward_chain"));
  assert.equal(calls, 0);
});
