import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { listMigrationSources } from "../../../packages/db/scripts/reward-migration-sources.mjs";
import { decodeSponsorExecutionPolicy } from "../../../packages/domain/dist/rewards/sponsor-execution.js";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export const workdir = join(root, "demo/rewards/local");
export const project = "raceson-rewards-demo";
export const network = "raceson-rewards-demo-loopback";
export const origin = "http://127.0.0.1:3101";
export const database = "http://127.0.0.1:55321";
const containers = ["db", "kong", "auth", "rest", "storage", "inbucket"].map(name => `supabase_${name}_${project}`);
const excluded = "realtime,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor";

// No inherited application credentials, DB URLs, CLI project links or .env load.
export function cleanEnvironment() {
  return Object.fromEntries(["PATH", "HOME", "TMPDIR", "DOCKER_HOST", "DOCKER_CONTEXT"]
    .filter(key => process.env[key]).map(key => [key, process.env[key]]));
}
function command(executable, args, input) {
  try {
    return execFileSync(executable, args, { cwd: root, env: cleanEnvironment(), input,
      encoding: "utf8", stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      timeout: 180_000, maxBuffer: 16 * 1024 * 1024 });
  } catch {
    // Child process errors can include complete credentials and HTTP bodies.
    throw new Error(`Local demo ${executable} ${args[0]} failed; no credentials were logged.`);
  }
}
function assertSourceBoundary() {
  const context = command("docker", ["context", "show"]).trim();
  const endpoint = process.env.DOCKER_HOST || command("docker", ["context", "inspect", context, "--format", "{{.Endpoints.docker.Host}}"]).trim();
  assert.ok(endpoint.startsWith("unix:///"), "Only a local Unix-socket Docker engine is supported");
  assert.equal(realpathSync(workdir), workdir);
  assert.equal(existsSync(join(workdir, "supabase/.temp/project-ref")), false, "A linked demo directory is forbidden");
  assert.equal(existsSync(join(root, "demo/rewards/web/.env.local")), false, "Remove inherited demo env files before using this launcher");
  for (const entry of readdirSync(join(root, "demo/rewards/web"))) {
    assert.ok(!/^\.env(?:\.|$)/.test(entry), "The local launcher refuses dotenv files");
  }
  const config = readFileSync(join(workdir, "supabase/config.toml"), "utf8");
  assert.match(config, /^project_id = "raceson-rewards-demo"$/m);
  for (const port of [55321, 55322, 55324]) assert.match(config, new RegExp(`^port = ${port}$`, "m"));
  assert.match(config, /^site_url = "http:\/\/127\.0\.0\.1:3101"$/m);
  assert.doesNotMatch(config, /env\(|https:\/\/|content_path|signing_keys_path/);
}
export function validateContainers(items) {
  assert.equal(items.length, containers.length);
  const names = new Set(items.map(item => item.Name.replace(/^\//, "")));
  assert.deepEqual(names, new Set(containers));
  for (const item of items) {
    assert.equal(item.Config.Labels["com.supabase.cli.project"], project);
    assert.equal(item.Config.Labels["com.supabase.cli.workdir"], workdir);
    assert.equal(item.State.Running, true, "Demo container is stopped");
    assert.ok(item.NetworkSettings.Networks[network], "Demo network missing");
    assert.equal(Object.keys(item.NetworkSettings.Networks).length, 1, "Unexpected additional Docker network");
    for (const bindings of Object.values(item.NetworkSettings.Ports)) {
      for (const binding of bindings ?? []) {
        assert.equal(binding.HostIp, "127.0.0.1", "Refusing non-loopback demo port");
        assert.ok(["55321", "55322", "55324"].includes(binding.HostPort), "Unexpected demo port");
      }
    }
    for (const mount of item.Mounts) {
      if (mount.Type === "volume") {
        assert.ok(mount.Name.endsWith(`_${project}`), "Demo volume belongs to another project");
      } else {
        // CLI 2.110 materializes its own config/certificates as read-only binds.
        const container = item.Name.replace(/^\//, "");
        const prefix = join(workdir, "supabase/.temp/start-secrets", container) + "/";
        assert.equal(mount.Type, "bind"); assert.equal(mount.RW, false);
        assert.ok(mount.Source.startsWith(prefix) && /^secret-\d+$/.test(mount.Source.slice(prefix.length)), "Demo refuses external host data mounts");
        assert.ok(["/etc/postgresql-custom/pgsodium_root.key", "/home/kong/kong.yml", "/home/kong/localhost.key", "/home/kong/localhost.crt"].includes(mount.Destination));
      }
    }
  }
}
export function assertLocalStack() {
  assertSourceBoundary();
  const [net] = JSON.parse(command("docker", ["network", "inspect", network]));
  assert.equal(net.Options["com.docker.network.bridge.host_binding_ipv4"], "127.0.0.1");
  assert.equal(net.Labels["com.raceson.purpose"], "rewards-local-demo");
  validateContainers(JSON.parse(command("docker", ["inspect", ...containers])));
}
export function localCredentials() {
  assertLocalStack();
  const result = JSON.parse(command("supabase", ["status", "--workdir", workdir, "-o", "json"]));
  assert.equal(result.API_URL, database);
  assert.equal(new URL(result.DB_URL).host, "127.0.0.1:55322");
  assert.ok(result.ANON_KEY && result.SERVICE_ROLE_KEY && result.PUBLISHABLE_KEY);
  return result;
}
export function localAppEnvironment(credentials, mode = "local") {
  assert.equal(credentials.API_URL, database);
  assert.ok(mode === "local" || mode === "local-testnet");
  const appOrigin = mode === "local-testnet" ? "http://127.0.0.1:3102" : origin;
  const privyAppId = process.env.RACESON_REWARD_PRIVY_APP_ID;
  // Explicit public V4 authority/return settings only. Never inherit a key or
  // silently reuse an earlier pilot's operator, treasury or review policy.
  const sponsorPolicy = process.env.RACESON_SPONSOR_V4_POLICY;
  if (sponsorPolicy !== undefined) decodeSponsorExecutionPolicy(JSON.parse(sponsorPolicy));
  if (privyAppId !== undefined) {
    assert.ok(mode === "local-testnet" && /^[a-z0-9]{20,64}$/.test(privyAppId), "Privy requires an explicit public demo App ID and local-testnet mode");
  }
  return {
    ...cleanEnvironment(), NODE_ENV: "development", CI: "true", NEXT_TELEMETRY_DISABLED: "1",
    RACESON_REWARD_PORTAL_MODE: mode, NEXT_PUBLIC_RACESON_REWARD_PORTAL_MODE: mode,
    RACESON_REWARD_DEMO_ORIGIN: appOrigin, NEXT_PUBLIC_RACESON_REWARD_DEMO_ORIGIN: appOrigin,
    RACESON_REWARD_DEMO_SUPABASE_URL: database, NEXT_PUBLIC_RACESON_REWARD_DEMO_SUPABASE_URL: database,
    APP_BASE_URL: appOrigin, NEXT_PUBLIC_RACESON_AUTH_REDIRECT_BASE_URL: appOrigin,
    API_CORS_ORIGIN: appOrigin, SUPABASE_URL: database, NEXT_PUBLIC_SUPABASE_URL: database,
    NEXT_PUBLIC_SUPABASE_PUBLIC_URL: database, SUPABASE_ANON_KEY: credentials.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: credentials.SERVICE_ROLE_KEY,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: credentials.PUBLISHABLE_KEY,
    NEXT_PUBLIC_RACESON_SUPABASE_STORAGE_KEY: "raceson-rewards-demo-auth",
    NEXT_PUBLIC_RACESON_API_BASE_URL: "/api", NEXT_PUBLIC_RACESON_REWARDS_ENABLED: "true",
    ...(privyAppId ? { RACESON_REWARD_PRIVY_APP_ID: privyAppId, NEXT_PUBLIC_RACESON_REWARD_PRIVY_APP_ID: privyAppId } : {}),
    ...(sponsorPolicy ? { RACESON_SPONSOR_V4_POLICY: sponsorPolicy } : {}),
    ...(process.env.RACESON_REWARD_CONTROLLER ? { RACESON_REWARD_CONTROLLER: process.env.RACESON_REWARD_CONTROLLER } : {}),
    // Explicit demo-only deployment signer. These never become NEXT_PUBLIC values.
    ...Object.fromEntries(["RACESON_CONTROLLER_DEPLOYMENT_VERIFIED","RACESON_CONTROLLER_DEPLOYMENT","RACESON_SPONSOR_DEPLOYMENT_APP_SECRET","RACESON_CONTROLLER_DEPLOYMENT_AUTH_KEY"]
      .filter(key=>mode==="local-testnet"&&process.env[key]).map(key=>[key,process.env[key]])),
  };
}
export function localSql(sql) {
  assertLocalStack();
  return command("docker", ["exec", "-i", `supabase_db_${project}`, "psql", "-X", "-U", "postgres", "-d", "postgres",
    "-A", "-t", "-q", "-v", "ON_ERROR_STOP=1"], `set statement_timeout='30s'; set lock_timeout='5s';\n${sql}`);
}
function migrate() {
  assertLocalStack();
  const directory = join(workdir, "supabase/migrations");
  mkdirSync(directory, { recursive: true });
  const sources = listMigrationSources(true);
  const expected = new Set(sources.map(source => basename(source)));
  for (const name of readdirSync(directory)) assert.ok(expected.has(name), "Unrecognized generated migration");
  // Mechanical SQL-only composition, no seeds, runtime records or root link state.
  for (const source of sources) {
    const target = join(directory, basename(source));
    if (existsSync(target)) {
      assert.ok(lstatSync(target).isFile());
      assert.equal(createHash("sha256").update(readFileSync(target)).digest("hex"),
        createHash("sha256").update(readFileSync(source)).digest("hex"), "Previously composed migration changed; do not reset or overwrite it");
    } else copyFileSync(source, target);
  }
  command("supabase", ["migration", "up", "--local", "--workdir", workdir]);
  console.log(`Demo schema ready: ${sources.length} SQL sources; no production data or seeds copied.`);
}
// A public transaction hash is an observation hint, never a funding or release
// approval. Do not inherit it (or signer settings) from an ambient environment.
export function canaryStatusConfiguration(action, extra) {
  if (extra.length === 0) return {};
  assert.ok(action === "dev-testnet" && extra.length === 2 && extra[0] === "--canary-deployment-tx"
    && /^0x[0-9a-f]{64}$/.test(extra[1]) && !/^0x0{64}$/.test(extra[1]), "Unexpected arguments or invalid public deployment hash");
  return { RACESON_REWARD_CANARY_DEPLOYMENT_TX_HASH: extra[1] };
}
async function main() {
  const [action, ...extra] = process.argv.slice(2);
  const statusConfiguration = canaryStatusConfiguration(action, extra);
  assertSourceBoundary();
  if (action === "check") { assertLocalStack(); console.log("Six demo services verified; ports 55321/55322/55324 are loopback-only."); }
  else if (action === "migrate") migrate();
  else if (action === "dev" || action === "dev-testnet") {
    const env = { ...localAppEnvironment(localCredentials(), action === "dev-testnet" ? "local-testnet" : "local"), ...statusConfiguration };
    const args = action === "dev-testnet" ? ["run", "dev:testnet", "--workspace", "@raceson/rewards-demo-web"] : ["run", "dev:rewards"];
    const child = spawn("npm", args, { cwd: root, env, stdio: "inherit" });
    child.on("exit", code => { process.exitCode = code ?? 1; });
    for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => child.kill(signal));
  } else if (action === "start") {
    const names = command("docker", ["network", "ls", "--format", "{{.Name}}"]).trim().split("\n");
    if (!names.includes(network)) command("docker", ["network", "create", "--driver", "bridge", "--opt",
      "com.docker.network.bridge.host_binding_ipv4=127.0.0.1", "--label", "com.raceson.purpose=rewards-local-demo", network]);
    const [net] = JSON.parse(command("docker", ["network", "inspect", network]));
    assert.equal(net.Options["com.docker.network.bridge.host_binding_ipv4"], "127.0.0.1");
    assert.equal(net.Labels["com.raceson.purpose"], "rewards-local-demo");
    command("supabase", ["start", "--workdir", workdir, "--network-id", network, "--exclude", excluded, "--yes"]);
    assertLocalStack(); console.log("Isolated local demo services started.");
  } else throw new Error("Usage: local-demo.mjs start|check|migrate|dev|dev-testnet");
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
