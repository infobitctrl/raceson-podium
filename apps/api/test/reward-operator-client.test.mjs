import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { createRewardOperatorClient, rewardOperatorFetch } from "../../../packages/db/dist/rewards/index.js";
import { runAuthenticatedRewardOperator } from "../dist/features/rewards/operator-command.js";
import { rewardId as id } from "./fixtures/reward-calculation.mjs";

const target = { mode: "testnet", chainId: 10143, origin: "https://rewards.example.test", supabaseUrl: "https://abcdefghijklmnopqrst.supabase.co" };
const publishableKey = `sb_publishable_${"a".repeat(32)}`;
const serverKey = `sb_secret_${"b".repeat(32)}`;
const identity = { userId: id(4), sessionId: id(99511) };
const gasPolicy = { maxGasLimit: 500000n, maxFeePerGas: 30000000000n, maxTotalFeeWei: 15000000000000000n, minimumRemainingBalanceWei: 1000000n };
const response = (url, value, status = 200, headers = {}) => {
  const result = new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
  Object.defineProperty(result, "url", { value: url }); return result;
};
function credentials() {
  // Synthetic Auth signing keys only, generated in memory and never exported
  // privately, printed, saved or usable on a Supabase/public-chain project.
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const kid = randomUUID();
  const jwk = { ...publicKey.export({ format: "jwk" }), kid, alg: "ES256", use: "sig" };
  const token = (patch = {}, key = privateKey) => {
    const header = Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256", kid })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ iss: `${target.supabaseUrl}/auth/v1`, aud: "authenticated", role: "authenticated",
      sub: identity.userId, session_id: identity.sessionId, is_anonymous: false,
      iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600, ...patch })).toString("base64url");
    const body = `${header}.${payload}`;
    return `${body}.${sign("sha256", Buffer.from(body), { key, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
  };
  return { jwk, token };
}

test("operator client uses real SDK signature verification, then binds private RPCs to that account/session", async () => {
  const { jwk, token } = credentials(); const calls = []; const controller = new AbortController();
  const client = createRewardOperatorClient({ target, publishableKey, serverKey, signal: controller.signal }, async request => {
    calls.push(request.url);
    if (request.url.endsWith("/auth/v1/.well-known/jwks.json")) {
      assert.equal(request.method, "GET"); assert.equal(request.headers.get("apikey"), publishableKey);
      return response(request.url, { keys: [jwk] });
    }
    assert.equal(request.url, `${target.supabaseUrl}/rest/v1/rpc/service_next_reward_operator_job`);
    assert.equal(request.method, "POST"); assert.equal(request.headers.get("apikey"), serverKey);
    assert.deepEqual(await request.json(), { p_actor_user_id: identity.userId, p_actor_session_id: identity.sessionId });
    return response(request.url, { schemaVersion: 1, job: null });
  });
  const args = { p_actor_user_id: identity.userId, p_actor_session_id: identity.sessionId };
  await assert.rejects(client.rpc("service_next_reward_operator_job", args), /reward_operator_auth_required/);
  assert.equal(calls.length, 0);
  const verified = await client.authenticate(token(), identity.userId);
  assert.deepEqual(verified.identity, identity); assert(verified.expiresAtMs > Date.now());
  assert.deepEqual((await client.rpc("service_next_reward_operator_job", args)).data, { schemaVersion: 1, job: null });
  for (const changed of [{ ...args, p_actor_user_id: id(5) }, { ...args, p_actor_session_id: id(8) }]) {
    await assert.rejects(client.rpc("service_next_reward_operator_job", changed), /reward_operator_auth_required/);
  }
  await assert.rejects(client.rpc("service_create_reward_programme", args), /reward_operator_auth_required/);
  controller.abort(); await assert.rejects(client.rpc("service_next_reward_operator_job", args), /reward_operator_auth_required/);
  assert.equal(calls.length, 2);
});

test("operator authentication rejects invalid signatures, identity/domain/role/expiry and clears previous authority", async () => {
  const { jwk, token } = credentials(); let posts = 0;
  const client = createRewardOperatorClient({ target, publishableKey, serverKey, signal: new AbortController().signal }, async request => {
    assert.equal(request.method, "GET"); if (request.method === "POST") posts++;
    return response(request.url, { keys: [jwk] });
  });
  const wrongKey = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey;
  for (const invalid of [token({}, wrongKey), token({ sub: id(5) }), token({ session_id: null }),
    token({ iss: "https://icdtinbmtvzhswrrzjxq.supabase.co/auth/v1" }), token({ aud: "foreign" }),
    token({ role: "service_role" }), token({ is_anonymous: true }), token({ exp: 1 }),
    token({ exp: Math.floor(Date.now() / 1000) + 3 }), token({ exp: "9999999999" })]) {
    await client.authenticate(token(), identity.userId);
    await assert.rejects(client.authenticate(invalid, identity.userId), /reward_operator_auth_required/);
    await assert.rejects(client.rpc("service_next_reward_operator_job", { p_actor_user_id: identity.userId, p_actor_session_id: identity.sessionId }), /reward_operator_auth_required/);
  }
  assert.equal(posts, 0);
});

test("operator HTTP transport refuses foreign hosts, redirects, mutations, secrets in query strings and inherited credentials", async () => {
  let calls = 0;
  const transport = rewardOperatorFetch(target, new AbortController().signal, async () => { calls++; throw Error("private credentials must not escape"); });
  for (const [url, method] of [["https://icdtinbmtvzhswrrzjxq.supabase.co/auth/v1/user", "GET"],
    [`${target.supabaseUrl}/auth/v1/logout`, "POST"], [`${target.supabaseUrl}/auth/v1/user?token=secret`, "GET"],
    [`${target.supabaseUrl}/auth/v1/user`, "PUT"], [`${target.supabaseUrl}/rest/v1/rpc/service_create_reward_programme`, "POST"]]) {
    await assert.rejects(transport(url, { method }), /reward_operator_transport_unavailable/);
  }
  assert.equal(calls, 0);
  assert.throws(() => createRewardOperatorClient({ target, publishableKey, serverKey: undefined, signal: new AbortController().signal }), /reward_operator_transport_unavailable/);
  assert.throws(() => createRewardOperatorClient({ target: { ...target, supabaseUrl: "https://icdtinbmtvzhswrrzjxq.supabase.co" }, publishableKey, serverKey,
    signal: new AbortController().signal }), /reward_operator_transport_unavailable/);
  const url = `${target.supabaseUrl}/auth/v1/user`;
  for (const make of [() => response("https://other.example.test", {}), () => response(url, {}, 200, { "content-length": "999999999" }),
    () => response(url, {}, 200, { "content-type": "text/html" }), () => { throw Error("private credentials"); }]) {
    const read = rewardOperatorFetch(target, new AbortController().signal, async (_request, init) => {
      assert.equal(init.redirect, "error"); assert.equal(init.credentials, "omit"); assert.equal(init.cache, "no-store"); return make();
    });
    await assert.rejects(read(url), { message: "reward_operator_transport_unavailable" });
  }
});

test("operator transport bounds stalled headers/bodies and honors cancellation without waiting for an uncooperative stream", async () => {
  const url = `${target.supabaseUrl}/auth/v1/user`;
  for (const body of [false, true]) {
    const transport = rewardOperatorFetch(target, new AbortController().signal, async () => {
      if (!body) return new Promise(() => {});
      const r = new Response(new ReadableStream({ start() {} }), { headers: { "content-type": "application/json" } });
      Object.defineProperty(r, "url", { value: url }); return r;
    }, 10);
    await assert.rejects(transport(url), { message: "reward_operator_transport_unavailable" });
  }
  const controller = new AbortController();
  const read = rewardOperatorFetch(target, controller.signal, async () => new Promise(() => {}));
  const pending = read(url); controller.abort();
  await assert.rejects(pending, { message: "reward_operator_transport_unavailable" });
});

test("authenticated command reads the actual-account queue and never returns credentials", async () => {
  const calls = []; let commandSignal;
  const input = { target, programmeId: id(99100), operatorUserId: identity.userId, workerId: id(99101), maxJobs: 5, durationMs: 60000,
    accessToken: "synthetic access token", publishableKey, serverKey };
  const result = await runAuthenticatedRewardOperator(input, { gasPolicy, reader: {}, creationCode: "0x00", broadcast() { assert.fail("empty queue cannot send"); } }, options => {
    commandSignal = options.signal; assert.equal(options.target.supabaseUrl, target.supabaseUrl);
    return { authenticate: async (token, expected) => {
      assert.equal(token, input.accessToken); assert.equal(expected, identity.userId); calls.push("auth");
      return { identity, expiresAtMs: Date.now() + 30000 };
    }, rpc: async (name, args) => {
      calls.push(name); assert.equal(args.p_actor_user_id, identity.userId); assert.equal(args.p_actor_session_id, identity.sessionId);
      return { data: { schemaVersion: 1, programmeId: input.programmeId, chainId: 10143, job: null }, error: null };
    } };
  });
  assert.deepEqual(calls, ["auth", "service_next_reward_operator_job"]); assert.equal(result.stop, "queue_empty");
  assert.equal(result.chainId, 10143); assert.equal(commandSignal.aborted, true);
  assert.doesNotMatch(JSON.stringify(result), /sb_secret_|sb_publishable_|synthetic access token|sessionId|privateKey/);
});

test("authenticated command stops at token expiry margin, not its longer configured duration", async () => {
  const started = Date.now(); let signal;
  const result = await runAuthenticatedRewardOperator({ target, programmeId: id(99100), operatorUserId: identity.userId,
    workerId: id(99101), maxJobs: 5, durationMs: 60000, accessToken: "synthetic", publishableKey, serverKey },
  { gasPolicy, reader: {}, creationCode: "0x00", broadcast() { assert.fail("no send after deadline"); } }, options => {
    signal = options.signal;
    return { authenticate: async () => ({ identity, expiresAtMs: Date.now() + 5100 }), rpc: async () => {
      await new Promise(resolve => signal.addEventListener("abort", resolve, { once: true }));
      return { data: { schemaVersion: 1, programmeId: id(99100), chainId: 10143, job: null }, error: null };
    } };
  });
  assert.equal(result.stop, "stopped"); assert.deepEqual(result.entries, []);
  assert.equal(signal.aborted, true); assert(Date.now() - started < 5000);
});

test("invalid command targets, limits and gas policy fail before authentication; failed login cannot touch a queue", async () => {
  const input = { target, programmeId: id(99100), operatorUserId: identity.userId, workerId: id(99101),
    maxJobs: 5, durationMs: 60000, accessToken: "synthetic", publishableKey, serverKey };
  const deps = { gasPolicy, reader: {}, creationCode: "0x00", broadcast() { assert.fail("not authenticated"); } };
  let clients = 0;
  const never = () => { clients++; assert.fail("invalid input must not create a client"); };
  for (const patch of [{ maxJobs: 0 }, { maxJobs: 101 }, { durationMs: 1800001 }, { durationMs: 0 },
    { target: { ...target, chainId: 143 } }, { target: { ...target, origin: "https://www.raceson.com" } }]) {
    await assert.rejects(runAuthenticatedRewardOperator({ ...input, ...patch }, deps, never));
  }
  await assert.rejects(runAuthenticatedRewardOperator(input, { ...deps, gasPolicy: { ...gasPolicy, maxGasLimit: -1n } }, never));
  assert.equal(clients, 0);
  let signal;
  await assert.rejects(runAuthenticatedRewardOperator(input, deps, options => {
    signal = options.signal;
    return { authenticate: async () => { throw Error("reward_operator_auth_required"); }, rpc() { assert.fail("no queue access"); } };
  }), /reward_operator_auth_required/);
  assert.equal(signal.aborted, true);
});
