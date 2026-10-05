import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cachedForge = resolve(root, ".toolchain/foundry-v1.8.0/forge");
const forge = process.env.RACESON_FORGE_BINARY || (existsSync(cachedForge) ? cachedForge : "forge");
const version = execFileSync(forge, ["--version"], { cwd: root, encoding: "utf8" });
assert.match(version, /^forge Version: 1\.8\.0\r?$/m, "Install pinned Foundry v1.8.0; see contracts/README.md");
assert.match(version, /Commit SHA: 61ae26af36320d4fa1020f7db53785885e29eeb5/, "Unexpected Foundry build revision");

for (const [path, expected] of [
  ["node_modules/@openzeppelin/contracts/package.json", "5.6.1"],
  ["node_modules/@safe-global/safe-contracts/package.json", "1.4.1-2"],
  ["lib/forge-std/package.json", "1.16.2"],
]) {
  assert.equal(JSON.parse(readFileSync(resolve(root, path), "utf8")).version, expected, `Unexpected dependency version: ${path}`);
}

const safeArtifacts = "node_modules/@safe-global/safe-contracts/build/artifacts/contracts/";
for (const [path, expected] of [
  ["Safe.sol/Safe.json", "c36a5e99bc3f25c2d75ac5f7920b679200b3ce617c0d26e674b1321dbc6b0bdf"],
  ["proxies/SafeProxy.sol/SafeProxy.json", "b05eaeaf7278097e52a9e9b38410de2a812c23fa3622373473e73eaa19646ecd"],
  ["proxies/SafeProxyFactory.sol/SafeProxyFactory.json", "f77ccb60e95345e6583216e82feb5430098679d62aa4aeda7388df3831476997"],
  ["handler/CompatibilityFallbackHandler.sol/CompatibilityFallbackHandler.json", "cd4f07b0984afb35dc9699e911eff240b11599fd78e4be12be64b401e5fd57bb"],
]) {
  assert.equal(createHash("sha256").update(readFileSync(resolve(root, safeArtifacts, path))).digest("hex"), expected, `Original Safe artifact changed: ${path}`);
}

// No network/provider/keystore arguments. A missing compiler fails instead of downloading during checks.
for (const args of [
  ["fmt", "--check"],
  ["test", "--offline", "--summary"],
  ["test", "--offline", "--network", "monad", "--chain-id", "10143", "--summary"],
]) {
  execFileSync(forge, [...args, "--root", root], { cwd: root, stdio: "inherit" });
}
