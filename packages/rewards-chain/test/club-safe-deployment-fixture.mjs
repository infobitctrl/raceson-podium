import assert from "node:assert/strict";
import { concatHex, encodeAbiParameters, encodeEventTopics, encodeFunctionData, getCreate2Address, keccak256, padHex, toHex, zeroAddress } from "viem";
import { rewardClubSafeDeploymentAbi as abi, rewardClubSafeSlots } from "../dist/index.js";
import { originalSafeArtifacts, originalSafeFactoryArtifact } from "./safe-artifacts.mjs";
const a = n => toHex(BigInt(n), { size: 20 }), hash = n => toHex(BigInt(n), { size: 32 });
const artifacts = originalSafeArtifacts(), factory = originalSafeFactoryArtifact();
// Synthetic injected RPC responses, not a running chain or real wallet proof.
export function clubSafeDeploymentFixture({ setupPatch = {}, saltNonce = 1n, chainId = 31337 } = {}) {
  const owners = [a(22), a(20), a(21)], singleton = a(11), handler = a(12), factoryAddress = a(13), deployer = a(14);
  const setup = { owners, threshold: 2n, to: zeroAddress, data: "0x", handler, paymentToken: zeroAddress, payment: 0n, paymentReceiver: zeroAddress, ...setupPatch };
  const initializer = encodeFunctionData({ abi, functionName: "setup", args: Object.values(setup) });
  const salt = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }], [keccak256(initializer), saltNonce]));
  const proxy = getCreate2Address({ from: factoryAddress, salt, bytecode: concatHex([artifacts.proxy.bytecode, encodeAbiParameters([{ type: "address" }], [singleton])]) });
  const input = { safe: { context: { environment: chainId === 31337 ? "local-simulation" : "monad-testnet", chainId, verifyingContract: proxy },
    singletonAddress: singleton, fallbackHandlerAddress: handler, owners: [...owners] }, factoryAddress, deploymentTransactionHash: hash(500) };
  const block = number => ({ number, hash: hash(number), timestamp: 1000n + number, parentHash: hash(number - 1n) });
  const at = block(100n), deployment = block(50n), calls = [];
  const tx = { hash: hash(500), chainId, to: factoryAddress, from: deployer, value: 0n, blockNumber: 50n, blockHash: hash(50), transactionIndex: 3,
    input: encodeFunctionData({ abi, functionName: "createProxyWithNonce", args: [singleton, initializer, saltNonce] }) };
  const log = (address, eventName, args, data, logIndex) => ({ address, topics: encodeEventTopics({ abi, eventName, args }), data,
    transactionHash: hash(500), blockNumber: 50n, blockHash: hash(50), transactionIndex: 3, logIndex, removed: false });
  const receipt = { to: factoryAddress, from: deployer, transactionHash: hash(500), contractAddress: null, status: "success", blockNumber: 50n,
    blockHash: hash(50), transactionIndex: 3, logs: [
      log(proxy, "SafeSetup", { initiator: factoryAddress }, encodeAbiParameters([{ type: "address[]" }, { type: "uint256" }, { type: "address" }, { type: "address" }],
        [owners, 2n, zeroAddress, handler]), 5),
      log(factoryAddress, "ProxyCreation", { proxy }, encodeAbiParameters([{ type: "address" }], [singleton]), 6),
    ] };
  const reader = {
    async getChainId() { return chainId; }, async getBlock(p) { calls.push(p); return block(p.blockTag === "finalized" ? 100n : p.blockNumber); },
    async getTransaction(p) { assert.equal(p.hash, hash(500)); return tx; }, async getTransactionReceipt(p) { assert.equal(p.hash, hash(500)); return receipt; },
    async getCode(p) { calls.push(p); return new Map([[proxy.toLowerCase(), artifacts.proxy.deployedBytecode], [singleton, artifacts.singleton.deployedBytecode],
      [handler, artifacts.handler.deployedBytecode], [factoryAddress, factory.deployedBytecode]]).get(p.address.toLowerCase()); },
    async getStorageAt(p) { calls.push(p); return padHex(p.slot === rewardClubSafeSlots.singleton ? singleton : p.slot === rewardClubSafeSlots.fallbackHandler ? handler : zeroAddress, { size: 32 }); },
    async readContract(p) { calls.push(p); return { VERSION: "1.4.1", getThreshold: 2n, getOwners: [...owners], getModulesPaginated: [[], a(1)], proxyCreationCode: artifacts.proxy.bytecode }[p.functionName]; },
  };
  return { input, reader, calls, tx, receipt, at, deployment, block, owners, initializer };
}
