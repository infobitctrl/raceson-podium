import assert from "node:assert/strict";
import test from "node:test";
import { loadServerEnv } from "../../../packages/db/dist/env.js";
import { handleApiRequest } from "../dist/server.js";

const origin = "https://reward-demo.invalid";
const database = "https://abcdefghijklmnopqrst.supabase.co";
const environment = {
  NODE_ENV: "production", APP_BASE_URL: origin, SUPABASE_URL: database,
  SUPABASE_ANON_KEY: "synthetic-anon-key", SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-key",
  RACESON_REWARD_PORTAL_MODE: "testnet", RACESON_REWARD_DEMO_ORIGIN: origin,
  RACESON_REWARD_DEMO_SUPABASE_URL: database,
};

test("normal server environment loading enforces demo targets before creating any database client", () => {
  assert.equal(loadServerEnv(environment).supabaseUrl, database);
  for (const patch of [
    { SUPABASE_URL: "https://icdtinbmtvzhswrrzjxq.supabase.co" }, { APP_BASE_URL: "https://www.raceson.com" },
    { API_CORS_ORIGIN: "https://www.raceson.com" }, { RACESON_REWARD_PORTAL_MODE: undefined },
    { RACESON_REWARD_PORTAL_MODE: "disabled" }, { NEXT_PUBLIC_RACESON_REWARD_PORTAL_MODE: "local" },
    { STRIPE_SECRET_KEY: "synthetic-sensitive-value" }, { STRIPE_WEBHOOK_SECRET: "synthetic-sensitive-value" },
    { STRAVA_CLIENT_ID: "synthetic-sensitive-value" }, { STRAVA_CLIENT_SECRET: "synthetic-sensitive-value" },
    { STRAVA_TOKEN_ENCRYPTION_KEY: "synthetic-sensitive-value" },
  ]) assert.throws(() => loadServerEnv({ ...environment, ...patch }), /^Error: reward_demo_configuration_required$/);
});

test("normal production configuration does not become a demo and keeps its existing integrations", () => {
  const portal = { ...environment, APP_BASE_URL: "https://www.raceson.com", SUPABASE_URL: "https://icdtinbmtvzhswrrzjxq.supabase.co",
    RACESON_REWARD_PORTAL_MODE: undefined, RACESON_REWARD_DEMO_ORIGIN: undefined, RACESON_REWARD_DEMO_SUPABASE_URL: undefined,
    STRIPE_SECRET_KEY: "synthetic-existing-key" };
  assert.equal(loadServerEnv(portal).stripeSecretKey, "synthetic-existing-key");
  assert.throws(() => loadServerEnv({ ...portal, NEXT_PUBLIC_RACESON_REWARDS_ENABLED: "true" }), /reward_demo_configuration_required/);
});

test("local-testnet cannot run as a production server or mix remote database credentials",()=>{
  const local={...environment,NODE_ENV:"development",RACESON_REWARD_PORTAL_MODE:"local-testnet",
    APP_BASE_URL:"http://127.0.0.1:3102",RACESON_REWARD_DEMO_ORIGIN:"http://127.0.0.1:3102",
    SUPABASE_URL:"http://127.0.0.1:55321",RACESON_REWARD_DEMO_SUPABASE_URL:"http://127.0.0.1:55321"};
  assert.equal(loadServerEnv(local).supabaseUrl,local.SUPABASE_URL);
  for(const patch of [{NODE_ENV:"production"},{SUPABASE_URL:database},{NEXT_PUBLIC_RACESON_REWARD_PORTAL_MODE:"local"}])
    assert.throws(()=>loadServerEnv({...local,...patch}),/reward_demo_configuration_required/);
});

test("a non-reward API request cannot use production data through a misconfigured demo", async () => {
  const keys = Object.keys(environment);
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const fetchBefore = globalThis.fetch;
  const logBefore = console.error;
  let requests = 0;
  const logs = [];
  try {
    Object.assign(process.env, environment, { SUPABASE_URL: "https://icdtinbmtvzhswrrzjxq.supabase.co" });
    globalThis.fetch = async () => { requests++; throw new Error("Unexpected network request"); };
    console.error = (...args) => logs.push(args.map(String).join(" "));
    let body = "";
    const response = { statusCode: 200, setHeader() {}, end(value) { body = String(value ?? ""); } };
    await handleApiRequest({ method: "GET", url: "/api/v1/public/auth/sign-up-availability", headers: { host: "reward-demo.invalid" } }, response);
    assert.equal(response.statusCode, 500);
    assert.equal(JSON.parse(body).error.code, "internal_error");
    assert.equal(requests, 0);
    assert.ok(logs.some((line) => line.includes("reward_demo_configuration_required")));
    assert.ok(logs.every((line) => !line.includes("synthetic-service-key")));
  } finally {
    globalThis.fetch = fetchBefore; console.error = logBefore;
    for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
  }
});
