import assert from "node:assert/strict";
import test from "node:test";
import { getContractAddress } from "viem";
import { normalizeRewardDeployment, readVerifiedRewardDeployment, requireRewardCreationBytecode, readRewardCreationBytecode,
  rewardCreationCodeFromTransaction, RewardProtocolError } from "../dist/index.js";
import { h } from "./fixtures.mjs";

const operatorAddress = "0x0000000000000000000000000000000000000123";
const expected = () => ({ context: { environment: "local-simulation", chainId: 31337, verifyingContract: getContractAddress({ from: operatorAddress, nonce: 0n }) },
  operatorAddress, treasuryAddress: "0x0000000000000000000000000000000000000456", programmeId: h("programme"), campaignId: h("campaign"),
  programmeManifestHash: h("manifest"), enabledPot: 0, deploymentTransactionHash: h("deployment"), deploymentNonce: 0n });
const errorCode = (code) => (error) => error instanceof RewardProtocolError && error.code === code;

test("runtime creation-code resolution rejects unpinned inputs, foreign deployment identity and unsafe networks", async () => {
  const spec=expected();const tx={hash:spec.deploymentTransactionHash,chainId:31337,nonce:0,from:operatorAddress,to:null,value:0n,
    input:`0x${"00".repeat(193)}`};
  assert.throws(()=>rewardCreationCodeFromTransaction(spec,tx),errorCode("reward_creation_code_mismatch"));
  for(const patch of [{chainId:143},{from:spec.treasuryAddress},{to:operatorAddress},{value:1n},{nonce:1},{hash:h("other")}])
    assert.throws(()=>rewardCreationCodeFromTransaction(spec,{...tx,...patch}),errorCode("reward_deployment_transaction_mismatch"));
  let calls=0;
  await assert.rejects(readRewardCreationBytecode({getChainId:async()=>143,getTransaction:async()=>{calls++;return tx;}},spec),errorCode("reward_observed_chain_mismatch"));
  assert.equal(calls,0);
  await assert.rejects(readRewardCreationBytecode({getChainId:async()=>{throw new Error("private endpoint");}},spec),errorCode("reward_deployment_observation_unavailable"));
  await assert.rejects(readRewardCreationBytecode({}, {...spec,context:{...spec.context,chainId:143}}),errorCode("unsupported_reward_chain"));
});

test("deployment expectations copy supported context and require the operator's exact CREATE address", () => {
  const input = expected(); const result = normalizeRewardDeployment(input);
  assert.deepEqual(result, input); assert.notEqual(result.context, input.context);
  const testnet = { ...input, context: { ...input.context, environment: "monad-testnet", chainId: 10143 } };
  assert.equal(normalizeRewardDeployment(testnet).context.chainId, 10143);
  assert.throws(() => normalizeRewardDeployment({ ...input, deploymentNonce: 1n }), errorCode("reward_deployment_address_mismatch"));
  for (const nonce of [-1n, 2n ** 64n, 0, "0"]) assert.throws(() => normalizeRewardDeployment({ ...input, deploymentNonce: nonce }), errorCode("invalid_reward_uint"));
  for (const pot of [-1, 2, "0"]) assert.throws(() => normalizeRewardDeployment({ ...input, enabledPot: pot }), errorCode("invalid_reward_pot"));
  assert.throws(() => normalizeRewardDeployment({ ...input, programmeId: `0x${"0".repeat(64)}` }), errorCode("zero_reward_identifier"));
});

test("unsupported networks and unpinned creation code fail before any RPC call", async () => {
  let calls = 0;
  const reader = { getChainId() { calls++; throw new Error("must not call"); } };
  for (const context of [{ environment: "monad-testnet", chainId: 143 }, { environment: "local-simulation", chainId: 10143 }]) {
    const input = expected(); input.context = { ...input.context, ...context };
    await assert.rejects(readVerifiedRewardDeployment(reader, input, "0x00"), errorCode("unsupported_reward_chain"));
  }
  await assert.rejects(readVerifiedRewardDeployment(reader, expected(), "0x00"), errorCode("reward_creation_code_mismatch"));
  for (const code of ["0x", "0xz1", "0x1", null, `0x${"00".repeat(49153)}`]) assert.throws(() => requireRewardCreationBytecode(code), errorCode("invalid_reward_bytecode"));
  assert.equal(calls, 0);
});
