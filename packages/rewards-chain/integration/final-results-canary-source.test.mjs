import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { getContractAddress, toHex } from "viem";
import { encodeRewardDeploymentV3 } from "../dist/deployment-v3.js";
import { startOwnedRewardChain } from "./owned-chain.mjs";
import { prepareCanarySourcePackage, verifyCanarySourceCompilation, exportCanarySourcePackage,
  verifyCanaryExplorerSource, observeCanaryExplorerSource, canarySourceVerifier } from "../../../demo/rewards/scripts/final-results-canary-source.mjs";

const contracts = fileURLToPath(new URL("../../../contracts", import.meta.url));
const artifact = JSON.parse(readFileSync(join(contracts, "out/RacesOnRewardCampaignV3.sol/RacesOnRewardCampaignV3.json")));
const pack = prepareCanarySourcePackage(artifact, contracts);
let chain, expected, body;
before(async () => {
  // Synthetic signers, owned loopback Anvil with chain ID 10143. No public RPC,
  // explorer, Mac Keychain, production credentials or actual testnet transactions.
  chain = await startOwnedRewardChain({ chainId: 10143 });
  const spec = { context: { environment: "monad-testnet", chainId: 10143,
    verifyingContract: getContractAddress({ from: chain.operator.address, nonce: 0n }) },
    operatorAddress: chain.operator.address, treasuryAddress: chain.treasury,
    programmeId: toHex(100n, { size: 32 }), campaignId: toHex(101n, { size: 32 }),
    programmeManifestHash: toHex(102n, { size: 32 }), enabledPot: 0, reviewPeriod: 0n };
  const data = encodeRewardDeploymentV3(spec, pack.creationCode);
  const tx = await chain.operatorClient.sendTransaction({ data });
  const receipt = await chain.publicClient.waitForTransactionReceipt({ hash: tx });
  await chain.testClient.mine({ blocks: 96, interval: 1 });
  expected = { ...spec, deploymentNonce: 0n, deploymentTransactionHash: tx };
  body = { match: "exact_match", creationMatch: "exact_match", runtimeMatch: "exact_match",
    chainId: "10143", address: spec.context.verifyingContract, verifiedAt: "2026-09-09T12:00:00Z",
    metadata: pack.metadata, sources: pack.input.sources,
    compilation: { compiler: "solc", compilerVersion: pack.metadata.compiler.version,
      fullyQualifiedName: "src/RacesOnRewardCampaignV3.sol:RacesOnRewardCampaignV3" },
    deployment: { transactionHash: tx, blockNumber: String(receipt.blockNumber), deployer: chain.operator.address },
    creationBytecode: { onchainBytecode: data, recompiledBytecode: pack.creationCode },
    runtimeBytecode: { onchainBytecode: await chain.publicClient.getCode({ address: spec.context.verifyingContract }), recompiledBytecode: pack.runtimeTemplate } };
}, { timeout: 20000 });
after(async () => { await chain?.stop(); });
const jsonResponse = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });

test("17-source package reproduces exact pinned creation/runtime/metadata offline, without changing IPFS settings", () => {
  assert.equal(Object.keys(pack.input.sources).length, 17);
  assert.equal(pack.packageHash, "0xfd0da7757759448696a9de158660729d8dc56b27a1fda63cfd1770cbb75340d3");
  const candidates = [process.env.RACESON_SOLC_BINARY,
    join(homedir(), "Library/Application Support/svm/0.8.36/solc-0.8.36"), join(homedir(), ".svm/0.8.36/solc-0.8.36")].filter(Boolean);
  const compiler = candidates.find(existsSync); assert.ok(compiler, "Pinned offline solc 0.8.36 must be installed");
  assert.match(execFileSync(compiler, ["--version"], { encoding: "utf8", env: {} }), /0\.8\.36\+commit\.8a079791/);
  const output = JSON.parse(execFileSync(compiler, ["--standard-json"], {
    input: JSON.stringify(pack.input), encoding: "utf8", env: {}, maxBuffer: 8000000, timeout: 30000 }));
  verifyCanarySourceCompilation(pack, output);
  output.contracts["src/RacesOnRewardCampaignV3.sol"].RacesOnRewardCampaignV3.evm.bytecode.object += "00";
  assert.throws(() => verifyCanarySourceCompilation(pack, output));
});

test("source export contains only pinned metadata and Solidity, and changed artifacts/packages are rejected", () => {
  const directory = exportCanarySourcePackage(pack);
  try {
    assert.equal(lstatSync(directory).mode & 0o777, 0o700);
    assert.deepEqual(readdirSync(directory).sort(), ["manifest.json", "metadata.json", "sources.json", "standard-input.json"]);
    for (const file of readdirSync(directory)) assert.equal(lstatSync(join(directory, file)).mode & 0o777, 0o600);
    assert.equal(readFileSync(join(directory, "metadata.json"), "utf8"), artifact.rawMetadata);
    assert.deepEqual(JSON.parse(readFileSync(join(directory, "standard-input.json"))), pack.input);
  } finally { rmSync(directory, { recursive: true, force: true }); }
  for (const patch of [{ rawMetadata: "{}" }, { bytecode: { ...artifact.bytecode, object: "0x00" } }])
    assert.throws(() => prepareCanarySourcePackage({ ...artifact, ...patch }, contracts));
  const changed = structuredClone(pack); changed.input.sources[".env"] = { content: "must never be exported" };
  assert.throws(() => exportCanarySourcePackage(changed));
  changed.packageHash = pack.packageHash;
  assert.throws(() => verifyCanaryExplorerSource(changed, expected, body));
});

test("mock explorer exact source plus actual owned-node finalized deployment is accepted read-only", async () => {
  let calls = 0;
  const result = await observeCanaryExplorerSource(pack, expected, chain.publicClient, { fetchImpl: async (url, options) => {
    calls++; assert.ok(url.startsWith(`${canarySourceVerifier}v2/contract/10143/${expected.context.verifyingContract}?fields=`));
    assert.equal(options.method, "GET"); assert.equal(options.redirect, "error"); assert.equal(options.credentials, "omit");
    assert.deepEqual(options.headers, { Accept: "application/json" });
    return jsonResponse(body);
  } });
  assert.equal(result.status, "exact-source-observed"); assert.equal(calls, 1);
  assert.equal(result.packageHash, pack.packageHash);
  assert.equal(result.deploymentBlockHash, (await chain.publicClient.getTransactionReceipt({ hash: expected.deploymentTransactionHash })).blockHash);
});

test("wrong source/settings/compiler/chain/address/constructor/runtime/deployment and partial matches fail", () => {
  const mutations = [b => { b.chainId = "143"; }, b => { b.address = chain.treasury; },
    b => { b.match = "match"; }, b => { b.creationMatch = null; }, b => { b.runtimeMatch = "match"; },
    b => { b.verifiedAt = "unknown"; }, b => { b.metadata.settings.viaIR = false; },
    b => { delete b.sources["src/RacesOnRewardCampaignV3.sol"]; },
    b => { b.sources["src/RacesOnRewardCampaignV3.sol"].content += "\n"; },
    b => { b.compilation.compilerVersion = "0.8.35"; }, b => { b.deployment.transactionHash = toHex(999n, { size: 32 }); },
    b => { b.deployment.deployer = chain.treasury; }, b => { b.creationBytecode.onchainBytecode += "00"; },
    b => { b.creationBytecode.recompiledBytecode = "0x00"; }, b => { b.runtimeBytecode.recompiledBytecode = "0x00"; },
    b => { b.runtimeBytecode.onchainBytecode = pack.runtimeTemplate; }];
  for (const mutate of mutations) { const altered = structuredClone(body); mutate(altered);
    assert.throws(() => verifyCanaryExplorerSource(pack, expected, altered)); }
});

test("unverified, malformed, unavailable, oversized and misrouted explorer responses never establish acceptance", async () => {
  const missing = { chainId: "10143", address: expected.context.verifyingContract, match: null, creationMatch: null, runtimeMatch: null };
  const result = await observeCanaryExplorerSource(pack, expected, {}, { fetchImpl: async () => jsonResponse(missing, 404) });
  assert.equal(result.status, "source-not-verified");
  for (const response of [() => jsonResponse({ ...missing, chainId: "143" }, 404),
    () => jsonResponse(body, 429), () => new Response("HTML", { status: 200 }),
    () => new Response("x".repeat(1048577), { headers: { "Content-Type": "application/json" } }),
    () => { throw Error("unavailable"); }])
    await assert.rejects(observeCanaryExplorerSource(pack, expected, {}, { fetchImpl: async () => response() }));
  await assert.rejects(observeCanaryExplorerSource(pack, expected, { getChainId: async () => 143 }, { fetchImpl: async () => jsonResponse(body) }));
  const badBlock = structuredClone(body); badBlock.deployment.blockNumber = "999999";
  await assert.rejects(observeCanaryExplorerSource(pack, expected, chain.publicClient, { fetchImpl: async () => jsonResponse(badBlock) }));
});
