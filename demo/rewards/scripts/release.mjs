#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { prepareDemoDbBundle, readDemoManifestFile, readDemoReleaseSource, summarizeDemoRelease, verifyDemoDbBundle } from "./release-source.mjs";

const usage = `Offline rewards-demo release preparation (no deployment, migration push or credentials).
  inspect --manifest <non-secret.json>
  prepare-db --manifest <non-secret.json>
  verify-db --manifest <non-secret.json> --bundle <prepared-directory>
Preparation is not owner approval or proof of infrastructure/credential isolation.
`;

export function main(args = process.argv.slice(2), log = console.log) {
  if (args.length === 1 && args[0] === "--help") { log(usage); return; }
  const [command, ...rest] = args;
  if (!["inspect", "prepare-db", "verify-db"].includes(command)
    || rest.length !== (command === "verify-db" ? 4 : 2)) throw new Error("reward_demo_release_usage");
  const flags = new Map();
  for (let index = 0; index < rest.length; index += 2) {
    const [key, value] = rest.slice(index, index + 2);
    if (!["--manifest", ...(command === "verify-db" ? ["--bundle"] : [])].includes(key)
      || flags.has(key) || !value || value.startsWith("--")) throw new Error("reward_demo_release_usage");
    flags.set(key, resolve(value));
  }
  if (!flags.has("--manifest") || (command === "verify-db" && !flags.has("--bundle"))) throw new Error("reward_demo_release_usage");
  const manifest = readDemoManifestFile(flags.get("--manifest"));
  const result = command === "inspect" ? summarizeDemoRelease(readDemoReleaseSource(manifest))
    : command === "prepare-db" ? prepareDemoDbBundle(manifest)
    : verifyDemoDbBundle(manifest, flags.get("--bundle"));
  log(JSON.stringify(result, null, 2));
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(); }
  catch (error) {
    // Never print raw filesystem/Git/JSON exceptions or supplied manifest data.
    console.error(/^reward_demo_release_[a-z_]+$/.test(error?.message ?? "") ? error.message : "reward_demo_release_failed");
    process.exitCode = 1;
  }
}
