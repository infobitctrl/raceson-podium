import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRewardOperatorClient, rewardOperatorFetch, rewardProgrammeOperatorFetchV3 } from "../../../packages/db/dist/rewards/index.js";
import { runAuthenticatedProgrammeOperatorV3 } from "../dist/features/rewards/programme-operator-v3.js";
import { programmeOperatorAuthFixtureV3 } from "./fixtures/reward-programme-operator-v3.mjs";
import { normalizeProgrammeOperatorConfigV3, programmeOperatorExitCodeV3 } from "../../../demo/rewards/scripts/programme-operator-v3.mjs";
import { DEMO_SUPABASE_ORGANIZATION, DEMO_VERCEL_TEAM, validateDemoReleaseManifest } from "../../../demo/rewards/scripts/release-manifest.mjs";
const id = n => `8d000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const identity = { userId: id(1), sessionId: id(2) };
const job = () => ({ slot: 1, approvalId: id(3), uploadId: id(4), intentId: id(5), attemptId: id(6), jobId: id(7), transactionHash: `0x${"a".repeat(64)}` });
const input = auth => ({ target: auth.target, ...auth.credentials, draftId: id(8), programmeAddress: `0x${"b".repeat(40)}`,
  operatorAddress: `0x${"c".repeat(40)}`, operatorUserId: identity.userId, workerId: id(9), durationMs: 60000,
  maxGasCostWei: 1000000000000000000n, jobs: [job()] });
const dependencies = { reader: {}, broadcast() { assert.fail("no unapproved send"); } };

test("V3 delivery client verifies SDK Auth and allows only its three exact private RPCs, never V1 dispatch/signing/queueing", async () => {
  const seen = [];
  const auth = programmeOperatorAuthFixtureV3(identity, async (method, args) => { seen.push(method); assert.equal(args.p_chain_id, 31337); return { data: null, error: null }; });
  const controller = new AbortController(), client = auth.clientFactory({ target: auth.target, ...auth.credentials, signal: controller.signal });
  const args = { p_actor_user_id: identity.userId, p_actor_session_id: identity.sessionId, p_chain_id: 31337 };
  await assert.rejects(client.rpc("service_read_reward_programme_lifecycle_v3", args), /reward_operator_auth_required/);
  assert.deepEqual((await client.authenticate(auth.credentials.accessToken, identity.userId)).identity, identity);
  for (const method of ["service_read_reward_programme_lifecycle_v3", "service_read_reward_programme_lifecycle_job_v3", "service_step_reward_programme_lifecycle_job_v3"])
    await client.rpc(method, args);
  for (const method of ["service_next_reward_operator_job", "service_reward_operator_session_call", "service_reserve_reward_programme_lifecycle_v3",
    "service_record_reward_programme_lifecycle_attempt_v3", "service_queue_reward_programme_lifecycle_job_v3", "service_create_reward_programme"])
    await assert.rejects(client.rpc(method, args), /reward_operator_auth_required/);
  for (const patch of [{ p_actor_user_id: id(99) }, { p_actor_session_id: id(99) }, { p_chain_id: 10143 }, { p_chain_id: 143 }])
    await assert.rejects(client.rpc("service_read_reward_programme_lifecycle_v3", { ...args, ...patch }), /reward_operator_auth_required/);
  assert.equal(seen.length, 3); controller.abort();
  await assert.rejects(client.rpc("service_read_reward_programme_lifecycle_v3", args), /reward_operator_auth_required/);
});

test("V3 and legacy transport allowlists remain disjoint, with no project fallback or query-string destinations", async () => {
  const auth = programmeOperatorAuthFixtureV3(identity, () => assert.fail("transport must deny"));
  const never = async () => assert.fail("unexpected network request"), signal = new AbortController().signal;
  const legacy = rewardOperatorFetch(auth.target, signal, never), v3 = rewardProgrammeOperatorFetchV3(auth.target, signal, never);
  const prefix = `${auth.target.supabaseUrl}/rest/v1/rpc/`;
  await assert.rejects(legacy(prefix + "service_read_reward_programme_lifecycle_v3", { method: "POST" }), /reward_operator_transport_unavailable/);
  for (const url of [prefix + "service_reward_operator_session_call", prefix + "service_queue_reward_programme_lifecycle_job_v3",
    prefix + "service_step_reward_programme_lifecycle_job_v3?token=secret", "https://icdtinbmtvzhswrrzjxq.supabase.co/auth/v1/user"])
    await assert.rejects(v3(url, { method: "POST" }), /reward_operator_transport_unavailable/);
  assert.throws(() => createRewardOperatorClient({ target: { ...auth.target, chainId: 143 }, ...auth.credentials, signal }));
});

test("V3 command validates exact selected jobs, programme, target and finite bounds before any Auth or IO", async () => {
  const auth = programmeOperatorAuthFixtureV3(identity, () => assert.fail("no RPC"));
  const raw = input(auth), never = () => assert.fail("invalid input cannot create Auth client");
  const sparse = new Array(1);
  for (const patch of [{ jobs: [] }, { jobs: sparse }, { jobs: Array(101).fill(job()) }, { jobs: [job(), job()] },
    { jobs: [{ ...job(), signedTransaction: "private" }] }, { jobs: [{ ...job(), slot: 7 }] }, { jobs: [{ ...job(), slot: 0 }] },
    { jobs: [{ ...job(), transactionHash: "0x00" }] }, { jobs: [{ ...job(), jobId: "missing" }] }, { maxGasCostWei: 0n },
    { maxGasCostWei: 1n << 256n }, { maxGasCostWei: "100" }, { durationMs: 0 }, { durationMs: 1800001 },
    { target: { ...raw.target, chainId: 143 } }, { target: { ...raw.target, origin: "https://www.raceson.com" } },
    { programmeAddress: `0x${"0".repeat(40)}` }, { operatorAddress: "wallet" }])
    await assert.rejects(runAuthenticatedProgrammeOperatorV3({ ...raw, ...patch }, dependencies, never));
});

test("invalid V3 Auth cannot read a job, and failed reauthentication clears previous authority", async () => {
  const auth = programmeOperatorAuthFixtureV3(identity, () => assert.fail("invalid auth cannot call SQL"));
  for (const patch of [{ sub: id(77) }, { session_id: null }, { exp: 1 }, { exp: Math.floor(Date.now() / 1000) + 3 },
    { is_anonymous: true }, { role: "service_role" }, { iss: "https://icdtinbmtvzhswrrzjxq.supabase.co/auth/v1" }])
    await assert.rejects(runAuthenticatedProgrammeOperatorV3({ ...input(auth), accessToken: auth.token(patch) }, dependencies, auth.clientFactory), /reward_operator_auth_required/);
  const client = auth.clientFactory({ target: auth.target, ...auth.credentials, signal: new AbortController().signal });
  await client.authenticate(auth.credentials.accessToken, identity.userId);
  await assert.rejects(client.authenticate(auth.token({ sub: id(99) }), identity.userId));
  await assert.rejects(client.rpc("service_read_reward_programme_lifecycle_v3", { p_actor_user_id: identity.userId,
    p_actor_session_id: identity.sessionId, p_chain_id: 31337 }), /reward_operator_auth_required/);
});

test("V3 selection refuses accessor arrays and fields without invoking executable input", async () => {
  const auth = programmeOperatorAuthFixtureV3(identity, () => assert.fail("no RPC"));
  let executed = false;
  const get = () => { executed = true; return job(); };
  const list = [job()]; Object.defineProperty(list, "0", { enumerable: true, get });
  const row = job(); Object.defineProperty(row, "jobId", { enumerable: true, get });
  for (const jobs of [list, [row]]) {
    await assert.rejects(runAuthenticatedProgrammeOperatorV3({ ...input(auth), jobs }, dependencies, () => assert.fail("no Auth")));
    assert.throws(() => normalizeProgrammeOperatorConfigV3({ ...config(), jobs }, validateDemoReleaseManifest));
  }
  assert.equal(executed, false);
});

test("V3 command snapshots requested scope before awaiting Auth and returns only sanitized preflight failure", async () => {
  const sentinel = "private-signed-bytes-must-never-escape", raw = input(programmeOperatorAuthFixtureV3(identity, () => {}));
  let signal, calls = 0;
  const result = await runAuthenticatedProgrammeOperatorV3(raw, dependencies, options => {
    signal = options.signal;
    return { authenticate: async () => {
      raw.jobs[0].intentId = id(99); raw.draftId = id(99); raw.maxGasCostWei = 1n;
      return { identity, expiresAtMs: Date.now() + 60000 };
    }, rpc: async (name, args) => {
      calls++; assert.equal(name, "service_read_reward_programme_lifecycle_job_v3");
      assert.equal(args.p_intent_id, id(5)); assert.equal(args.p_draft_id, id(8));
      throw Error(sentinel);
    } };
  });
  assert.equal(result.stop, "unavailable"); assert.equal(result.entries.length, 0); assert.equal(calls, 1);
  assert.equal(result.maxGasCostWei, "1000000000000000000"); assert.equal(signal.aborted, true);
  assert.doesNotMatch(JSON.stringify(result), /private-signed|accessToken|sessionId|sb_secret_|signedTransaction/);
});

test("V3 session expiry margin stops delayed RPCs and never renews authentication", async () => {
  const raw = input(programmeOperatorAuthFixtureV3(identity, () => {})); let signal;
  const result = await runAuthenticatedProgrammeOperatorV3(raw, dependencies, options => {
    signal = options.signal;
    return { authenticate: async () => ({ identity, expiresAtMs: Date.now() + 5050 }), rpc: async () => {
      await new Promise(resolve => signal.addEventListener("abort", resolve, { once: true }));
      throw Error("private transport body");
    } };
  });
  assert.equal(result.stop, "stopped"); assert.equal(result.entries.length, 0); assert.equal(signal.aborted, true);
});

const config = () => ({ formatVersion: 3, release: { formatVersion: 1, kind: "raceson-rewards-testnet", repository: "infobitctrl/raceson-podium",
  sourceCommit: "a".repeat(40), chainId: 10143, origin: "https://rewards-demo.example.invalid",
  vercel: { teamId: DEMO_VERCEL_TEAM, projectId: "prj_DemoFixtureOnly", environment: "production", rootDirectory: "demo/rewards/web" },
  supabase: { organizationId: DEMO_SUPABASE_ORGANIZATION, projectRef: "abcdefghijklmnopqrst" } }, draftId: id(8),
  programmeAddress: `0x${"b".repeat(40)}`, operatorAddress: `0x${"c".repeat(40)}`, operatorUserId: identity.userId,
  durationSeconds: 60, maxGasCostWei: "1000000000000000000", jobs: [job()] });

test("V3 CLI configuration is deterministic, non-secret, source-bound and cannot reinterpret legacy jobs or mainnet", () => {
  const raw = config(), fixed = normalizeProgrammeOperatorConfigV3(raw, validateDemoReleaseManifest);
  assert.deepEqual(raw, fixed); raw.jobs[0].slot = 3; raw.release.origin = "https://elsewhere.invalid";
  assert.equal(fixed.jobs[0].slot, 1); assert.equal(fixed.release.origin, "https://rewards-demo.example.invalid");
  for (const edit of [v => v.formatVersion = 1, v => v.privateKey = "never", v => v.programmeId = id(99), v => v.jobs = [],
    v => v.jobs.push(job()), v => v.jobs[0].slot = 7, v => v.jobs[0].signedTransaction = "never", v => v.jobs[0].intentId = null,
    v => v.maxGasCostWei = "1e18", v => v.maxGasCostWei = (1n << 256n).toString(), v => v.durationSeconds = 1801,
    v => v.release.chainId = 143, v => v.release.chainId = 31337, v => v.release.origin = "https://www.raceson.com",
    v => v.release.supabase.projectRef = "icdtinbmtvzhswrrzjxq", v => v.release.vercel.rootDirectory = "apps/web"])
    { const v = config(); edit(v); assert.throws(() => normalizeProgrammeOperatorConfigV3(v, validateDemoReleaseManifest)); }
});

test("V3 actual CLI help/invalid arguments need no secrets/network; exit success means every selected job confirmed, not payouts", () => {
  const cli = new URL("../../../demo/rewards/scripts/programme-operator-v3.mjs", import.meta.url);
  const options = { encoding: "utf8", timeout: 5000, env: { PATH: process.env.PATH, SUPABASE_URL: "https://icdtinbmtvzhswrrzjxq.supabase.co" } };
  const help = spawnSync(process.execPath, [fileURLToPath(cli), "--help"], options);
  assert.equal(help.status, 0); assert.equal(help.stderr, ""); assert.match(help.stdout, /exact already queued\/signed/);
  const invalid = spawnSync(process.execPath, [fileURLToPath(cli), "run", "--private-key", "synthetic"], options);
  assert.equal(invalid.status, 1); assert.equal(invalid.stdout, ""); assert.equal(invalid.stderr, "reward_programme_operator_command_failed\n");
  assert.equal(programmeOperatorExitCodeV3(undefined), 0);
  assert.equal(programmeOperatorExitCodeV3({ stop: "jobs_confirmed", requestedJobs: 1, entries: [{ outcome: "confirmed" }] }), 0);
  for (const result of [{ stop: "jobs_confirmed", requestedJobs: 2, entries: [{ outcome: "confirmed" }] },
    { stop: "jobs_confirmed", requestedJobs: 1, entries: [{ outcome: "submitted" }] }, { stop: "jobs_confirmed", requestedJobs: 0, entries: [] },
    ...["deferred", "attention_required", "unavailable", "stopped"].map(stop => ({ stop, requestedJobs: 1, entries: [] }))])
    assert.equal(programmeOperatorExitCodeV3(result), 2);
});

test("V3 actual CLI rejects unreviewed source before reading credentials or using inherited production environment", t => {
  const directory = mkdtempSync(join(tmpdir(), "raceson-v3-operator-cli-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "non-secret-config.json"); writeFileSync(path, JSON.stringify(config()));
  for (const args of [["plan", "--config", path], ["run", "--config", path, "--confirm-plan", "b".repeat(64)]]) {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL("../../../demo/rewards/scripts/programme-operator-v3.mjs", import.meta.url)), ...args], {
      encoding: "utf8", timeout: 5000, input: "synthetic-secret-sentinel",
      env: { PATH: process.env.PATH, SUPABASE_URL: "https://icdtinbmtvzhswrrzjxq.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "synthetic-secret-sentinel" },
    });
    assert.equal(result.status, 1); assert.equal(result.stdout, ""); assert.equal(result.stderr, "reward_programme_operator_command_failed\n");
  }
});
