// Source publication is separate from signing/deployment. This module only
// packages approved public Solidity and reads the documented explorer endpoint.
import assert from "node:assert/strict";
import { closeSync, fsyncSync, lstatSync, mkdtempSync, openSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { getAddress, keccak256, stringToHex } from "viem";
import { encodeRewardDeploymentV2, normalizeRewardDeploymentV2, requireRewardBuildArtifactV2, rewardCampaignV2Build, verifyRewardRuntimeV2 } from "@raceson/rewards-chain/deployment-v2";
import { readVerifiedRewardDeploymentV2 } from "@raceson/rewards-chain/deployment-reader-v2";

const metadataHash = "0x2c1c0a28a4337a9961f92e8c625917cb36ad49c38eb419a0999c59823462aae8";
const target = "src/RacesOnRewardCampaignV2.sol", name = "RacesOnRewardCampaignV2";
export const canarySourceVerifier = "https://sourcify-api-monad.blockvision.org/";
export const canarySourcePackageHash = "0x2d43f7bb3e6cee2c2c53ecf36ce3b47c7ad3cedf893b9973262c5e7de2e4756f";
const digest = value => keccak256(stringToHex(value));

function requireSourcePackage(pack) {
  assert.equal(digest(pack.rawMetadata), metadataHash);
  assert.deepEqual(pack.metadata, JSON.parse(pack.rawMetadata));
  assert.equal(pack.metadataHash, metadataHash);
  assert.equal(pack.packageHash, digest(JSON.stringify({ rawMetadata: pack.rawMetadata, input: pack.input })));
  assert.equal(pack.packageHash, canarySourcePackageHash);
  assert.equal(keccak256(pack.creationCode), rewardCampaignV2Build.creationCodeHash);
  assert.equal(keccak256(pack.runtimeTemplate), rewardCampaignV2Build.runtimeTemplateHash);
  assert.equal(pack.input.language, pack.metadata.language);
  const { outputSelection: _, ...settings } = pack.input.settings;
  const { compilationTarget: __, ...expectedSettings } = pack.metadata.settings;
  assert.deepEqual(settings, expectedSettings);
  assert.deepEqual(Object.keys(pack.input.sources).sort(), Object.keys(pack.metadata.sources).sort());
  for (const [path, source] of Object.entries(pack.input.sources)) {
    assert.deepEqual(Object.keys(source), ["content"]);
    assert.equal(digest(source.content), pack.metadata.sources[path].keccak256);
  }
}

export function prepareCanarySourcePackage(artifact, contractsRoot) {
  requireRewardBuildArtifactV2(artifact);
  assert.equal(digest(artifact.rawMetadata), metadataHash, "Pinned compiler metadata changed");
  const metadata = JSON.parse(artifact.rawMetadata);
  // Foundry's parsed metadata is lossy (empty ABI outputs/NatSpec fields).
  // Use the hash-pinned compiler string, not that normalized representation.
  assert.equal(metadata.compiler.version, "0.8.36+commit.8a079791");
  assert.deepEqual(metadata.settings.compilationTarget, { [target]: name });
  const root = realpathSync(contractsRoot), sources = {};
  for (const path of Object.keys(metadata.sources).sort()) {
    const file = resolve(root, path);
    assert.ok(file.startsWith(root + sep) && realpathSync(file) === file);
    const info = lstatSync(file); assert.ok(info.isFile() && info.size <= 262144);
    const content = readFileSync(file, "utf8");
    assert.equal(digest(content), metadata.sources[path].keccak256, `Compiled source changed: ${path}`);
    sources[path] = { content };
  }
  const { compilationTarget: _, ...settings } = metadata.settings;
  const input = { language: metadata.language, sources, settings: { ...settings,
    outputSelection: { "*": { "*": ["abi", "metadata", "evm.bytecode", "evm.deployedBytecode"] } } } };
  const packageHash = digest(JSON.stringify({ rawMetadata: artifact.rawMetadata, input }));
  return { packageHash, metadataHash, metadata, rawMetadata: artifact.rawMetadata, input,
    creationCode: artifact.bytecode.object, runtimeTemplate: artifact.deployedBytecode.object };
}

// A reproducible offline compiler check; output is not explorer acceptance.
export function verifyCanarySourceCompilation(pack, output) {
  requireSourcePackage(pack);
  assert.ok(!(output.errors ?? []).some(error => error.severity === "error"));
  const compiled = output.contracts?.[target]?.[name]; assert.ok(compiled);
  assert.equal(digest(compiled.metadata), metadataHash);
  assert.equal(keccak256(`0x${compiled.evm.bytecode.object}`), rewardCampaignV2Build.creationCodeHash);
  assert.equal(keccak256(`0x${compiled.evm.deployedBytecode.object}`), rewardCampaignV2Build.runtimeTemplateHash);
  assert.deepEqual(JSON.parse(compiled.metadata), pack.metadata);
}

// Local disposable export, never a network upload. Only metadata-listed Solidity
// is included: no environment, Keychain, deployment journal or sporting records.
export function exportCanarySourcePackage(pack) {
  requireSourcePackage(pack);
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "raceson-canary-source-")));
  for (const [file, content] of [
    ["metadata.json", pack.rawMetadata], ["standard-input.json", JSON.stringify(pack.input)],
    ["sources.json", JSON.stringify(pack.input.sources)],
    ["manifest.json", JSON.stringify({ packageHash: pack.packageHash, metadataHash: pack.metadataHash,
      compiler: pack.metadata.compiler.version, target: `${target}:${name}`, chainId: 10143,
      sourcePaths: Object.keys(pack.input.sources), status: "prepared-not-published" }, null, 2)],
  ]) {
    const fd = openSync(join(directory, file), "wx", 0o600);
    try { writeFileSync(fd, content); fsyncSync(fd); } finally { closeSync(fd); }
  }
  return directory;
}

export function verifyCanaryExplorerSource(pack, input, body) {
  requireSourcePackage(pack);
  const expected = normalizeRewardDeploymentV2(input);
  assert.equal(expected.context.chainId, 10143);
  assert.equal(body.chainId, "10143"); assert.equal(getAddress(body.address), expected.context.verifyingContract);
  for (const field of ["match", "creationMatch", "runtimeMatch"]) assert.equal(body[field], "exact_match");
  assert.ok(typeof body.verifiedAt === "string" && Number.isFinite(Date.parse(body.verifiedAt)));
  assert.deepEqual(body.metadata, pack.metadata);
  assert.deepEqual(body.sources, pack.input.sources);
  assert.equal(body.compilation?.compiler, "solc");
  assert.equal(body.compilation?.compilerVersion, pack.metadata.compiler.version);
  assert.equal(body.compilation?.fullyQualifiedName, `${target}:${name}`);
  assert.equal(body.deployment?.transactionHash, expected.deploymentTransactionHash);
  assert.equal(getAddress(body.deployment?.deployer), expected.operatorAddress);
  assert.match(body.deployment?.blockNumber, /^(0|[1-9][0-9]*)$/);
  assert.equal(body.creationBytecode?.recompiledBytecode, pack.creationCode);
  assert.equal(body.creationBytecode?.onchainBytecode, encodeRewardDeploymentV2(expected, pack.creationCode));
  assert.equal(body.runtimeBytecode?.recompiledBytecode, pack.runtimeTemplate);
  const runtimeCodeHash = verifyRewardRuntimeV2(expected, body.runtimeBytecode?.onchainBytecode);
  return { status: "exact-source-observed", chainId: 10143, address: expected.context.verifyingContract,
    deploymentTransactionHash: expected.deploymentTransactionHash, deploymentBlockNumber: body.deployment.blockNumber,
    packageHash: pack.packageHash, runtimeCodeHash, verifier: canarySourceVerifier };
}

export async function observeCanaryExplorerSource(pack, input, client, { fetchImpl = fetch } = {}) {
  // Capture inputs before awaiting untrusted provider data. No dynamic endpoint,
  // auth headers, retries, redirects, POSTs, account access or signature methods.
  const expected = normalizeRewardDeploymentV2(input), captured = structuredClone(pack);
  requireSourcePackage(captured);
  assert.equal(expected.context.chainId, 10143);
  const fields = "metadata,sources,compilation,deployment,creationBytecode.onchainBytecode,creationBytecode.recompiledBytecode,runtimeBytecode.onchainBytecode,runtimeBytecode.recompiledBytecode";
  const url = `${canarySourceVerifier}v2/contract/10143/${expected.context.verifyingContract}?fields=${fields}`;
  const response = await fetchImpl(url, { method: "GET", redirect: "error", credentials: "omit",
    cache: "no-store", headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15000) });
  assert.ok(response.status === 200 || response.status === 404, "Source observer unavailable; not evidence of verification");
  assert.match(response.headers.get("content-type") ?? "", /^application\/json\b/i);
  // Streaming bound includes responses without Content-Length.
  const chunks = []; let size = 0;
  for await (const chunk of response.body) { size += chunk.byteLength; assert.ok(size <= 1048576); chunks.push(chunk); }
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (response.status === 404) {
    assert.equal(body.chainId, "10143"); assert.equal(getAddress(body.address), expected.context.verifyingContract);
    assert.equal(body.match, null); assert.equal(body.creationMatch, null); assert.equal(body.runtimeMatch, null);
    return { status: "source-not-verified", chainId: 10143, address: expected.context.verifyingContract };
  }
  const source = verifyCanaryExplorerSource(captured, expected, body);
  // Explorer evidence alone never establishes canonical deployment or finality.
  const deployment = await readVerifiedRewardDeploymentV2(client, expected, captured.creationCode);
  assert.equal(source.deploymentBlockNumber, String(deployment.deploymentBlockNumber));
  assert.equal(source.runtimeCodeHash, deployment.runtimeCodeHash);
  return { ...source, deploymentBlockHash: deployment.deploymentBlockHash };
}
