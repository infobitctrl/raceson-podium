import { concatHex, decodeFunctionData, encodeAbiParameters, encodeEventTopics, encodeFunctionData, getCreate2Address, keccak256,
  parseAbi, type Address, type Hex, type PublicClient, zeroAddress } from "viem";
import { normalizeRewardClubSafeExpectation, readVerifiedRewardClubSafe, rewardClubSafeBuild,
  type RewardClubSafeExpectation, type RewardClubSafeReader, type RewardSafeBlock } from "./club-safe.js";
import { bytes32, demand, RewardProtocolError, uint, walletAddress } from "./validation.js";

/** Original 1.4.1-2 factory artifact, not a factory address/version allowlist. */
export const rewardClubSafeDeploymentBuild = Object.freeze({
  id: "safe-1.4.1-original-direct-initialization-v1",
  factory: Object.freeze({ bytes: 3054, hash: "0x50c3cdc4074750a7a974204a716c999edd37482f907608d960b2b025ee0b3317" }),
  proxyCreation: Object.freeze({ bytes: 486, hash: "0x1856e0ee08399d74e0ea0b03adca210aeade6f748969ac023cdcb4dd62dcaf5f" }),
} as const);
export const rewardClubSafeDeploymentAbi = parseAbi([
  "function createProxyWithNonce(address _singleton, bytes initializer, uint256 saltNonce) returns (address proxy)",
  "function proxyCreationCode() pure returns (bytes)",
  "function setup(address[] _owners, uint256 _threshold, address to, bytes data, address fallbackHandler, address paymentToken, uint256 payment, address paymentReceiver)",
  "event SafeSetup(address indexed initiator, address[] owners, uint256 threshold, address initializer, address fallbackHandler)",
  "event ProxyCreation(address indexed proxy, address singleton)",
]);
export type RewardClubSafeDeploymentExpectation = {
  safe: RewardClubSafeExpectation; factoryAddress: Address; deploymentTransactionHash: Hex; initializationSaltNonce?: bigint;
};
export type RewardClubSafeDeploymentReader = RewardClubSafeReader & Pick<PublicClient, "getTransaction" | "getTransactionReceipt">;

function pin(value: Hex | undefined, expected: { bytes: number; hash: string }, code: string) {
  demand(typeof value === "string" && /^0x[0-9a-fA-F]+$/.test(value) && value.length === 2 + expected.bytes * 2 && keccak256(value) === expected.hash, code);
}
function checkpoint(input: RewardSafeBlock): RewardSafeBlock {
  return { number: uint(input.number), hash: bytes32(input.hash), timestamp: uint(input.timestamp) };
}

/** Read-only initialization provenance plus a separate finalized configuration.
 * This does NOT certify subsequent execution history, hidden storage, independent
 * controllers or club authority; it never approves a treasury. See CLUB-SAFES.md.
 * Only a direct createProxyWithNonce with atomic, no-delegatecall/no-payment setup
 * is supported. Factory/singleton/handler must exist before the deployment block. */
export async function readVerifiedRewardClubSafeDeployment(reader: RewardClubSafeDeploymentReader,
  input: RewardClubSafeDeploymentExpectation, requestedCheckpoint?: RewardSafeBlock) {
  // Freeze trusted caller expectations, including nested owners, before any IO.
  const safe = normalizeRewardClubSafeExpectation(input.safe), factoryAddress = walletAddress(input.factoryAddress);
  const expectedSalt = input.initializationSaltNonce===undefined?null:uint(input.initializationSaltNonce);
  const hash = bytes32(input.deploymentTransactionHash), requested = requestedCheckpoint ? checkpoint(requestedCheckpoint) : null;
  demand(![safe.context.verifyingContract, safe.singletonAddress, safe.fallbackHandlerAddress].includes(factoryAddress), "reward_club_factory_address_mismatch");
  try {
    demand(await reader.getChainId() === safe.context.chainId, "reward_observed_chain_mismatch");
    const finalized = await reader.getBlock({ blockTag: "finalized" });
    demand(finalized.number !== null && finalized.hash !== null, "reward_finalized_block_missing");
    const floor = checkpoint({ number: finalized.number, hash: finalized.hash, timestamp: finalized.timestamp }), at = requested ?? floor;
    demand(at.number <= floor.number && at.timestamp <= floor.timestamp, "reward_club_checkpoint_not_finalized");
    const [tx, receipt] = await Promise.all([reader.getTransaction({ hash }), reader.getTransactionReceipt({ hash })]);
    const sponsored=expectedSalt!==null&&tx.to?.toLowerCase()!==factoryAddress.toLowerCase();
    demand(bytes32(tx.hash) === hash && bytes32(receipt.transactionHash) === hash && tx.chainId === safe.context.chainId
      && tx.to !== null && receipt.to !== null && walletAddress(tx.to) === walletAddress(receipt.to) && (sponsored || walletAddress(tx.to) === factoryAddress)
      && walletAddress(tx.from) === walletAddress(receipt.from) && tx.value === 0n && receipt.contractAddress === null,
    "reward_club_deployment_transaction_mismatch");
    demand(receipt.status === "success" && tx.blockNumber !== null && tx.blockHash !== null && tx.transactionIndex !== null
      && Number.isSafeInteger(tx.transactionIndex) && tx.transactionIndex >= 0 && tx.transactionIndex === receipt.transactionIndex
      && tx.blockNumber === receipt.blockNumber && bytes32(tx.blockHash) === bytes32(receipt.blockHash), "reward_club_deployment_not_mined");
    const number = uint(receipt.blockNumber);
    demand(number > 0n && number <= at.number, "reward_club_deployment_not_finalized");
    const [deploymentBlock, parent] = await Promise.all([reader.getBlock({ blockNumber: number }), reader.getBlock({ blockNumber: number - 1n })]);
    demand(deploymentBlock.number === number && deploymentBlock.hash !== null && bytes32(deploymentBlock.hash) === bytes32(receipt.blockHash)
      && parent.number === number - 1n && parent.hash !== null && bytes32(deploymentBlock.parentHash) === bytes32(parent.hash),
    "reward_club_deployment_not_canonical");
    const deployed = checkpoint({ number, hash: deploymentBlock.hash, timestamp: deploymentBlock.timestamp });
    const preceding = checkpoint({ number: parent.number, hash: parent.hash, timestamp: parent.timestamp });
    demand(preceding.timestamp <= deployed.timestamp && deployed.timestamp <= at.timestamp, "reward_club_deployment_not_canonical");

    // End-of-block code alone is not execution-time evidence. These immutable
    // pinned implementations must also be present in the canonical parent state.
    const dependencies = [
      [factoryAddress, rewardClubSafeDeploymentBuild.factory, "reward_club_factory_code_mismatch"],
      [safe.singletonAddress, rewardClubSafeBuild.singleton, "reward_club_singleton_code_mismatch"],
      [safe.fallbackHandlerAddress, rewardClubSafeBuild.handler, "reward_club_handler_code_mismatch"],
    ] as const;
    await Promise.all([number - 1n, number].flatMap(blockNumber => dependencies.map(async ([address, expected, code]) =>
      pin(await reader.getCode({ address, blockNumber }), expected, code))));

    // Bound decoding; a supported three-owner setup and factory call have fixed
    // canonical lengths. Reject callbacks, batches, trailing data and ABI aliases.
    // For app-paid wrapper transactions, CREATE2 commits to the exact canonical
    // initializer and saved salt. Original factory + SafeSetup logs prove atomic
    // initialization, independently of the bundler's outer calldata or gas payer.
    // This mode is opt-in with a server-owned immutable creation salt.
    const deploymentInput=sponsored?encodeFunctionData({abi:rewardClubSafeDeploymentAbi,functionName:'createProxyWithNonce',args:[safe.singletonAddress,
      encodeFunctionData({abi:rewardClubSafeDeploymentAbi,functionName:'setup',args:[[...safe.owners],2n,zeroAddress,'0x',safe.fallbackHandlerAddress,zeroAddress,0n,zeroAddress]}),expectedSalt!]}):tx.input;
    demand(typeof deploymentInput === "string" && /^0x[0-9a-fA-F]{1160}$/.test(deploymentInput), "reward_club_deployment_call_not_supported");
    const call = decodeFunctionData({ abi: rewardClubSafeDeploymentAbi, data: deploymentInput });
    demand(call.functionName === "createProxyWithNonce", "reward_club_deployment_call_not_supported");
    const [singleton, initializer, saltNonce] = call.args;
    demand(walletAddress(singleton) === safe.singletonAddress && /^0x[0-9a-fA-F]{840}$/.test(initializer), "reward_club_setup_not_supported");
    const setup = decodeFunctionData({ abi: rewardClubSafeDeploymentAbi, data: initializer });
    demand(setup.functionName === "setup", "reward_club_setup_not_supported");
    const setupOwners = [...setup.args[0]];
    const normalizedOwners = normalizeRewardClubSafeExpectation({ ...safe, owners: setupOwners }).owners;
    demand(normalizedOwners.every((owner, i) => owner === safe.owners[i]), "reward_club_setup_owners_mismatch");
    const canonicalInitializer = encodeFunctionData({ abi: rewardClubSafeDeploymentAbi, functionName: "setup",
      args: [setupOwners, 2n, zeroAddress, "0x", safe.fallbackHandlerAddress, zeroAddress, 0n, zeroAddress] });
    demand(initializer.toLowerCase() === canonicalInitializer, "reward_club_setup_not_supported");
    demand(deploymentInput.toLowerCase() === encodeFunctionData({ abi: rewardClubSafeDeploymentAbi, functionName: "createProxyWithNonce",
      args: [safe.singletonAddress, canonicalInitializer, saltNonce] }), "reward_club_deployment_call_not_supported");
    const creation = await reader.readContract({ address: factoryAddress, abi: rewardClubSafeDeploymentAbi, functionName: "proxyCreationCode", blockNumber: number });
    pin(creation, rewardClubSafeDeploymentBuild.proxyCreation, "reward_club_proxy_creation_code_mismatch");
    const salt = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }], [keccak256(canonicalInitializer), uint(saltNonce)]));
    const predicted = getCreate2Address({ from: factoryAddress, salt,
      bytecode: concatHex([creation, encodeAbiParameters([{ type: "address" }], [safe.singletonAddress])]) });
    demand(predicted === safe.context.verifyingContract, "reward_club_create2_address_mismatch");

    const expectedLogs = [
      { address: predicted, topics: encodeEventTopics({ abi: rewardClubSafeDeploymentAbi, eventName: "SafeSetup", args: { initiator: factoryAddress } }),
        data: encodeAbiParameters([{ type: "address[]" }, { type: "uint256" }, { type: "address" }, { type: "address" }],
          [setupOwners, 2n, zeroAddress, safe.fallbackHandlerAddress]) },
      { address: factoryAddress, topics: encodeEventTopics({ abi: rewardClubSafeDeploymentAbi, eventName: "ProxyCreation", args: { proxy: predicted } }),
        data: encodeAbiParameters([{ type: "address" }], [safe.singletonAddress]) },
    ];
    const deploymentLogs=sponsored?receipt.logs.filter(log=>[factoryAddress,safe.context.verifyingContract].some(address=>log.address.toLowerCase()===address.toLowerCase())):receipt.logs;
    demand(deploymentLogs.length === expectedLogs.length, "reward_club_deployment_events_mismatch");
    deploymentLogs.forEach((log, i) => {
      const expected = expectedLogs[i]!;
      demand(log.removed === false && log.transactionHash !== null && bytes32(log.transactionHash) === hash && log.blockNumber === number
        && log.blockHash !== null && bytes32(log.blockHash) === deployed.hash && log.transactionIndex === tx.transactionIndex
        && log.logIndex !== null && Number.isSafeInteger(log.logIndex) && log.logIndex >= 0
        && (i === 0 || log.logIndex === deploymentLogs[i - 1]!.logIndex! + 1)
        && walletAddress(log.address) === expected.address && log.data.toLowerCase() === expected.data
        && log.topics.length === expected.topics.length && log.topics.every((topic, j) => topic.toLowerCase() === expected.topics[j]),
      "reward_club_deployment_events_mismatch");
    });
    const observation = await readVerifiedRewardClubSafe(reader, safe, at);
    // Configuration checks are separate from history. Recheck both historical
    // boundaries and the original finality floor after every code/receipt read.
    const [chain, head, canonical, deploymentAgain, parentAgain] = await Promise.all([
      reader.getChainId(), reader.getBlock({ blockTag: "finalized" }), reader.getBlock({ blockNumber: at.number }),
      reader.getBlock({ blockNumber: number }), reader.getBlock({ blockNumber: number - 1n }),
    ]);
    demand(chain === safe.context.chainId, "reward_observed_chain_mismatch");
    demand(head.number !== null && head.hash !== null && uint(head.number) >= observation.observedFinalizedHead.number
      && head.number >= floor.number && uint(head.timestamp) >= floor.timestamp
      && head.timestamp >= observation.observedFinalizedHead.timestamp, "reward_finality_regressed");
    demand(canonical.number === at.number && canonical.hash !== null && bytes32(canonical.hash) === at.hash && canonical.timestamp === at.timestamp
      && (head.number !== at.number || (bytes32(head.hash) === at.hash && head.timestamp === at.timestamp))
      && deploymentAgain.number === number && deploymentAgain.hash !== null && bytes32(deploymentAgain.hash) === deployed.hash
      && deploymentAgain.timestamp === deployed.timestamp && bytes32(deploymentAgain.parentHash) === preceding.hash
      && parentAgain.number === preceding.number && parentAgain.hash !== null && bytes32(parentAgain.hash) === preceding.hash
      && parentAgain.timestamp === preceding.timestamp, "reward_chain_changed_during_observation");
    return { provenanceId: rewardClubSafeDeploymentBuild.id, scope: "initialization_only" as const,
      executionHistoryReviewRequired: true as const, safe: observation, factoryAddress, deploymentTransactionHash: hash,
      deploymentBlock: deployed, parentBlock: preceding, deployer: walletAddress(tx.from), saltNonce,
      initializerHash: keccak256(canonicalInitializer), setupOwners, observedFinalizedHead: floor };
  } catch (error) {
    if (error instanceof RewardProtocolError) throw error;
    throw new RewardProtocolError("reward_club_deployment_observation_unavailable");
  }
}
