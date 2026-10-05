#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readDemoManifestFile } from "./release-source.mjs";
import { observeDemoProviders } from "./provider-observations.mjs";

const usage = `Read-only rewards-demo provider observation; no remote changes or release approval.
  --manifest <non-secret.json> --plan-digest <exact offline plan digest>
Requires independently supplied RACESON_REWARD_DEMO_VERCEL_READ_TOKEN and
RACESON_REWARD_DEMO_SUPABASE_READ_TOKEN. No generic CLI-token or .env fallback.
Auth responses may contain secrets; only the whitelisted observation is printed.
`;

export async function main(args = process.argv.slice(2), { env = process.env, log = console.log, observe = observeDemoProviders } = {}) {
  if (args.length === 1 && args[0] === "--help") { log(usage); return; }
  if (args.length !== 4) throw new Error("reward_demo_observation_usage");
  const flags = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const [key, value] = args.slice(index, index + 2);
    if (!["--manifest", "--plan-digest"].includes(key) || flags.has(key) || !value || value.startsWith("--")) throw new Error("reward_demo_observation_usage");
    flags.set(key, value);
  }
  if (!flags.has("--manifest") || !flags.has("--plan-digest")) throw new Error("reward_demo_observation_usage");
  const manifest = readDemoManifestFile(resolve(flags.get("--manifest")));
  const result = await observe(manifest, {
    expectedPlanDigest: flags.get("--plan-digest"),
    vercelReadToken: env.RACESON_REWARD_DEMO_VERCEL_READ_TOKEN,
    supabaseReadToken: env.RACESON_REWARD_DEMO_SUPABASE_READ_TOKEN,
  });
  log(JSON.stringify(result, null, 2));
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(/^reward_demo_(?:observation|release)_[a-z_]+$/.test(error?.message ?? "") ? error.message : "reward_demo_observation_failed");
    process.exitCode = 1;
  });
}
