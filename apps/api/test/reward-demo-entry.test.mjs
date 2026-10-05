import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const origin = "https://reward-demo.invalid";
const database = "https://abcdefghijklmnopqrst.supabase.co";
const environment = {
  NODE_ENV: "production", APP_BASE_URL: origin, SUPABASE_URL: database,
  SUPABASE_ANON_KEY: "synthetic-anon-key", SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-key",
  RACESON_REWARD_PORTAL_MODE: "testnet", RACESON_REWARD_DEMO_ORIGIN: origin,
  RACESON_REWARD_DEMO_SUPABASE_URL: database, NEXT_PUBLIC_RACESON_REWARDS_ENABLED: "true",
};
const routes = [
  ["GET", "/api/v1/organizer/rewards/programme-creation"],
  ["POST", "/api/v1/organizer/rewards/programme-creation"],
  ["GET", "/api/v1/rewards/test-programmes"],
  ["GET", "/api/v1/rewards/test-programmes/72000000-0000-4000-8000-000000000001"],
  ["PATCH", "/api/v1/rewards/test-programmes/72000000-0000-4000-8000-000000000001"],
  ["GET", "/api/v1/organizer/rewards/uploads/82000000-0000-4000-8000-000000000001/club-awards-v3"],
  ["GET", "/api/v1/club/rewards/clubs/82000000-0000-4000-8000-000000000001/allocations-v3"],
  ...["GET", "POST"].map(method => [method, `/api/v1/organizer/rewards/uploads/82000000-0000-4000-8000-000000000001/club-treasuries/82000000-0000-4000-8000-000000000002/awards/0x${"a".repeat(64)}/claims/82000000-0000-4000-8000-000000000003/payment-actions/82000000-0000-4000-8000-000000000004`]),
  ...["club", "organizer"].map(role => ["GET", `/api/v1/${role}/rewards/uploads/82000000-0000-4000-8000-000000000001/club-treasuries/82000000-0000-4000-8000-000000000002/awards/0x${"a".repeat(64)}/claims/82000000-0000-4000-8000-000000000003/payment`]),
  ...[5, 6].flatMap(slot => ["GET", "POST"].map(method => [method, `/api/v1/organizer/rewards/drafts/82000000-0000-4000-8000-000000000001/final-publication/${slot}/82000000-0000-4000-8000-000000000002/82000000-0000-4000-8000-000000000003`])),
  ...[5, 6].flatMap(slot => ["GET", "POST"].map(method => [method, `/api/v1/organizer/rewards/drafts/82000000-0000-4000-8000-000000000001/final-allocation-actions/${slot}/82000000-0000-4000-8000-000000000002/82000000-0000-4000-8000-000000000003`])),
  ...[5, 6].map(slot => ["GET", `/api/v1/organizer/rewards/drafts/82000000-0000-4000-8000-000000000001/final-allocation-execution/${slot}/82000000-0000-4000-8000-000000000002/82000000-0000-4000-8000-000000000003`]),
  ...[5, 6].flatMap(slot => ["GET", "POST"].flatMap(method => [
    [method, `/api/v1/organizer/rewards/drafts/82000000-0000-4000-8000-000000000001/final-allocation-approval/${slot}`],
    [method, `/api/v1/organizer/rewards/drafts/82000000-0000-4000-8000-000000000001/final-allocation-upload/${slot}/82000000-0000-4000-8000-000000000002`],
  ])),
  ...[5, 6].map(slot => ["GET", `/api/v1/organizer/rewards/drafts/82000000-0000-4000-8000-000000000001/final-allocation/${slot}`]),
  ...["GET", "POST"].map(method => [method, "/api/v1/organizer/rewards/drafts/82000000-0000-4000-8000-000000000001/league-publication"]),
  ...["GET", "POST"].map(method => [method, `/api/v1/organizer/rewards/uploads/82000000-0000-4000-8000-000000000001/destinations/82000000-0000-4000-8000-000000000002/awards/0x${"a".repeat(64)}/claims/82000000-0000-4000-8000-000000000003/payment-actions/82000000-0000-4000-8000-000000000004`]),
  ["POST", "/api/v1/organizer/rewards/drafts/82000000-0000-4000-8000-000000000005/deposit-review"],
  ["POST", "/api/v1/organizer/rewards/drafts/82000000-0000-4000-8000-000000000005/deposit-status"],
  ["GET", "/api/v1/organizer/rewards/drafts/82000000-0000-4000-8000-000000000005/funding-approval"],
  ["POST", "/api/v1/organizer/rewards/drafts/82000000-0000-4000-8000-000000000005/funding-approval"],
  ["GET", "/api/v1/organizer/rewards/result-review/82000000-0000-4000-8000-000000000005"],
  ["PATCH", "/api/v1/organizer/rewards/result-review/82000000-0000-4000-8000-000000000005"],
  ["GET", "/api/v1/organizer/rewards/drafts"],
  ["GET", "/api/v1/organizer/rewards/drafts/82000000-0000-4000-8000-000000000005/funding"],
  ["GET", "/api/v1/organizer/rewards/drafts/82000000-0000-4000-8000-000000000005"],
  ["PATCH", "/api/v1/organizer/rewards/drafts/82000000-0000-4000-8000-000000000005"],
  ["POST", "/api/v1/organizer/rewards/programmes/79000000-0000-4000-8000-000000000001/club-claims"],
  ["GET", "/api/v1/organizer/rewards/programmes/79000000-0000-4000-8000-000000000001/club-claims/79000000-0000-4000-8000-000000000003/approval"],
  ["POST", "/api/v1/organizer/rewards/programmes/79000000-0000-4000-8000-000000000001/club-claims/79000000-0000-4000-8000-000000000003/approval"],
  ["GET", "/api/v1/athlete/rewards/club-claims/79000000-0000-4000-8000-000000000003/consent"],
  ["POST", "/api/v1/athlete/rewards/club-claims/79000000-0000-4000-8000-000000000003/consent"],
  ["POST", "/api/v1/athlete/rewards/club-treasury-requests"],
  ["GET", "/api/v1/athlete/rewards/club-treasury-requests"],
  ["GET", "/api/v1/athlete/rewards/owned-clubs"],
  ["GET", "/api/v1/athlete/rewards/club-treasury-requests/79000000-0000-4000-8000-000000000003"],
  ["POST", "/api/v1/athlete/rewards/club-treasury-requests/79000000-0000-4000-8000-000000000003/withdraw"],
  ["GET", "/api/v1/organizer/rewards/programmes"],
  ["GET", "/api/v1/organizer/rewards/programmes/79000000-0000-4000-8000-000000000001/destinations"],
  ["GET", "/api/v1/athlete/rewards/allocations"],
  ["POST", "/api/v1/athlete/rewards/wallet-challenges"],
  ["POST", "/api/v1/athlete/rewards/wallet-proofs"],
  ["POST", "/api/v1/athlete/rewards/destination-requests"],
  ["GET", "/api/v1/athlete/rewards/destination-requests"],
  ["GET", "/api/v1/athlete/rewards/destination-requests/79000000-0000-4000-8000-000000000003"],
  ["POST", "/api/v1/athlete/rewards/destination-requests/79000000-0000-4000-8000-000000000003/withdraw"],
  ["GET", "/api/v1/athlete/rewards/claims"],
  ["GET", "/api/v1/athlete/rewards/claims/79000000-0000-4000-8000-000000000003"],
  ["POST", "/api/v1/athlete/rewards/claims/79000000-0000-4000-8000-000000000003/consent"],
  ["GET", "/api/v1/athlete/rewards/claims/79000000-0000-4000-8000-000000000003/payment"],
  ["GET", "/api/v1/organizer/rewards/programmes/79000000-0000-4000-8000-000000000001/destinations/79000000-0000-4000-8000-000000000002/readiness"],
  ["POST", "/api/v1/organizer/rewards/programmes/79000000-0000-4000-8000-000000000001/destinations/79000000-0000-4000-8000-000000000002/readiness"],
  ["POST", "/api/v1/organizer/rewards/programmes/79000000-0000-4000-8000-000000000001/destinations/79000000-0000-4000-8000-000000000002/readiness/79000000-0000-4000-8000-000000000003/revoke"],
];

// A fresh child avoids the ordinary server's process-lifetime environment cache.
// Only explicit synthetic environment values enter it; no .env or provider calls.
function requests({ demo = true, env = environment, cases }) {
  const entry = new URL(demo ? "../dist/rewards-demo.js" : "../dist/server.js", import.meta.url).href;
  const name = demo ? "handleRewardDemoApiRequest" : "handleApiRequest";
  const source = `
    import { Readable } from "node:stream";
    let networkCalls = 0;
    globalThis.fetch = async () => { networkCalls++; throw new Error("Unexpected provider request"); };
    const { ${name}: handle } = await import(${JSON.stringify(entry)});
    const replies = [];
    for (const input of ${JSON.stringify(cases)}) {
      for (const [key, value] of Object.entries(input.patch ?? {})) {
        if (value === null) delete process.env[key]; else process.env[key] = value;
      }
      const req = Object.assign(Readable.from([]), {
        method: input.method ?? "GET", url: input.url,
        headers: { host: "reward-demo.invalid", ...input.headers },
        socket: { remoteAddress: "127.0.0.1" },
      });
      const res = { statusCode: 200, headers: {}, body: null,
        setHeader(key, value) { this.headers[key.toLowerCase()] = value; },
        end(body) { this.body = body ? JSON.parse(String(body)) : null; },
      };
      await handle(req, res);
      replies.push({ status: res.statusCode, headers: res.headers, body: res.body });
    }
    console.log(JSON.stringify({ replies, networkCalls }));
  `;
  const child = spawnSync(process.execPath, ["--input-type=module", "--eval", source], {
    cwd: root, env, encoding: "utf8", timeout: 20_000, maxBuffer: 1024 * 1024,
  });
  assert.ifError(child.error);
  assert.equal(child.status, 0, child.stderr);
  const result = JSON.parse(child.stdout.trim());
  assert.equal(result.networkCalls, 0, "entry-point guards must not call a provider");
  assert.doesNotMatch(JSON.stringify(result), /synthetic-service-key|synthetic-anon-key/);
  return result.replies;
}

function applicationImports(entry) {
  const seen = new Set();
  const pending = [fileURLToPath(entry)];
  while (pending.length) {
    const filename = realpathSync(pending.pop());
    if (seen.has(filename)) continue;
    seen.add(filename);
    const source = ts.createSourceFile(filename, readFileSync(filename, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const resolve = createRequire(filename).resolve;
    function visit(node) {
      let specifier;
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) specifier = node.moduleSpecifier;
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        specifier = node.arguments[0];
        assert.ok(specifier && ts.isStringLiteral(specifier), `Unreviewed dynamic import in ${relative(root, filename)}`);
      }
      if (specifier && ts.isStringLiteral(specifier) && /^(\.|@raceson\/)/.test(specifier.text)) {
        pending.push(resolve(specifier.text));
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  return [...seen].map((filename) => relative(root, filename));
}

test("public reward report is absent from the ordinary API and requires an explicit demo host report", () => {
  const cases = [{ method: "GET", url: "/api/v1/rewards/public-report" }];
  assert.equal(requests({ demo: false, cases })[0].status, 404);
  const demo = requests({ cases })[0];
  assert.equal(demo.status, 503);
  assert.equal(demo.body.error.code, "public_reward_report_unavailable");
});

test("ordinary database exports exclude rewards; demo persistence has an explicit subpath", async () => {
  const portal = await import("@raceson/db");
  const rewards = await import("@raceson/db/rewards");
  assert.equal(typeof portal.loadServerEnv, "function");
  assert.ok(Object.keys(rewards).length > 20, "reward repositories must remain available to the demo");
  assert.deepEqual(Object.keys(portal).filter((key) => /reward/i.test(key)), []);
});

test("compiled ordinary API imports no reward routes, repositories or chain implementation", () => {
  const portal = applicationImports(new URL("../dist/server.js", import.meta.url));
  const demo = applicationImports(new URL("../dist/rewards-demo.js", import.meta.url));
  const rewardModule = /^(apps\/api\/dist\/(features\/rewards\/|routes\/rewards\/|rewards-demo\.js)|packages\/db\/dist\/rewards\/|packages\/rewards-chain\/)/;
  assert.ok(portal.length > 10, "traverse the actual core application graph");
  assert.deepEqual(portal.filter((path) => rewardModule.test(path)), []);
  assert.ok(demo.some((path) => path === "apps/api/dist/routes/rewards/athlete.js"));
  assert.ok(demo.some((path) => path === "apps/api/dist/routes/rewards/clubs.js"));
  assert.ok(demo.some((path) => path === "packages/db/dist/rewards/index.js"));
});

test("ordinary API never registers reward endpoints, even with valid enabled demo flags", () => {
  const replies = requests({ demo: false, cases: [...routes, ["GET", "/api/v1/rewards/canary"], ["GET", "/api/v1/rewards/canary/final-results"]].map(([method, url]) => ({ method, url })) });
  for (const reply of replies) {
    assert.equal(reply.status, 404);
    assert.equal(reply.body.error.code, "not_found");
  }
});

test("demo fails closed on health and core requests when no demo configuration was supplied", () => {
  const env = {
    NODE_ENV: "production", APP_BASE_URL: "https://www.raceson.com",
    SUPABASE_URL: "https://icdtinbmtvzhswrrzjxq.supabase.co",
    SUPABASE_ANON_KEY: "synthetic-anon-key", SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-key",
  };
  const replies = requests({ env, cases: ["/api/health", "/api/v1/session", routes[0][1]].map((url) => ({ url })) });
  for (const reply of replies) {
    assert.equal(reply.status, 503);
    assert.equal(reply.body.error.code, "reward_demo_configuration_required");
    assert.equal(reply.headers["cache-control"], "no-store");
  }
});

test("demo rejects production targets, disabled mode and configuration drift after a valid request", () => {
  const patches = [
    { RACESON_REWARD_PORTAL_MODE: "disabled" },
    { RACESON_REWARD_PORTAL_MODE: "mainnet" },
    { APP_BASE_URL: "https://www.raceson.com", RACESON_REWARD_DEMO_ORIGIN: "https://www.raceson.com" },
    { SUPABASE_URL: "https://icdtinbmtvzhswrrzjxq.supabase.co", RACESON_REWARD_DEMO_SUPABASE_URL: "https://icdtinbmtvzhswrrzjxq.supabase.co" },
    { SUPABASE_URL: "https://zyxwvutsrqponmlkjihg.supabase.co" },
    { API_CORS_ORIGIN: "https://www.raceson.com" },
    { STRIPE_SECRET_KEY: "synthetic-service-key" },
  ];
  const replies = requests({ cases: [
    { url: "/api/health" },
    ...patches.map((patch) => ({ url: "/api/health", patch: { ...environment, API_CORS_ORIGIN: null, STRIPE_SECRET_KEY: null, ...patch } })),
  ] });
  assert.equal(replies[0].status, 200);
  for (const reply of replies.slice(1)) {
    assert.equal(reply.status, 503);
    assert.equal(reply.body.error.code, "reward_demo_configuration_required");
  }
});

test("configured demo mounts rewards with existing private authentication and cookie-origin checks", () => {
  const replies = requests({ cases: [
    { url: "/api/health" },
    ...routes.map(([method, url]) => ({ method, url })),
    { method: "POST", url: "/api/v1/athlete/rewards/wallet-challenges", headers: { cookie: "trail_alt_access_v1=synthetic-token", origin: "https://www.raceson.com" } },
  ] });
  assert.equal(replies[0].status, 200);
  for (const reply of replies.slice(1, -1)) {
    assert.equal(reply.status, 401);
    assert.equal(reply.body.error.code, "reward_auth_required");
    assert.equal(reply.headers["cache-control"], "private, no-store");
  }
  assert.equal(replies.at(-1).status, 403);
  assert.equal(replies.at(-1).body.error.code, "forbidden");
});

test("separate demo entry retains the normal read-only mutation guard", () => {
  const replies = requests({ env: { ...environment, RACESON_READ_ONLY: "true" },
    cases: routes.filter(([method]) => method !== "GET").map(([method, url]) => ({ method, url })),
  });
  for (const reply of replies) {
    assert.equal(reply.status, 403);
    assert.equal(reply.body.error.code, "read_only_deployment");
  }
});

test("organizer demo reads and writes retain cookie-origin checks before authentication or private IO", () => {
  const replies = requests({ cases: routes.filter(([,url]) => url.includes("/organizer/")).map(([method,url]) => ({
    method,url,headers:{cookie:"trail_alt_access_v1=synthetic-token",origin:"https://www.raceson.com"},
  })) });
  assert.equal(replies.length,48);
  for (const reply of replies) { assert.equal(reply.status,403);assert.equal(reply.body.error.code,"forbidden"); }
});
