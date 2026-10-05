import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const base = new URL("../../../contracts/node_modules/@safe-global/safe-contracts/build/artifacts/contracts/", import.meta.url);
export function originalSafeFactoryArtifact() {
  const bytes = readFileSync(new URL("proxies/SafeProxyFactory.sol/SafeProxyFactory.json", base));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), "f77ccb60e95345e6583216e82feb5430098679d62aa4aeda7388df3831476997");
  return JSON.parse(bytes);
}
export function originalSafeArtifacts() {
  const paths = {
    singleton: ["Safe.sol/Safe.json", "c36a5e99bc3f25c2d75ac5f7920b679200b3ce617c0d26e674b1321dbc6b0bdf"],
    proxy: ["proxies/SafeProxy.sol/SafeProxy.json", "b05eaeaf7278097e52a9e9b38410de2a812c23fa3622373473e73eaa19646ecd"],
    handler: ["handler/CompatibilityFallbackHandler.sol/CompatibilityFallbackHandler.json", "cd4f07b0984afb35dc9699e911eff240b11599fd78e4be12be64b401e5fd57bb"],
  };
  return Object.fromEntries(Object.entries(paths).map(([name, [path, hash]]) => {
    const bytes = readFileSync(new URL(path, base)); assert.equal(createHash("sha256").update(bytes).digest("hex"), hash);
    return [name, JSON.parse(bytes)];
  }));
}
