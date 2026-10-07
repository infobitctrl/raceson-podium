import assert from "node:assert/strict";
import { decodeEventLog, encodeFunctionData, zeroAddress } from "viem";
import { originalSafeArtifacts, originalSafeFactoryArtifact } from "../test/safe-artifacts.mjs";

// Synthetic owners, original artifacts and the caller's owned ephemeral node
// only. No external endpoint, signer input, account or chain funding capability.
export async function deployOriginalClubSafeFixture(chain, setupPatch = {}, fixedDependencies) {
  const artifacts = originalSafeArtifacts(), factory = originalSafeFactoryArtifact();
  const receipt = async hash => {
    const result = await chain.publicClient.waitForTransactionReceipt({ hash, timeout: 10000 });
    assert.equal(result.status, "success"); return result;
  };
  const deploy = async artifact => (await receipt(await chain.operatorClient.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode }))).contractAddress;
  let singleton = await deploy(artifacts.singleton), handler = await deploy(artifacts.handler), factoryAddress = await deploy(factory);
  if(fixedDependencies){
    for(const [source,address] of [[singleton,fixedDependencies.singletonAddress],[handler,fixedDependencies.fallbackHandlerAddress],[factoryAddress,fixedDependencies.factoryAddress]])await chain.testClient.setCode({address,bytecode:await chain.publicClient.getCode({address:source})});
    singleton=fixedDependencies.singletonAddress;handler=fixedDependencies.fallbackHandlerAddress;factoryAddress=fixedDependencies.factoryAddress;
  }
  const setup = { owners: chain.clubOwners.map(o => o.address), threshold: 2n, to: zeroAddress, data: "0x", handler,
    paymentToken: zeroAddress, payment: 0n, paymentReceiver: zeroAddress, ...setupPatch };
  const initializer = encodeFunctionData({ abi: artifacts.singleton.abi, functionName: "setup", args: Object.values(setup) });
  const deployment = await receipt(await chain.operatorClient.writeContract({ address: factoryAddress, abi: factory.abi,
    functionName: "createProxyWithNonce", args: [singleton, initializer, 1n] }));
  const event = decodeEventLog({ abi: factory.abi, ...deployment.logs.at(-1) });
  assert.equal(event.eventName, "ProxyCreation");
  const expected = { context: { environment: "local-simulation", chainId: 31337, verifyingContract: event.args.proxy },
    singletonAddress: singleton, fallbackHandlerAddress: handler, owners: chain.clubOwners.map(o => o.address) };
  return { artifacts, expected, deployment, provenance: { safe: expected, factoryAddress, deploymentTransactionHash: deployment.transactionHash } };
}
