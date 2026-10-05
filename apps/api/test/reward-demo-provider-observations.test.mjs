import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEMO_SUPABASE_ORGANIZATION, DEMO_VERCEL_TEAM } from "../../../demo/rewards/scripts/release-manifest.mjs";
import { repositoryDirectory } from "../../../demo/rewards/scripts/release-source.mjs";
import { observeDemoProviders } from "../../../demo/rewards/scripts/provider-observations.mjs";
import { readProviderJson } from "../../../demo/rewards/scripts/provider-http.mjs";
import { main } from "../../../demo/rewards/scripts/observe-providers.mjs";

const digest = "f".repeat(64);
const vercelToken = "VERCEL_READ_SYNTHETIC_ONLY";
const supabaseToken = "SUPABASE_READ_SYNTHETIC_ONLY";
const started = Date.parse("2026-09-08T15:00:00Z");
const cli = fileURLToPath(new URL("../../../demo/rewards/scripts/observe-providers.mjs", import.meta.url));
function fixture() {
  const manifest = {
    formatVersion: 1, kind: "raceson-rewards-testnet", repository: "infobitctrl/raceson-podium",
    sourceCommit: "a".repeat(40), chainId: 10143, origin: "https://rewards-demo.example.invalid",
    vercel: { teamId: DEMO_VERCEL_TEAM, projectId: "prj_DemoFixtureOnly", environment: "production", rootDirectory: "demo/rewards/web" },
    supabase: { organizationId: DEMO_SUPABASE_ORGANIZATION, projectRef: "abcdefghijklmnopqrst" },
  };
  const projectUrl = `https://api.vercel.com/v9/projects/${manifest.vercel.projectId}`;
  const team = `?teamId=${manifest.vercel.teamId}`;
  const databaseUrl = `https://api.supabase.com/v1/projects/${manifest.supabase.projectRef}`;
  const urls = [`${projectUrl}${team}`, databaseUrl,
    `${projectUrl}/domains/rewards-demo.example.invalid${team}`, `${databaseUrl}/config/auth`];
  const bodies = [
    { id: manifest.vercel.projectId, accountId: manifest.vercel.teamId, rootDirectory: "demo/rewards/web",
      framework: "nextjs", nodeVersion: "22.x", commandForIgnoringBuildStep: null,
      buildCommand: null, installCommand: null, outputDirectory: null, link: null,
      env: [{ key: "SYNTHETIC_ONLY", value: "NEVER_RETURN_PRIVATE_VERIFICATION_SENTINEL" }] },
    { id: "opaque-project-id-not-the-ref", ref: manifest.supabase.projectRef, organization_id: manifest.supabase.organizationId,
      region: "eu-central-1", status: "ACTIVE_HEALTHY", database: { version: "17.6.1.069", host: "never-contact.example.invalid" } },
    { name: "rewards-demo.example.invalid", projectId: manifest.vercel.projectId, verified: true,
      redirect: null, gitBranch: null, customEnvironmentId: null },
    { site_url: manifest.origin, uri_allow_list: `${manifest.origin}/auth?*, ${manifest.origin}/auth/reset,${manifest.origin}/athlete/account?*`,
      mailer_autoconfirm: false, mailer_allow_unverified_email_sign_ins: false, external_email_enabled: true,
      external_anonymous_users_enabled: false, mailer_secure_email_change_enabled: false, disable_signup: true,
      smtp_pass: "NEVER_RETURN_PRIVATE_VERIFICATION_SENTINEL", external_google_secret: "NEVER_RETURN_PRIVATE_VERIFICATION_SENTINEL" },
  ];
  const requests = [];
  const options = {
    expectedPlanDigest: digest, vercelReadToken: vercelToken, supabaseReadToken: supabaseToken,
    readSource: () => ({ planDigest: digest }), now: () => started,
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      const index = urls.indexOf(url);
      assert.notEqual(index, -1, "only the four declared metadata URLs are requested");
      return response(url, JSON.stringify(bodies[index]));
    },
  };
  return { manifest, options, requests, bodies, urls };
}
function response(url, body, options = {}) {
  const result = new Response(body, { status: options.status ?? 200, headers: { "content-type": "application/json", ...options.headers } });
  Object.defineProperty(result, "url", { value: options.url ?? url });
  Object.defineProperty(result, "redirected", { value: options.redirected ?? false });
  return result;
}

test("provider observation binds an exact plan and returns only non-secret metadata after four GETs", async () => {
  const f = fixture();
  const result = await observeDemoProviders(f.manifest, f.options);
  assert.equal(result.status, "observed_not_approved");
  assert.equal(result.planDigest, digest); assert.equal(result.sourceCommit, f.manifest.sourceCommit);
  assert.equal(result.startedAt, "2026-09-08T15:00:00.000Z");
  assert.equal(result.reviewBefore, "2026-09-08T15:05:00.000Z");
  assert.equal(result.httpReads, 4); assert.equal(result.remoteMutationsPerformed, false);
  for (const key of ["credentialsProvenanceVerified", "deployedArtifactVerified", "releaseAuthorized"]) assert.equal(result[key], false);
  assert.equal(result.configuration.supabase.projectRef, f.manifest.supabase.projectRef);
  assert.equal(result.configuration.vercel.linkedRepository, null);
  assert.deepEqual(result.configuration.auth.redirectPaths, ["/athlete/account?*", "/auth/reset", "/auth?*"]);
  assert.doesNotMatch(JSON.stringify(result), /NEVER_RETURN|READ_SYNTHETIC|smtp_pass|external_google_secret|opaque-project-id/);
  assert.deepEqual(f.requests.map(({ url }) => url), f.urls);
  for (const { url, init } of f.requests) {
    assert.equal(init.method, "GET"); assert.equal(init.redirect, "error");
    assert.equal(init.cache, "no-store"); assert.equal(init.credentials, "omit");
    assert.equal(init.body, undefined); assert.ok(init.signal instanceof AbortSignal);
    assert.equal(init.headers.Authorization, `Bearer ${url.startsWith("https://api.vercel.com/") ? vercelToken : supabaseToken}`);
    assert.equal(init.headers.Cookie, undefined);
  }
});

test("invalid targets, tokens, source and expected plan fail before any provider request", async () => {
  for (const mutate of [
    f => { f.manifest.vercel.projectId = "prj_fs6FD31qnADjsnDajAI5mypY3uSY"; },
    f => { f.manifest.origin = "https://www.raceson.com"; },
    f => { f.manifest.origin = "https://*.raceson.com"; },
    f => { f.manifest.origin = "https://a..invalid"; },
    f => { f.manifest.supabase.projectRef = "icdtinbmtvzhswrrzjxq"; },
    f => { f.options.expectedPlanDigest = "HEAD"; },
    f => { f.options.expectedPlanDigest = "e".repeat(64); },
    f => { f.options.vercelReadToken = undefined; },
    f => { f.options.supabaseReadToken = "invalid\r\nheader-value"; },
    f => { f.options.supabaseReadToken = vercelToken; },
    f => { f.options.readSource = () => { throw new Error("reward_demo_release_source_unavailable"); }; },
    f => { f.options.now = () => 0; },
  ]) {
    const f = fixture(); mutate(f);
    await assert.rejects(observeDemoProviders(f.manifest, f.options), /^Error: reward_demo_/);
    assert.equal(f.requests.length, 0);
  }
});

test("project mismatches stop before reading domain or Auth configuration", async () => {
  for (const [index, patch] of [
    [0, { id: "prj_fs6FD31qnADjsnDajAI5mypY3uSY" }], [0, { accountId: "team_another_owner" }],
    [0, { rootDirectory: "apps/web" }], [0, { framework: null }], [0, { nodeVersion: "20.x" }],
    [0, { commandForIgnoringBuildStep: "exit 0" }], [0, { buildCommand: "npm --workspace apps/web run build" }],
    [0, { installCommand: "echo skipped" }], [0, { outputDirectory: "../../apps/web/.next-build" }],
    [0, { link: { type: "github", org: "lukaViPR", repo: "sitrail.com" } }],
    [1, { ref: "icdtinbmtvzhswrrzjxq" }], [1, { ref: undefined, id: "abcdefghijklmnopqrst" }],
    [1, { organization_id: "another-org" }], [1, { status: "INACTIVE" }],
    [1, { database: { version: "15.8" } }], [1, { region: "private values must not be echoed" }],
  ]) {
    const f = fixture(); Object.assign(f.bodies[index], patch);
    await assert.rejects(observeDemoProviders(f.manifest, f.options), /observation_(?:vercel|supabase)_/);
    assert.equal(f.requests.length, 2);
  }
});

test("domain must be verified on the expected project without redirects or another environment binding", async () => {
  for (const patch of [{ name: "www.raceson.com" }, { projectId: "prj_fs6FD31qnADjsnDajAI5mypY3uSY" },
    { verified: false }, { redirect: "www.raceson.com" }, { gitBranch: "main" },
    { customEnvironmentId: "env_another" }, { target: "preview" }]) {
    const f = fixture(); Object.assign(f.bodies[2], patch);
    await assert.rejects(observeDemoProviders(f.manifest, f.options), /domain_mismatch/);
  }
});

test("Auth configuration rejects live/cross-host redirects and preserves confirmation/security boundaries", async () => {
  for (const patch of [{ site_url: "https://www.raceson.com" }, { mailer_autoconfirm: true },
    { mailer_allow_unverified_email_sign_ins: true }, { external_email_enabled: false },
    { external_anonymous_users_enabled: true }, { mailer_secure_email_change_enabled: true },
    { disable_signup: undefined }, { uri_allow_list: null },
    ...["https://www.raceson.com/auth", "https://*.raceson.com/**", "https://rewards-demo.example.invalid.evil.invalid/auth",
      "https://rewards-demo.example.invalid./auth", "https://rewards-demo.example.invalid/auth?token=NEVER_RETURN_PRIVATE_VERIFICATION_SENTINEL",
      "https://rewards-demo.example.invalid/auth,,https://rewards-demo.example.invalid/auth/reset"].map(uri_allow_list => ({ uri_allow_list }))]) {
    const f = fixture(); Object.assign(f.bodies[3], patch);
    await assert.rejects(observeDemoProviders(f.manifest, f.options), /auth_(configuration|redirect)_mismatch/);
  }
});

test("same-origin path globs and explicit package build/linked repository produce bounded observations", async () => {
  const f = fixture();
  Object.assign(f.bodies[0], { buildCommand: "npm run build", installCommand: "npm ci", link: { type: "github", org: "infobitctrl", repo: "raceson-podium" } });
  Object.assign(f.bodies[3], { uri_allow_list: `${f.manifest.origin}/**`, disable_signup: false });
  const result = await observeDemoProviders(f.manifest, f.options);
  assert.equal(result.configuration.vercel.linkedRepository, f.manifest.repository);
  assert.deepEqual(result.configuration.auth.redirectPaths, ["/**"]);
  assert.equal(result.configuration.auth.signupDisabled, false);
  assert.equal(result.releaseAuthorized, false);
});

test("manifest mutation during observation cannot switch the already validated provider targets", async () => {
  const f = fixture(); const nativeFixtureFetch = f.options.fetchImpl;
  f.options.fetchImpl = (...args) => {
    f.manifest.origin = "https://www.raceson.com";
    f.manifest.supabase.projectRef = "icdtinbmtvzhswrrzjxq";
    return nativeFixtureFetch(...args);
  };
  const result = await observeDemoProviders(f.manifest, f.options);
  assert.equal(result.configuration.auth.siteOrigin, "https://rewards-demo.example.invalid");
  assert.deepEqual(f.requests.map(({ url }) => url), f.urls);
});

test("an observation is rejected if the collection clock goes backwards or spans over one minute", async () => {
  for (const completed of [started - 1, started + 60_001, Number.NaN]) {
    const f = fixture(); let calls = 0;
    f.options.now = () => calls++ === 0 ? started : completed;
    await assert.rejects(observeDemoProviders(f.manifest, f.options), /clock_invalid/);
  }
});

test("HTTP reader refuses redirects, failures, malformed JSON and unexpected hosts without echoing response data", async () => {
  const url = "https://api.vercel.com/v9/projects/prj_DemoFixtureOnly";
  for (const build of [
    () => response(url, "NEVER_RETURN_PRIVATE_VERIFICATION_SENTINEL", { status: 403 }),
    () => response(url, "{}", { status: 302 }),
    () => response(url, "{}", { redirected: true }),
    () => response(url, "{}", { url: "https://api.supabase.com/v1/projects/another" }),
    () => response(url, "{NEVER_RETURN_PRIVATE_VERIFICATION_SENTINEL"),
    () => response(url, "[]"), () => response(url, "null"),
    () => response(url, "{}", { headers: { "content-type": "text/html" } }),
    () => { throw new Error("reward_demo_observation_never_return_private_verification_sentinel"); },
  ]) {
    await assert.rejects(readProviderJson(url, vercelToken, { fetchImpl: async () => build() }), error => {
      assert.match(error.message, /^reward_demo_observation_(http_failed|response_invalid)$/);
      assert.doesNotMatch(error.message, /sentinel/i); return true;
    });
  }
  for (const invalidUrl of ["https://www.raceson.com/", "invalid-NEVER_RETURN_PRIVATE_VERIFICATION_SENTINEL",
    "https://api.vercel.com.evil.invalid/", "https://user:password@api.vercel.com/", `${url}#fragment`]) {
    let called = false;
    await assert.rejects(readProviderJson(invalidUrl, vercelToken, { fetchImpl: () => { called = true; } }), error => {
      assert.equal(error.message, "reward_demo_observation_request_invalid");
      assert.equal(error.input, undefined); return true;
    });
    assert.equal(called, false);
  }
});

test("HTTP reader enforces response byte limits and times out headers or a stalled body", async () => {
  const url = "https://api.supabase.com/v1/projects/abcdefghijklmnopqrst";
  for (const body of [response(url, "{}", { headers: { "content-length": "1048577" } }), response(url, "x".repeat(1048577))]) {
    await assert.rejects(readProviderJson(url, supabaseToken, { fetchImpl: async () => body }), /response_too_large/);
  }
  await assert.rejects(readProviderJson(url, supabaseToken, { timeoutMs: 10, fetchImpl: () => new Promise(() => {}) }), /timeout/);
  let cancelled = false;
  const body = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{"waiting":')); }, cancel() { cancelled = true; } });
  await assert.rejects(readProviderJson(url, supabaseToken, { timeoutMs: 10, fetchImpl: async () => response(url, body) }), /timeout/);
  assert.equal(cancelled, true);
});

test("provider CLI uses only explicitly named read tokens and never falls back to generic credentials", async t => {
  const parent = join(repositoryDirectory, "tmp"); mkdirSync(parent, { recursive: true });
  const directory = mkdtempSync(join(parent, "reward-provider-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const filename = join(directory, "manifest.json");
  const f = fixture(); writeFileSync(filename, JSON.stringify(f.manifest), { mode: 0o600 });
  const output = [];
  await main(["--plan-digest", digest, "--manifest", filename], {
    env: { RACESON_REWARD_DEMO_VERCEL_READ_TOKEN: vercelToken, RACESON_REWARD_DEMO_SUPABASE_READ_TOKEN: supabaseToken,
      VERCEL_TOKEN: "NEVER_RETURN_GENERIC_SENTINEL", SUPABASE_ACCESS_TOKEN: "NEVER_RETURN_GENERIC_SENTINEL" },
    observe: async (value, options) => {
      assert.deepEqual(value, f.manifest);
      assert.deepEqual(options, { expectedPlanDigest: digest, vercelReadToken: vercelToken, supabaseReadToken: supabaseToken });
      return { status: "synthetic-observation-only" };
    }, log: value => output.push(value),
  });
  assert.deepEqual(output, ['{\n  "status": "synthetic-observation-only"\n}']);
  const result = spawnSync(process.execPath, [cli, "--manifest", filename, "--plan-digest", digest], {
    encoding: "utf8", timeout: 15_000, env: { ...process.env,
      RACESON_REWARD_DEMO_VERCEL_READ_TOKEN: "", RACESON_REWARD_DEMO_SUPABASE_READ_TOKEN: "",
      VERCEL_TOKEN: "NEVER_RETURN_GENERIC_SENTINEL", SUPABASE_ACCESS_TOKEN: "NEVER_RETURN_GENERIC_SENTINEL" },
  });
  assert.equal(result.status, 1); assert.equal(result.stdout, "");
  assert.equal(result.stderr, "reward_demo_observation_read_tokens_required\n");
  await assert.rejects(main(["--manifest", filename, "--token", "NEVER_RETURN_GENERIC_SENTINEL"]), /usage/);
  const help = spawnSync(process.execPath, [cli, "--help"], { encoding: "utf8", timeout: 15_000 });
  assert.equal(help.status, 0); assert.match(help.stdout, /no remote changes or release approval/);
});
