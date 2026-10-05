// Explicit V3 artifact boundary. Do not repin or relabel the historical V1 verifier.
import { encodeDeployData, getContractAddress, hashDomain, keccak256, padHex, stringToHex, toHex, type Address, type Hex, type Transaction, type TransactionReceipt } from "viem";
import { rewardCampaignV3Abi as rewardCampaignAbi } from "./campaign-v3.js";
import { bytes32, demand, rewardChainContext, uint, walletAddress, type RewardChainContext } from "./validation.js";

/** Reviewed compiler output, not caller-configurable allowlisting. A contract change
 * requires rebuilding, reviewing these pins and repeating the local/public gates. */
export const rewardCampaignV3Build = Object.freeze({
  id: "raceson-reward-campaign-v3-final-results-solc-0.8.36-cancun-ir-200",
  creationCodeHash: "0xd098f5539b20572cabb67c3c8a8bdb1740a05be8ef1a7679060228d85e7f2190" as Hex,
  runtimeTemplateHash: "0x54ab7fc0f881e3d752a11d45a7bb3cfbd49a0867ad5faac02ae7032abc950e96" as Hex,
  runtimeBytes: 10034,
});

// Byte offsets from the pinned compiler's immutableReferences, mapped through its
// AST. Every word is checked, INCLUDING the EIP-712 cached values. None is ignored.
const immutableWords = {
  operator: [967,1816,2148,2359,2936,3009,3758,3968,5146,6074,6263,6472,6908,7290,7708],
  treasury: [2473,2774,3124,4976], programmeId: [2657,4165], campaignId: [3449,4200],
  programmeManifestHash: [3362,4238], enabledPot: [4284,4836,5230,6984,7390],
  reviewPeriod: [4122,4634,6716],
  _cachedDomainSeparator: [9023], _cachedChainId: [9212], _cachedThis: [8969],
  _hashedName: [9102], _hashedVersion: [9140], _name: [3508], _version: [3549],
} as const;

export type RewardDeploymentSpecV3 = {
  context: RewardChainContext;
  operatorAddress: Address;
  treasuryAddress: Address;
  programmeId: Hex;
  campaignId: Hex;
  programmeManifestHash: Hex;
  enabledPot: 0 | 1;
  reviewPeriod: bigint;
};
export type RewardDeploymentExpectationV3 = RewardDeploymentSpecV3 & {
  deploymentTransactionHash: Hex;
  deploymentNonce: bigint;
};

export function normalizeRewardDeploymentV3(spec: RewardDeploymentExpectationV3): RewardDeploymentExpectationV3 {
  const context = rewardChainContext(spec.context);
  demand(spec.enabledPot === 0 || spec.enabledPot === 1, "invalid_reward_pot");
  const result = { context, operatorAddress: walletAddress(spec.operatorAddress), treasuryAddress: walletAddress(spec.treasuryAddress),
    programmeId: bytes32(spec.programmeId), campaignId: bytes32(spec.campaignId), programmeManifestHash: bytes32(spec.programmeManifestHash),
    enabledPot: spec.enabledPot, reviewPeriod: uint(spec.reviewPeriod, 64), deploymentTransactionHash: bytes32(spec.deploymentTransactionHash), deploymentNonce: uint(spec.deploymentNonce, 64) };
  // This V3 boundary uses direct CREATE by the designated operator, not a factory or proxy.
  demand(getContractAddress({ from: result.operatorAddress, nonce: result.deploymentNonce }) === context.verifyingContract, "reward_deployment_address_mismatch");
  return result;
}

function codeBytes(code: Hex): Hex {
  demand(typeof code === "string" && /^0x(?:[0-9a-fA-F]{2}){1,49152}$/.test(code), "invalid_reward_bytecode");
  return code.toLowerCase() as Hex;
}

export function requireRewardCreationBytecodeV3(code: Hex): Hex {
  const checked = codeBytes(code);
  demand(keccak256(checked) === rewardCampaignV3Build.creationCodeHash, "reward_creation_code_mismatch");
  return checked;
}

/** Recover only pinned creation code from the expected direct-deployment input.
 * This is NOT receipt/finality/runtime verification; callers must still perform
 * readVerifiedRewardDeployment/Campaign before trusting the instance. */
export function rewardCreationCodeFromTransactionV3(input: RewardDeploymentExpectationV3, tx: Transaction): Hex {
  const expected = normalizeRewardDeploymentV3(input);
  demand(tx.chainId === expected.context.chainId && bytes32(tx.hash) === expected.deploymentTransactionHash
    && tx.to === null && tx.value === 0n && walletAddress(tx.from) === expected.operatorAddress
    && Number.isSafeInteger(tx.nonce) && BigInt(tx.nonce) === expected.deploymentNonce, "reward_deployment_transaction_mismatch");
  const encoded = codeBytes(tx.input);
  // Seven static ABI constructor words, no dynamic suffix/metadata heuristics.
  demand(encoded.length > 2 + 7 * 64, "reward_deployment_input_mismatch");
  const creationCode = requireRewardCreationBytecodeV3(encoded.slice(0, -7 * 64) as Hex);
  demand(encodeRewardDeploymentV3(expected, creationCode) === encoded, "reward_deployment_input_mismatch");
  return creationCode;
}

/** Encoding only. Does not create keys, sign, deploy, fund or approve publication. */
export function encodeRewardDeploymentV3(spec: RewardDeploymentSpecV3, creationCode: Hex): Hex {
  rewardChainContext(spec.context);
  demand(spec.enabledPot === 0 || spec.enabledPot === 1, "invalid_reward_pot");
  return encodeDeployData({ abi: rewardCampaignAbi, bytecode: requireRewardCreationBytecodeV3(creationCode), args: [
    walletAddress(spec.operatorAddress), walletAddress(spec.treasuryAddress), bytes32(spec.programmeId),
    bytes32(spec.campaignId), bytes32(spec.programmeManifestHash), spec.enabledPot, uint(spec.reviewPeriod, 64),
  ] });
}

/** Validate a locally compiled artifact against fixed pins. Compiler-dependent
 * AST IDs are not stable pins; exact offsets and actual runtime values are. */
export function requireRewardBuildArtifactV3(artifact: {
  bytecode: { object: Hex; linkReferences: Record<string, unknown> };
  deployedBytecode: { object: Hex; linkReferences: Record<string, unknown>; immutableReferences: Record<string, { start: number; length: number }[]> };
}): void {
  requireRewardCreationBytecodeV3(artifact.bytecode.object);
  const runtime = codeBytes(artifact.deployedBytecode.object);
  demand(runtime.length === 2 + rewardCampaignV3Build.runtimeBytes * 2 && keccak256(runtime) === rewardCampaignV3Build.runtimeTemplateHash, "reward_runtime_template_mismatch");
  demand(Object.keys(artifact.bytecode.linkReferences).length === 0 && Object.keys(artifact.deployedBytecode.linkReferences).length === 0, "reward_unexpected_link_references");
  const references = Object.values(artifact.deployedBytecode.immutableReferences).flat();
  demand(references.every((ref) => ref.length === 32), "reward_immutable_layout_mismatch");
  const actual = references.map((ref) => ref.start).sort((a, b) => a - b);
  const expected = Object.values(immutableWords).flat().sort((a, b) => a - b);
  demand(actual.length === expected.length && actual.every((offset, i) => offset === expected[i]), "reward_immutable_layout_mismatch");
}

export function verifyRewardRuntimeV3(spec: RewardDeploymentSpecV3, code: Hex): Hex {
  const context = rewardChainContext(spec.context);
  demand(spec.enabledPot === 0 || spec.enabledPot === 1, "invalid_reward_pot");
  const runtime = codeBytes(code);
  demand(runtime.length === 2 + rewardCampaignV3Build.runtimeBytes * 2, "reward_runtime_code_mismatch");
  const name = "RacesOnRewardCampaign";
  const version = "4";
  // OpenZeppelin ShortStrings stores UTF-8 left-aligned in 31 bytes, then length.
  // These fixed ASCII literals cannot enter the long-string storage fallback.
  const shortString = (text: string) => `${padHex(stringToHex(text), { size: 31, dir: "right" })}${toHex(text.length, { size: 1 }).slice(2)}` as Hex;
  const values: Record<keyof typeof immutableWords, Hex> = {
    operator: padHex(walletAddress(spec.operatorAddress)), treasury: padHex(walletAddress(spec.treasuryAddress)),
    programmeId: bytes32(spec.programmeId), campaignId: bytes32(spec.campaignId), programmeManifestHash: bytes32(spec.programmeManifestHash),
    reviewPeriod: toHex(uint(spec.reviewPeriod, 64), { size: 32 }), enabledPot: toHex(spec.enabledPot, { size: 32 }), _cachedChainId: toHex(context.chainId, { size: 32 }),
    _cachedThis: padHex(context.verifyingContract), _hashedName: keccak256(stringToHex(name)), _hashedVersion: keccak256(stringToHex(version)),
    _name: shortString(name), _version: shortString(version),
    _cachedDomainSeparator: hashDomain({ domain: { name, version, chainId: BigInt(context.chainId), verifyingContract: context.verifyingContract }, types: {
      EIP712Domain: [{ name: "name", type: "string" }, { name: "version", type: "string" }, { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" }],
    } }),
  };
  let template = runtime;
  for (const [field, offsets] of Object.entries(immutableWords)) {
    const expected = values[field as keyof typeof immutableWords].slice(2).toLowerCase();
    for (const offset of offsets) {
      const start = 2 + offset * 2;
      demand(runtime.slice(start, start + 64) === expected, "reward_runtime_immutable_mismatch");
      template = `${template.slice(0, start)}${"0".repeat(64)}${template.slice(start + 64)}` as Hex;
    }
  }
  demand(keccak256(template) === rewardCampaignV3Build.runtimeTemplateHash, "reward_runtime_code_mismatch");
  return keccak256(runtime);
}

export type RewardDeploymentObservationV3 = {
  observedChainId: number;
  transaction: Transaction;
  receipt: TransactionReceipt;
  canonicalDeploymentBlockHash: Hex;
  finalizedBlock: { number: bigint; hash: Hex; timestamp: bigint };
  runtimeCode: Hex;
};

/** Observations must come from the trusted worker RPC, not browser JSON. Exact
 * creation provenance and every runtime byte are required; getters alone are not
 * identity. The result is a checkpoint, NOT a perpetual permission to transact. */
export function verifyRewardDeploymentV3(input: RewardDeploymentExpectationV3, creationCode: Hex, observed: RewardDeploymentObservationV3) {
  const expected = normalizeRewardDeploymentV3(input);
  demand(observed.observedChainId === expected.context.chainId, "reward_observed_chain_mismatch");
  const { transaction: tx, receipt, finalizedBlock } = observed;
  demand(tx.chainId === expected.context.chainId, "reward_deployment_transaction_chain_mismatch");
  demand(receipt.status === "success", "reward_deployment_reverted");
  demand(bytes32(tx.hash) === expected.deploymentTransactionHash && bytes32(receipt.transactionHash) === expected.deploymentTransactionHash, "reward_deployment_transaction_mismatch");
  demand(tx.to === null && receipt.to === null && tx.value === 0n, "reward_not_direct_deployment");
  demand(walletAddress(tx.from) === expected.operatorAddress && walletAddress(receipt.from) === expected.operatorAddress, "reward_deployment_sender_mismatch");
  demand(Number.isSafeInteger(tx.nonce) && tx.nonce >= 0 && BigInt(tx.nonce) === expected.deploymentNonce, "reward_deployment_nonce_mismatch");
  demand(receipt.contractAddress !== null && receipt.contractAddress !== undefined && walletAddress(receipt.contractAddress) === expected.context.verifyingContract, "reward_deployment_address_mismatch");
  demand(typeof tx.input === "string" && tx.input.toLowerCase() === encodeRewardDeploymentV3(expected, creationCode), "reward_deployment_input_mismatch");
  const blockNumber = uint(receipt.blockNumber);
  const blockHash = bytes32(receipt.blockHash);
  demand(tx.blockNumber === blockNumber && tx.blockHash !== null && bytes32(tx.blockHash) === blockHash
    && Number.isSafeInteger(receipt.transactionIndex) && receipt.transactionIndex >= 0 && tx.transactionIndex === receipt.transactionIndex, "reward_deployment_receipt_mismatch");
  demand(blockHash === bytes32(observed.canonicalDeploymentBlockHash), "reward_deployment_not_canonical");
  demand(blockNumber <= uint(finalizedBlock.number), "reward_deployment_not_finalized");
  const finalizedHash = bytes32(finalizedBlock.hash);
  demand(blockNumber !== finalizedBlock.number || blockHash === finalizedHash, "reward_deployment_not_canonical");
  const runtimeCodeHash = verifyRewardRuntimeV3(expected, observed.runtimeCode);
  return { ...expected, buildId: rewardCampaignV3Build.id, creationCodeHash: rewardCampaignV3Build.creationCodeHash, runtimeCodeHash,
    deploymentBlockNumber: blockNumber, deploymentBlockHash: blockHash,
    finalizedBlock: { number: finalizedBlock.number, hash: finalizedHash, timestamp: uint(finalizedBlock.timestamp) } };
}
