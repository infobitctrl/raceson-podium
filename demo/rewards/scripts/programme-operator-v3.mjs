#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertOperatorSource, parseOperatorArguments, readOperatorCredentials } from "./operator.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const fail = () => { throw Error("reward_programme_operator_config_invalid"); };
const exact = (v, keys) => v && typeof v === "object" && !Array.isArray(v)
  && Object.keys(v).sort().join("\0") === [...keys].sort().join("\0")
  && keys.every(key => Object.hasOwn(Object.getOwnPropertyDescriptor(v, key), "value"));
const uuid = v => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
const hex = (v, length) => typeof v === "string" && new RegExp(`^0x[0-9a-f]{${length}}$`).test(v) && BigInt(v) !== 0n;
const jobKeys = ["slot", "approvalId", "uploadId", "intentId", "attemptId", "jobId", "transactionHash"];
const help = `Isolated Monad testnet V3 programme delivery; not the legacy operator.
  plan --config <non-secret.json>
  run --config <non-secret.json> --confirm-plan <sha256>
Runs only the exact already queued/signed closure, upload, stage and activation jobs
for the five race pots and league pot, with their stored source/publication guards.
No signing, new funding, publication decision, recipient payout or SQL/app deployment.
Stops at the first unconfirmed job; rerun the same list to reconcile saved receipts.
Credentials arrive only through a finite pipe on stdin: accessToken, publishableKey, serverKey.
Never paste credentials into a terminal, command argument, source file or chat.
No .env, CLI-login, production-project, source-check or funding-gate bypass.
`;

export function normalizeProgrammeOperatorConfigV3(value, validateRelease) {
  if (!exact(value, ["formatVersion", "release", "draftId", "programmeAddress", "operatorAddress", "operatorUserId", "durationSeconds", "maxGasCostWei", "jobs"])
    || value.formatVersion !== 3 || !uuid(value.draftId) || !uuid(value.operatorUserId)
    || !hex(value.programmeAddress, 40) || !hex(value.operatorAddress, 40)
    || !Number.isInteger(value.durationSeconds) || value.durationSeconds < 1 || value.durationSeconds > 1800
    || typeof value.maxGasCostWei !== "string" || !/^[1-9][0-9]{0,77}$/.test(value.maxGasCostWei)
    || BigInt(value.maxGasCostWei) >= 1n << 256n
    || !Array.isArray(value.jobs) || value.jobs.length < 1 || value.jobs.length > 100
    || Object.getOwnPropertySymbols(value.jobs).length !== 0 || Object.getOwnPropertyNames(value.jobs).length !== value.jobs.length + 1) return fail();
  const descriptors = Object.getOwnPropertyDescriptors(value.jobs);
  const jobs = Array.from({ length: value.jobs.length }, (_, index) => {
    const item = descriptors[String(index)];
    if (!item || !Object.hasOwn(item, "value")) return fail();
    const job = item.value;
    if (!exact(job, jobKeys) || !Number.isInteger(job.slot) || job.slot < 1 || job.slot > 6
      || !jobKeys.slice(1, 6).every(key => uuid(job[key])) || !hex(job.transactionHash, 64)) return fail();
    return Object.fromEntries(jobKeys.map(key => [key, job[key]]));
  });
  for (const key of ["jobId", "intentId", "attemptId", "transactionHash"])
    if (new Set(jobs.map(job => job[key])).size !== jobs.length) return fail();
  return { formatVersion: 3, release: validateRelease(value.release), draftId: value.draftId,
    programmeAddress: value.programmeAddress, operatorAddress: value.operatorAddress, operatorUserId: value.operatorUserId,
    durationSeconds: value.durationSeconds, maxGasCostWei: value.maxGasCostWei, jobs };
}
export function programmeOperatorExitCodeV3(result) {
  if (!result?.stop) return 0; // Help/plan is not execution evidence.
  return result.stop === "jobs_confirmed" && Number.isInteger(result.requestedJobs) && result.requestedJobs > 0
    && Array.isArray(result.entries) && result.entries.length === result.requestedJobs
    && result.entries.every(entry => entry.outcome === "confirmed") ? 0 : 2;
}
export async function main(args = process.argv.slice(2), log = console.log) {
  const parsed = parseOperatorArguments(args);
  if (parsed.command === "help") { log(help); return; }
  let raw;
  try {
    const stat = lstatSync(parsed.configPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 128 * 1024) return fail();
    raw = JSON.parse(readFileSync(parsed.configPath, "utf8"));
  } catch { return fail(); }
  assertOperatorSource(raw?.release?.sourceCommit);
  // Exact reviewed source only. A dirty local rehearsal is not a remote release.
  try {
    execFileSync(process.execPath, [resolve(root, "node_modules/typescript/bin/tsc"), "-b", "packages/domain", "packages/db", "apps/api", "--force"],
      { cwd: root, timeout: 60000, maxBuffer: 1024 * 1024, stdio: ["ignore", "pipe", "pipe"], env: { PATH: process.env.PATH } });
  } catch { throw Error("reward_programme_operator_build_required"); }
  assertOperatorSource(raw.release.sourceCommit);
  const { validateDemoReleaseManifest } = await import("./release-manifest.mjs");
  const { readDemoReleaseSource } = await import("./release-source.mjs");
  const config = normalizeProgrammeOperatorConfigV3(raw, validateDemoReleaseManifest);
  const source = readDemoReleaseSource(config.release);
  const plan = { schemaVersion: 3, kind: "raceson-programme-operator-plan-v3", sourcePlanDigest: source.planDigest, config };
  const planDigest = createHash("sha256").update(JSON.stringify(plan)).digest("hex");
  if (parsed.command === "plan") { const result = { ...plan, planDigest }; log(JSON.stringify(result, null, 2)); return result; }
  if (parsed.confirmation !== planDigest) throw Error("reward_programme_operator_confirmation_required");
  const { runAuthenticatedProgrammeOperatorV3 } = await import("../../../apps/api/dist/features/rewards/programme-operator-v3.js");
  const { createPublicClient, defineChain, http } = await import("viem");
  const { REWARD_OPERATOR_RPC_URL: rpcUrl, rewardOperatorChainFetch } = await import("./operator-transport.mjs");
  const controller = new AbortController(), stop = () => controller.abort();
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  try {
    const credentials = await readOperatorCredentials(process.stdin, controller.signal);
    assertOperatorSource(config.release.sourceCommit);
    const chain = defineChain({ id: 10143, name: "Monad testnet", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } });
    const reader = createPublicClient({ chain, transport: http(rpcUrl, { timeout: 10000, retryCount: 0,
      fetchFn: rewardOperatorChainFetch(controller.signal) }), cacheTime: 0 });
    const result = await runAuthenticatedProgrammeOperatorV3({ target: { mode: "testnet", chainId: 10143,
      origin: config.release.origin, supabaseUrl: `https://${config.release.supabase.projectRef}.supabase.co` }, ...credentials,
      draftId: config.draftId, programmeAddress: config.programmeAddress, operatorAddress: config.operatorAddress,
      operatorUserId: config.operatorUserId, workerId: randomUUID(), jobs: config.jobs,
      maxGasCostWei: BigInt(config.maxGasCostWei), durationMs: config.durationSeconds * 1000 }, {
      reader, signal: controller.signal,
      broadcast: bytes => reader.request({ method: "eth_sendRawTransaction", params: [bytes] }, { retryCount: 0 }),
    });
    const output = { ...result, planDigest, sourceCommit: config.release.sourceCommit };
    log(JSON.stringify(output, null, 2)); return output;
  } finally { controller.abort(); process.off("SIGINT", stop); process.off("SIGTERM", stop); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { process.exitCode = programmeOperatorExitCodeV3(await main()); }
  catch { console.error("reward_programme_operator_command_failed"); process.exitCode = 1; }
}
