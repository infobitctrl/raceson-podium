import assert from "node:assert/strict";
import test from "node:test";
import { dispatchCanaryStatusRoute } from "../dist/routes/rewards/canary.js";
import { CANARY_MANIFEST, contractCanaryPlan as plan } from "@raceson/domain/rewards/canary";
import { canaryStatusConfiguration, localAppEnvironment, database } from "../../../demo/rewards/scripts/local-demo.mjs";
const status = { schema: "raceson-canary-status-v1", chainId: 10143, manifestHash: CANARY_MANIFEST,
  observedBlock: { number: "1", timestamp: "1801000000", hash: `0x${"12".repeat(32)}` },
  wallets: ["funder", "operator", "relayer"].map(role => ({ role, address: plan[role], balanceWei: "0" })), deployment: "absent", contract: null };
async function request({ method = "GET", path = "/api/v1/rewards/canary", config = { chainId: 10143 }, observe = async () => status } = {}) {
  let calls = 0;
  const res = { status: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; } };
  const matched = await dispatchCanaryStatusRoute({ method }, res, new URL(path, "https://demo.invalid"), {
    config: () => config, sendSuccess: (r, data) => { r.data = data; }, sendError: (r, code, error) => { r.status = code; r.error = error; },
  }, async () => { calls++; return observe(); });
  return { matched, ...res, calls };
}
test("public demo canary route exposes only fixed validated metadata, with no session or DB dependency", async () => {
  const result = await request(); assert.equal(result.status, 200); assert.equal(result.matched, true);
  assert.deepEqual(result.data, status); assert.equal(result.headers["Cache-Control"], "no-store"); assert.equal(result.calls, 1);
});
test("canary API rejects mutation, foreign chain, unconfigured demo and caller-selected observations before RPC", async () => {
  for (const [input, expected] of [[{ method: "POST" }, 405], [{ config: null }, 409], [{ config: { chainId: 31337 } }, 409],
    [{ path: "/api/v1/rewards/canary?address=bad" }, 400]]) {
    const result = await request(input); assert.equal(result.status, expected); assert.equal(result.calls, 0);
  }
  assert.equal((await request({ path: "/api/v1/other" })).matched, false);
});
test("unavailable, invalid and rate-limited observations never return stale data or provider errors", async () => {
  for (const observe of [async () => ({ ...status, key: "synthetic-secret" }), async () => { throw Error("https://provider.invalid/private-token"); }]) {
    const result = await request({ observe }); assert.equal(result.status, 503); assert.equal(result.data, undefined);
    assert.doesNotMatch(JSON.stringify(result), /synthetic-secret|private-token/);
  }
  const limited = await request({ observe: async () => { throw Error("canary_rate_limited"); } });
  assert.equal(limited.status, 429); assert.equal(limited.headers["Retry-After"], "3");
});
test("local deployment observation hint is explicit, testnet-only and server-only; ambient values are not inherited", () => {
  const hash = `0x${"12".repeat(32)}`;
  assert.deepEqual(canaryStatusConfiguration("dev-testnet", []), {});
  assert.deepEqual(canaryStatusConfiguration("dev-testnet", ["--canary-deployment-tx", hash]), { RACESON_REWARD_CANARY_DEPLOYMENT_TX_HASH: hash });
  for (const [action, extra] of [["dev", ["--canary-deployment-tx", hash]], ["migrate", ["--canary-deployment-tx", hash]],
    ["dev-testnet", ["--canary-deployment-tx", "https://provider.invalid"]], ["dev-testnet", ["--canary-deployment-tx", `0x${"0".repeat(64)}`]],
    ["dev-testnet", ["--canary-deployment-tx", hash, "--approve"]]]) assert.throws(() => canaryStatusConfiguration(action, extra));
  const original = process.env.RACESON_REWARD_CANARY_DEPLOYMENT_TX_HASH;
  try {
    process.env.RACESON_REWARD_CANARY_DEPLOYMENT_TX_HASH = hash;
    const env = localAppEnvironment({ API_URL: database, ANON_KEY: "synthetic-anon", PUBLISHABLE_KEY: "synthetic-public", SERVICE_ROLE_KEY: "synthetic-server" }, "local-testnet");
    assert.equal(env.RACESON_REWARD_CANARY_DEPLOYMENT_TX_HASH, undefined);
    assert.equal(Object.values(env).includes(hash), false);
  } finally {
    if (original === undefined) delete process.env.RACESON_REWARD_CANARY_DEPLOYMENT_TX_HASH; else process.env.RACESON_REWARD_CANARY_DEPLOYMENT_TX_HASH = original;
  }
});
