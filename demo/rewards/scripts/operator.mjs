#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const fail = code => { throw new Error(`reward_operator_${code}`); };
const exact = (v, keys) => v && typeof v === "object" && !Array.isArray(v)
  && Object.keys(v).sort().join("\0") === [...keys].sort().join("\0");
const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const keyNames = ["maxGasLimit", "maxFeePerGas", "maxTotalFeeWei", "minimumRemainingBalanceWei"];
const uuid = value => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const help = `Isolated Monad testnet operator; never deploys SQL/applications or signs transactions.
  plan --config <non-secret.json>
  run --config <non-secret.json> --confirm-plan <sha256>
Run requires a separately approved isolated deployment/source and funded programme.
Credentials arrive only as piped JSON on stdin: accessToken, publishableKey, serverKey.
Never paste credentials into a terminal, command argument, source file or chat.
No .env/CLI login, production credentials, profile bootstrap or auto-signing fallback.
No automatic schedule. This command processes already queued and signed jobs only.
`;

export function parseOperatorArguments(args) {
  if (!Array.isArray(args) || args.some(arg => typeof arg !== "string")) return fail("usage");
  if (args.length === 1 && args[0] === "--help") return { command: "help" };
  const [command, ...rest] = args;
  if (!["plan", "run"].includes(command) || rest.length !== (command === "run" ? 4 : 2)) return fail("usage");
  const flags = new Map();
  for (let n = 0; n < rest.length; n += 2) {
    const [key, value] = rest.slice(n, n + 2);
    if (!["--config", ...(command === "run" ? ["--confirm-plan"] : [])].includes(key)
      || flags.has(key) || !value || value.startsWith("--")) return fail("usage");
    flags.set(key, value);
  }
  if (!flags.has("--config") || (command === "run" && !/^[a-f0-9]{64}$/.test(flags.get("--confirm-plan") ?? ""))) return fail("usage");
  return { command, configPath: resolve(flags.get("--config")), confirmation: flags.get("--confirm-plan") };
}

export function normalizeOperatorConfig(value, validateRelease) {
  if (!exact(value, ["formatVersion", "release", "programmeId", "operatorUserId", "maxJobs", "durationSeconds", "gasPolicy"])
    || value.formatVersion !== 1 || !uuid(value.programmeId) || !uuid(value.operatorUserId)
    || !Number.isInteger(value.maxJobs) || value.maxJobs < 1 || value.maxJobs > 100
    || !Number.isInteger(value.durationSeconds) || value.durationSeconds < 1 || value.durationSeconds > 1800
    || !exact(value.gasPolicy, keyNames) || keyNames.some(key => typeof value.gasPolicy[key] !== "string"
      || !/^[1-9][0-9]{0,39}$/.test(value.gasPolicy[key]))) return fail("config_invalid");
  return { formatVersion: 1, release: validateRelease(value.release), programmeId: value.programmeId,
    operatorUserId: value.operatorUserId, maxJobs: value.maxJobs, durationSeconds: value.durationSeconds,
    gasPolicy: Object.fromEntries(keyNames.map(key => [key, value.gasPolicy[key]])) };
}

function readConfig(path) {
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 16384) return fail("config_invalid");
    return JSON.parse(readFileSync(path, "utf8"));
  } catch { return fail("config_invalid"); }
}

export function assertOperatorSource(commit, repository = root) {
  if (typeof commit !== "string" || !/^[a-f0-9]{40}$/.test(commit)) return fail("source_mismatch");
  const options = { cwd: repository, timeout: 15_000, maxBuffer: 1024 * 1024, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8",
    env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_OPTIONAL_LOCKS: "0" } };
  const paths = ["apps/api", "packages/db/src", "packages/db/package.json", "packages/db/tsconfig.json",
    "packages/domain", "packages/rewards-chain", "demo/rewards", "contracts",
    "package.json", "package-lock.json", "tsconfig.base.json"];
  try {
    if (execFileSync("git", ["--no-replace-objects", "rev-parse", "HEAD"], options).trim() !== commit) return fail("source_mismatch");
    execFileSync("git", ["--no-replace-objects", "diff", "--quiet", commit, "--", ...paths], options);
    if (execFileSync("git", ["ls-files", "--others", "--exclude-standard", "--", ...paths], options).trim()) return fail("source_mismatch");
  } catch { return fail("source_mismatch"); }
}

export async function readOperatorCredentials(stream, signal, timeoutMs = 15000) {
  if (stream.isTTY || stream.destroyed || stream.readableEnded || signal.aborted
    || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 15000) return fail("credentials_required");
  let timer; let onAbort; let onData; let onEnd; let onError;
  try {
    return await new Promise((accept, reject) => {
      const refused = () => reject(new Error("reward_operator_credentials_required"));
      let size = 0; const chunks = [];
      onData = chunk => {
        try { size += Buffer.byteLength(chunk); if (size > 16384) return refused(); chunks.push(Buffer.from(chunk)); }
        catch { refused(); }
      };
      onEnd = () => {
        try {
          const value = JSON.parse(Buffer.concat(chunks, size).toString("utf8"));
          if (!exact(value, ["accessToken", "publishableKey", "serverKey"])
            || Object.values(value).some(v => typeof v !== "string" || v.length < 1 || v.length > 8192)) return refused();
          accept({ accessToken: value.accessToken, publishableKey: value.publishableKey, serverKey: value.serverKey });
        } catch { refused(); }
      };
      onError = refused; onAbort = refused;
      stream.on("data", onData); stream.once("end", onEnd); stream.once("error", onError); stream.once("close", onError);
      signal.addEventListener("abort", onAbort, { once: true });
      timer = setTimeout(refused, timeoutMs);
    });
  } finally {
    clearTimeout(timer); signal.removeEventListener("abort", onAbort);
    stream.off("data", onData); stream.off("end", onEnd); stream.off("error", onError); stream.off("close", onError); stream.pause();
  }
}

export async function main(args = process.argv.slice(2), log = console.log) {
  const parsed = parseOperatorArguments(args);
  if (parsed.command === "help") { log(help); return; }
  const raw = readConfig(parsed.configPath);
  assertOperatorSource(raw?.release?.sourceCommit);
  // Rebuild from the just-checked source, not unverified ignored dist files.
  // No runtime credential is read before these local source/build checks.
  try {
    execFileSync(process.execPath, [resolve(root, "node_modules/typescript/bin/tsc"), "-b", "packages/domain", "packages/db", "apps/api", "--force"],
      { cwd: root, timeout: 60000, maxBuffer: 1024 * 1024, stdio: ["ignore", "pipe", "pipe"], env: { PATH: process.env.PATH } });
  } catch { return fail("build_required"); }
  assertOperatorSource(raw.release.sourceCommit);
  const { validateDemoReleaseManifest } = await import("./release-manifest.mjs");
  const { readDemoReleaseSource } = await import("./release-source.mjs");
  const config = normalizeOperatorConfig(raw, validateDemoReleaseManifest);
  const source = readDemoReleaseSource(config.release);
  const plan = { schemaVersion: 1, kind: "raceson-rewards-testnet-operator-plan", sourcePlanDigest: source.planDigest, config };
  const planDigest = digest(plan);
  if (parsed.command === "plan") { const result = { ...plan, planDigest }; log(JSON.stringify(result, null, 2)); return result; }
  if (parsed.confirmation !== planDigest) return fail("confirmation_required");
  const { runAuthenticatedRewardOperator } = await import("../../../apps/api/dist/features/rewards/operator-command.js");
  const { requireRewardCreationBytecode } = await import("@raceson/rewards-chain");
  const { createPublicClient, defineChain, http } = await import("viem");
  const { REWARD_OPERATOR_RPC_URL: rpcUrl, rewardOperatorChainFetch } = await import("./operator-transport.mjs");
  let creationCode;
  try { creationCode = requireRewardCreationBytecode(JSON.parse(readFileSync(resolve(root,
    "contracts/out/RacesOnRewardCampaign.sol/RacesOnRewardCampaign.json"), "utf8")).bytecode.object); }
  catch { return fail("contract_build_required"); }
  const controller = new AbortController(); const stop = () => controller.abort();
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  try {
    const credentials = await readOperatorCredentials(process.stdin, controller.signal);
    assertOperatorSource(config.release.sourceCommit);
    const chain = defineChain({ id: 10143, name: "Monad testnet", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } });
    const reader = createPublicClient({ chain, transport: http(rpcUrl, { timeout: 10000, retryCount: 0,
      fetchFn: rewardOperatorChainFetch(controller.signal) }), cacheTime: 0 });
    const result = await runAuthenticatedRewardOperator({ target: { mode: "testnet", chainId: 10143, origin: config.release.origin,
      supabaseUrl: `https://${config.release.supabase.projectRef}.supabase.co` }, ...credentials,
      programmeId: config.programmeId, operatorUserId: config.operatorUserId, workerId: randomUUID(),
      maxJobs: config.maxJobs, durationMs: config.durationSeconds * 1000 }, {
      reader, creationCode, signal: controller.signal, gasPolicy: Object.fromEntries(keyNames.map(key => [key, BigInt(config.gasPolicy[key])])),
      broadcast: bytes => reader.request({ method: "eth_sendRawTransaction", params: [bytes] }, { retryCount: 0 }),
    });
    const output = { ...result, planDigest, sourceCommit: config.release.sourceCommit };
    log(JSON.stringify(output, null, 2)); return output;
  } finally {
    controller.abort(); process.off("SIGINT", stop); process.off("SIGTERM", stop);
  }
}

export function operatorExitCode(result) {
  if (!result?.stop) return 0; // Help or an offline plan, never a payment assertion.
  return ["queue_empty", "limit_reached"].includes(result.stop)
    && Array.isArray(result.entries) && result.entries.every(entry => entry.outcome === "confirmed") ? 0 : 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    process.exitCode = operatorExitCode(await main());
  } catch {
    // No raw SDK, database, input JSON, credentials or signed transaction errors.
    console.error("reward_operator_command_failed"); process.exitCode = 1;
  }
}
