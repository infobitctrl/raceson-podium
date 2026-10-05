import { encodeDeployData, getContractAddress, hashDomain, keccak256, padHex, stringToHex, toHex, type Address, type Hex, type Transaction, type TransactionReceipt } from "viem";
import { rewardCampaignAbi } from "./abi.js";
import { bytes32, demand, rewardChainContext, uint, walletAddress, type RewardChainContext } from "./validation.js";

/** Reviewed compiler output, not caller-configurable allowlisting. A contract change
 * requires rebuilding, reviewing these pins and repeating the local/public gates. */
export const rewardCampaignBuild = Object.freeze({
  id: "raceson-reward-campaign-v2-funding-v1-solc-0.8.36-cancun-ir-200",
  creationCodeHash: "0x57486b6aee9c3f6cc7182982b67243919bea1e2ca05dd034501450bc6d22641e" as Hex,
  runtimeTemplateHash: "0x507b59329ffcc15579fe30bb92857231d14ecbea0e006f51aa73094d19618f65" as Hex,
  runtimeBytes: 9664,
});

// Byte offsets from the pinned compiler's immutableReferences, mapped through its
// AST. Every word is checked, INCLUDING the EIP-712 cached values. None is ignored.
const immutableWords = {
  operator: [905, 1754, 2086, 2297, 2709, 3525, 3603, 4296, 4834, 5762, 5951, 6160, 6538, 6891, 7309],
  treasury: [2411, 3363, 3718, 4664], programmeId: [2595, 2833], campaignId: [2868, 3987],
  programmeManifestHash: [2906, 3929], enabledPot: [2952, 4524, 4918, 6614, 6991],
  _cachedDomainSeparator: [8653], _cachedChainId: [8842], _cachedThis: [8599],
  _hashedName: [8732], _hashedVersion: [8770], _name: [4046], _version: [4087],
} as const;

export type RewardDeploymentSpec = {
  context: RewardChainContext;
  operatorAddress: Address;
  treasuryAddress: Address;
  programmeId: Hex;
  campaignId: Hex;
  programmeManifestHash: Hex;
  enabledPot: 0 | 1;
};
export type RewardDeploymentExpectation = RewardDeploymentSpec & {
  deploymentTransactionHash: Hex;
  deploymentNonce: bigint;
};

export function normalizeRewardDeployment(spec: RewardDeploymentExpectation): RewardDeploymentExpectation {
  const context = rewardChainContext(spec.context);
  demand(spec.enabledPot === 0 || spec.enabledPot === 1, "invalid_reward_pot");
  const result = { context, operatorAddress: walletAddress(spec.operatorAddress), treasuryAddress: walletAddress(spec.treasuryAddress),
    programmeId: bytes32(spec.programmeId), campaignId: bytes32(spec.campaignId), programmeManifestHash: bytes32(spec.programmeManifestHash),
    enabledPot: spec.enabledPot, deploymentTransactionHash: bytes32(spec.deploymentTransactionHash), deploymentNonce: uint(spec.deploymentNonce, 64) };
  // v1 uses direct CREATE by the designated operator, not a factory or proxy.
  demand(getContractAddress({ from: result.operatorAddress, nonce: result.deploymentNonce }) === context.verifyingContract, "reward_deployment_address_mismatch");
  return result;
}

function codeBytes(code: Hex): Hex {
  demand(typeof code === "string" && /^0x(?:[0-9a-fA-F]{2}){1,49152}$/.test(code), "invalid_reward_bytecode");
  return code.toLowerCase() as Hex;
}

export function requireRewardCreationBytecode(code: Hex): Hex {
  const checked = codeBytes(code);
  demand(keccak256(checked) === rewardCampaignBuild.creationCodeHash, "reward_creation_code_mismatch");
  return checked;
}

/** Recover only pinned creation code from the expected direct-deployment input.
 * This is NOT receipt/finality/runtime verification; callers must still perform
 * readVerifiedRewardDeployment/Campaign before trusting the instance. */
export function rewardCreationCodeFromTransaction(input: RewardDeploymentExpectation, tx: Transaction): Hex {
  const expected = normalizeRewardDeployment(input);
  demand(tx.chainId === expected.context.chainId && bytes32(tx.hash) === expected.deploymentTransactionHash
    && tx.to === null && tx.value === 0n && walletAddress(tx.from) === expected.operatorAddress
    && Number.isSafeInteger(tx.nonce) && BigInt(tx.nonce) === expected.deploymentNonce, "reward_deployment_transaction_mismatch");
  const encoded = codeBytes(tx.input);
  // Six static ABI constructor words, no dynamic suffix/metadata heuristics.
  demand(encoded.length > 2 + 6 * 64, "reward_deployment_input_mismatch");
  const creationCode = requireRewardCreationBytecode(encoded.slice(0, -6 * 64) as Hex);
  demand(encodeRewardDeployment(expected, creationCode) === encoded, "reward_deployment_input_mismatch");
  return creationCode;
}

/** Encoding only. Does not create keys, sign, deploy, fund or approve publication. */
export function encodeRewardDeployment(spec: RewardDeploymentSpec, creationCode: Hex): Hex {
  rewardChainContext(spec.context);
  demand(spec.enabledPot === 0 || spec.enabledPot === 1, "invalid_reward_pot");
  return encodeDeployData({ abi: rewardCampaignAbi, bytecode: requireRewardCreationBytecode(creationCode), args: [
    walletAddress(spec.operatorAddress), walletAddress(spec.treasuryAddress), bytes32(spec.programmeId),
    bytes32(spec.campaignId), bytes32(spec.programmeManifestHash), spec.enabledPot,
  ] });
}

/** Validate a locally compiled artifact against fixed pins. Compiler-dependent
 * AST IDs are not stable pins; exact offsets and actual runtime values are. */
export function requireRewardBuildArtifact(artifact: {
  bytecode: { object: Hex; linkReferences: Record<string, unknown> };
  deployedBytecode: { object: Hex; linkReferences: Record<string, unknown>; immutableReferences: Record<string, { start: number; length: number }[]> };
}): void {
  requireRewardCreationBytecode(artifact.bytecode.object);
  const runtime = codeBytes(artifact.deployedBytecode.object);
  demand(runtime.length === 2 + rewardCampaignBuild.runtimeBytes * 2 && keccak256(runtime) === rewardCampaignBuild.runtimeTemplateHash, "reward_runtime_template_mismatch");
  demand(Object.keys(artifact.bytecode.linkReferences).length === 0 && Object.keys(artifact.deployedBytecode.linkReferences).length === 0, "reward_unexpected_link_references");
  const references = Object.values(artifact.deployedBytecode.immutableReferences).flat();
  demand(references.every((ref) => ref.length === 32), "reward_immutable_layout_mismatch");
  const actual = references.map((ref) => ref.start).sort((a, b) => a - b);
  const expected = Object.values(immutableWords).flat().sort((a, b) => a - b);
  demand(actual.length === expected.length && actual.every((offset, i) => offset === expected[i]), "reward_immutable_layout_mismatch");
}

export function verifyRewardRuntime(spec: RewardDeploymentSpec, code: Hex): Hex {
  const context = rewardChainContext(spec.context);
  demand(spec.enabledPot === 0 || spec.enabledPot === 1, "invalid_reward_pot");
  const runtime = codeBytes(code);
  demand(runtime.length === 2 + rewardCampaignBuild.runtimeBytes * 2, "reward_runtime_code_mismatch");
  const name = "RacesOnRewardCampaign";
  const version = "2";
  // OpenZeppelin ShortStrings stores UTF-8 left-aligned in 31 bytes, then length.
  // These fixed ASCII literals cannot enter the long-string storage fallback.
  const shortString = (text: string) => `${padHex(stringToHex(text), { size: 31, dir: "right" })}${toHex(text.length, { size: 1 }).slice(2)}` as Hex;
  const values: Record<keyof typeof immutableWords, Hex> = {
    operator: padHex(walletAddress(spec.operatorAddress)), treasury: padHex(walletAddress(spec.treasuryAddress)),
    programmeId: bytes32(spec.programmeId), campaignId: bytes32(spec.campaignId), programmeManifestHash: bytes32(spec.programmeManifestHash),
    enabledPot: toHex(spec.enabledPot, { size: 32 }), _cachedChainId: toHex(context.chainId, { size: 32 }),
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
  demand(keccak256(template) === rewardCampaignBuild.runtimeTemplateHash, "reward_runtime_code_mismatch");
  return keccak256(runtime);
}

export type RewardDeploymentObservation = {
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
export function verifyRewardDeployment(input: RewardDeploymentExpectation, creationCode: Hex, observed: RewardDeploymentObservation) {
  const expected = normalizeRewardDeployment(input);
  demand(observed.observedChainId === expected.context.chainId, "reward_observed_chain_mismatch");
  const { transaction: tx, receipt, finalizedBlock } = observed;
  demand(tx.chainId === expected.context.chainId, "reward_deployment_transaction_chain_mismatch");
  demand(receipt.status === "success", "reward_deployment_reverted");
  demand(bytes32(tx.hash) === expected.deploymentTransactionHash && bytes32(receipt.transactionHash) === expected.deploymentTransactionHash, "reward_deployment_transaction_mismatch");
  demand(tx.to === null && receipt.to === null && tx.value === 0n, "reward_not_direct_deployment");
  demand(walletAddress(tx.from) === expected.operatorAddress && walletAddress(receipt.from) === expected.operatorAddress, "reward_deployment_sender_mismatch");
  demand(Number.isSafeInteger(tx.nonce) && tx.nonce >= 0 && BigInt(tx.nonce) === expected.deploymentNonce, "reward_deployment_nonce_mismatch");
  demand(receipt.contractAddress !== null && receipt.contractAddress !== undefined && walletAddress(receipt.contractAddress) === expected.context.verifyingContract, "reward_deployment_address_mismatch");
  demand(typeof tx.input === "string" && tx.input.toLowerCase() === encodeRewardDeployment(expected, creationCode), "reward_deployment_input_mismatch");
  const blockNumber = uint(receipt.blockNumber);
  const blockHash = bytes32(receipt.blockHash);
  demand(tx.blockNumber === blockNumber && tx.blockHash !== null && bytes32(tx.blockHash) === blockHash
    && Number.isSafeInteger(receipt.transactionIndex) && receipt.transactionIndex >= 0 && tx.transactionIndex === receipt.transactionIndex, "reward_deployment_receipt_mismatch");
  demand(blockHash === bytes32(observed.canonicalDeploymentBlockHash), "reward_deployment_not_canonical");
  demand(blockNumber <= uint(finalizedBlock.number), "reward_deployment_not_finalized");
  const finalizedHash = bytes32(finalizedBlock.hash);
  demand(blockNumber !== finalizedBlock.number || blockHash === finalizedHash, "reward_deployment_not_canonical");
  const runtimeCodeHash = verifyRewardRuntime(expected, observed.runtimeCode);
  return { ...expected, buildId: rewardCampaignBuild.id, creationCodeHash: rewardCampaignBuild.creationCodeHash, runtimeCodeHash,
    deploymentBlockNumber: blockNumber, deploymentBlockHash: blockHash,
    finalizedBlock: { number: finalizedBlock.number, hash: finalizedHash, timestamp: uint(finalizedBlock.timestamp) } };
}
