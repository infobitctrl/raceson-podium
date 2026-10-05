import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PassThrough, Readable } from "node:stream";
import { createPublicClient, http } from "viem";
import { assertOperatorSource, normalizeOperatorConfig, operatorExitCode, parseOperatorArguments, readOperatorCredentials } from "../../../demo/rewards/scripts/operator.mjs";
import { REWARD_OPERATOR_RPC_URL, rewardOperatorChainFetch } from "../../../demo/rewards/scripts/operator-transport.mjs";
import { DEMO_SUPABASE_ORGANIZATION, DEMO_VERCEL_TEAM, validateDemoReleaseManifest } from "../../../demo/rewards/scripts/release-manifest.mjs";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const cli = resolve(root, "demo/rewards/scripts/operator.mjs");
const secret = "synthetic-private-sentinel-not-a-real-credential";
const credentials = { accessToken: secret, publishableKey: `sb_publishable_${secret}`, serverKey: `sb_secret_${secret}` };
const config = () => ({ formatVersion: 1, release: {
  formatVersion: 1, kind: "raceson-rewards-testnet", repository: "infobitctrl/raceson-podium", sourceCommit: "a".repeat(40),
  chainId: 10143, origin: "https://rewards-demo.example.invalid",
  vercel: { teamId: DEMO_VERCEL_TEAM, projectId: "prj_DemoFixtureOnly", environment: "production", rootDirectory: "demo/rewards/web" },
  supabase: { organizationId: DEMO_SUPABASE_ORGANIZATION, projectRef: "abcdefghijklmnopqrst" },
}, programmeId: "00000000-0000-4000-8000-000000000001", operatorUserId: "00000000-0000-4000-8000-000000000002",
maxJobs: 20, durationSeconds: 60, gasPolicy: { maxGasLimit: "5000000", maxFeePerGas: "100000000000",
  maxTotalFeeWei: "500000000000000000", minimumRemainingBalanceWei: "10000000000000000" } });

function fixture(t) {
  const parent = resolve(root, "tmp"); mkdirSync(parent, { recursive: true });
  const directory = mkdtempSync(resolve(parent, "reward-operator-command-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const write = (name, value) => { const path = resolve(directory, name); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, value); return path; };
  return { directory, write };
}

test("operator arguments expose only explicit plan/run configuration, never credential flags", () => {
  assert.deepEqual(parseOperatorArguments(["--help"]), { command: "help" });
  assert.equal(parseOperatorArguments(["plan", "--config", "demo.json"]).configPath, resolve("demo.json"));
  assert.equal(parseOperatorArguments(["run", "--confirm-plan", "a".repeat(64), "--config", "demo.json"]).confirmation, "a".repeat(64));
  for (const args of [null, [], ["run"], ["--help", secret], ["plan", "--config", 42],
    ["plan", "--token", secret], ["plan", "--config", "--run"], ["run", "--config", "demo.json"],
    ["run", "--config", "demo.json", "--config", "other.json"],
    ["run", "--config", "demo.json", "--confirm-plan", "YES"], ["run", "--config", "demo.json", "--server-key", secret]]) {
    assert.throws(() => parseOperatorArguments(args), { message: "reward_operator_usage" });
  }
});

test("operator config preserves deterministic explicit bounds and rejects mainnet, production and secrets", () => {
  const raw = config(); const normalized = normalizeOperatorConfig(raw, validateDemoReleaseManifest);
  assert.deepEqual(normalized, raw);
  raw.gasPolicy.maxGasLimit = "1"; raw.release.origin = "https://changed.example.invalid";
  assert.equal(normalized.gasPolicy.maxGasLimit, "5000000");
  assert.equal(normalized.release.origin, "https://rewards-demo.example.invalid");
  for (const change of [v => { v.secret = secret; }, v => { v.formatVersion = 2; }, v => { v.programmeId = "name"; },
    v => { v.operatorUserId = null; }, v => { v.maxJobs = 0; }, v => { v.maxJobs = 101; }, v => { v.maxJobs = 1.5; },
    v => { v.durationSeconds = 0; }, v => { v.durationSeconds = 1801; }, v => { v.gasPolicy.maxGasLimit = 5000000; },
    v => { v.gasPolicy.maxGasLimit = "1e9"; }, v => { v.gasPolicy.maxGasLimit = "0"; }, v => { v.gasPolicy.maxGasLimit = "9".repeat(41); },
    v => { v.gasPolicy.token = secret; }, v => { v.release.chainId = 143; }, v => { v.release.chainId = 31337; },
    v => { v.release.origin = "https://www.raceson.com"; }, v => { v.release.supabase.projectRef = "icdtinbmtvzhswrrzjxq"; },
    v => { v.release.vercel.rootDirectory = "apps/web"; }, v => { v.release.serverKey = secret; }]) {
    const value = config(); change(value);
    assert.throws(() => normalizeOperatorConfig(value, validateDemoReleaseManifest), error => /^reward_(operator_config|demo_release_manifest)_invalid$/.test(error.message));
  }
});

test("source guard accepts exact runtime source and rejects tracked/untracked drift without requiring unrelated work to stop", t => {
  const f = fixture(t);
  const git = (...args) => execFileSync("git", ["-c", "user.name=Rewards Test", "-c", "user.email=rewards-test@example.invalid",
    "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], {
    cwd: f.directory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { PATH: process.env.PATH, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
  }).trim();
  git("init", "--quiet");
  f.write("apps/api/src/operator.ts", "// synthetic source\n");
  f.write("packages/db/package.json", "{}\n"); f.write("docs/unrelated.md", "original\n");
  git("add", "apps/api/src/operator.ts", "packages/db/package.json", "docs/unrelated.md"); git("commit", "--quiet", "-m", "synthetic operator guard fixture");
  const commit = git("rev-parse", "HEAD");
  assert.doesNotThrow(() => assertOperatorSource(commit, f.directory));
  f.write("docs/unrelated.md", "peer work\n");
  assert.doesNotThrow(() => assertOperatorSource(commit, f.directory));
  assert.throws(() => assertOperatorSource("a".repeat(40), f.directory), { message: "reward_operator_source_mismatch" });
  f.write("apps/api/src/new.ts", "// unreviewed\n");
  assert.throws(() => assertOperatorSource(commit, f.directory), { message: "reward_operator_source_mismatch" });
  rmSync(resolve(f.directory, "apps/api/src/new.ts"));
  f.write("packages/db/package.json", '{"exports":"./different.js"}\n');
  assert.throws(() => assertOperatorSource(commit, f.directory), { message: "reward_operator_source_mismatch" });
});

test("credentials are read only from a finite pipe and handlers are removed", async () => {
  const bytes = JSON.stringify(credentials); const stream = Readable.from([bytes.slice(0, 10), bytes.slice(10)]);
  assert.deepEqual(await readOperatorCredentials(stream, new AbortController().signal), credentials);
  for (const event of ["data", "end", "error", "close"]) assert.equal(stream.listenerCount(event), 0);
});

test("invalid, terminal, oversized or interrupted credential pipes fail privately and promptly", async () => {
  const refused = { message: "reward_operator_credentials_required" };
  for (const content of [secret, "{}", JSON.stringify({ ...credentials, privateKey: secret }), JSON.stringify({ ...credentials, accessToken: "" }),
    JSON.stringify({ ...credentials, accessToken: "a".repeat(8193) }), "a".repeat(16385)]) {
    await assert.rejects(readOperatorCredentials(Readable.from([content]), new AbortController().signal), refused);
  }
  const tty = new PassThrough(); tty.isTTY = true;
  await assert.rejects(readOperatorCredentials(tty, new AbortController().signal), refused); tty.destroy();
  const closed = new PassThrough(); closed.destroy();
  await assert.rejects(readOperatorCredentials(closed, new AbortController().signal), refused);
  for (const action of ["timeout", "abort", "close", "error", "object"]) {
    const stream = new PassThrough({ objectMode: action === "object" }); const controller = new AbortController();
    const pending = readOperatorCredentials(stream, controller.signal, 30);
    const verified = assert.rejects(pending, refused);
    if (action === "abort") controller.abort();
    if (action === "close") stream.destroy();
    if (action === "error") stream.destroy(new Error(secret));
    if (action === "object") stream.write({ secret });
    await verified;
    for (const event of ["data", "end", "error", "close"]) assert.equal(stream.listenerCount(event), 0);
    stream.destroy();
  }
});

test("actual CLI help and invalid source run require no stdin, inherited environment or network", t => {
  const env = { PATH: process.env.PATH, SUPABASE_URL: "https://icdtinbmtvzhswrrzjxq.supabase.co", SUPABASE_SERVICE_ROLE_KEY: secret };
  const help = spawnSync(process.execPath, [cli, "--help"], { cwd: root, timeout: 5000, encoding: "utf8", env });
  assert.equal(help.status, 0); assert.match(help.stdout, /already queued and signed jobs only/); assert.equal(help.stderr, "");
  const f = fixture(t); const path = f.write("config.json", JSON.stringify(config()));
  for (const args of [["plan", "--config", path], ["run", "--config", path, "--confirm-plan", "a".repeat(64)],
    ["run", "--config", path, "--server-key", secret]]) {
    const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, timeout: 5000, encoding: "utf8", env, input: JSON.stringify(credentials) });
    assert.equal(result.status, 1); assert.equal(result.stdout, ""); assert.equal(result.stderr, "reward_operator_command_failed\n");
  }
});

function response(body, { url = new URL(REWARD_OPERATOR_RPC_URL).href, headers = {}, status = 200 } = {}) {
  const result = new Response(body, { status, headers: { "content-type": "application/json", ...headers } });
  Object.defineProperty(result, "url", { value: url }); return result;
}

test("exit status flags unresolved work even when the job-count limit was reached", () => {
  assert.equal(operatorExitCode(undefined), 0);
  assert.equal(operatorExitCode({ stop: "queue_empty", entries: [] }), 0);
  assert.equal(operatorExitCode({ stop: "limit_reached", entries: [{ outcome: "confirmed" }] }), 0);
  for (const stop of ["signers_deferred", "attention_required", "unavailable", "stopped"]) assert.equal(operatorExitCode({ stop, entries: [] }), 2);
  for (const outcome of ["gas_guard", "broadcast_unknown", "pending", "submitted", "nonce_conflict"]) {
    assert.equal(operatorExitCode({ stop: "limit_reached", entries: [{ outcome }] }), 2);
  }
});
const request = (method = "eth_chainId", params = []) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });

test("actual viem client uses the bounded testnet transport for reads and exact signed-byte submission", async () => {
  const seen = []; const controller = new AbortController();
  const fetchFn = rewardOperatorChainFetch(controller.signal, async (input, init) => {
    const body = JSON.parse(await input.text()); seen.push(body);
    assert.equal(init.redirect, "error"); assert.equal(init.credentials, "omit"); assert.equal(init.cache, "no-store");
    return response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: body.method === "eth_chainId" ? "0x279f" : `0x${"a".repeat(64)}` }));
  });
  const reader = createPublicClient({ transport: http(REWARD_OPERATOR_RPC_URL, { fetchFn, retryCount: 0 }), cacheTime: 0 });
  assert.equal(await reader.getChainId(), 10143);
  assert.equal(await reader.request({ method: "eth_sendRawTransaction", params: ["0x1234"] }, { retryCount: 0 }), `0x${"a".repeat(64)}`);
  assert.deepEqual(seen[1].params, ["0x1234"]); assert.equal(seen.length, 2);
  controller.abort(); await assert.rejects(reader.getChainId()); assert.equal(seen.length, 2);
});

test("chain transport refuses foreign URLs, wallet commands, credentials, redirects and oversized/non-JSON responses", async () => {
  const refused = { message: "reward_operator_chain_unavailable" };
  let calls = 0;
  const transport = rewardOperatorChainFetch(new AbortController().signal, async () => { calls++; throw new Error(secret); });
  for (const [url, init] of [["https://rpc.monad.xyz", request()], [`${REWARD_OPERATOR_RPC_URL}?token=${secret}`, request()],
    [REWARD_OPERATOR_RPC_URL, request("eth_sendTransaction")], [REWARD_OPERATOR_RPC_URL, request("personal_sign")],
    [REWARD_OPERATOR_RPC_URL, { ...request(), headers: { authorization: secret } }],
    [REWARD_OPERATOR_RPC_URL, { ...request(), method: "GET" }], [REWARD_OPERATOR_RPC_URL, { ...request(), body: "x".repeat(1024 * 1024 + 1) }]]) {
    await assert.rejects(transport(url, init), refused);
  }
  assert.equal(calls, 0);
  await assert.rejects(transport(REWARD_OPERATOR_RPC_URL, request()), refused); assert.equal(calls, 1);
  for (const make of [() => response("{}", { url: "https://elsewhere.example.invalid/" }),
    () => response("{}", { headers: { "content-type": "text/plain" } }),
    () => response("{}", { headers: { "content-length": "8388609" } }),
    () => response("{}", { headers: { "content-length": "NaN" } }),
    () => response(new Uint8Array(8388609))]) {
    await assert.rejects(rewardOperatorChainFetch(new AbortController().signal, async () => make())(REWARD_OPERATOR_RPC_URL, request()), refused);
  }
});

test("chain response headers and bodies are bounded even when fetch ignores cancellation", async () => {
  for (const fetchImpl of [() => new Promise(() => {}), async () => response(new ReadableStream({ pull: () => new Promise(() => {}) }))]) {
    const started = Date.now();
    await assert.rejects(rewardOperatorChainFetch(new AbortController().signal, fetchImpl, 30)(REWARD_OPERATOR_RPC_URL, request()), { message: "reward_operator_chain_unavailable" });
    assert.ok(Date.now() - started < 2000);
  }
  const controller = new AbortController();
  const pending = rewardOperatorChainFetch(controller.signal, () => new Promise(() => {}))(REWARD_OPERATOR_RPC_URL, request());
  const verified = assert.rejects(pending, { message: "reward_operator_chain_unavailable" }); controller.abort(); await verified;
});
