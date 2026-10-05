import assert from "node:assert/strict";
import test from "node:test";
import { createPublicClient, http } from "viem";
import { dispatchAthleteRewardRoutes } from "../dist/routes/rewards/athlete.js";
import { createRewardClaimReader, rewardClaimChainFetch, REWARD_CLAIM_TESTNET_RPC } from "../dist/features/rewards/claim-chain-reader.js";
import { readRewardAthleteConsentContext } from "../../../packages/db/dist/rewards/index.js";
import { getAthleteRewardClaimConsent, consentToAthleteRewardClaim } from "../dist/features/rewards/athlete-claim-consent-service.js";
import { applyPrivateSessionHeaders } from "../dist/browser-session.js";

const id = n => `7b000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const identity = { userId: id(1), sessionId: id(2) }, config = { chainId: 31337, origin: "http://127.0.0.1:3101" };
const secret = "synthetic-private-provider-diagnostic";
function response(body, { url = REWARD_CLAIM_TESTNET_RPC, headers = {}, status = 200 } = {}) {
  const result = new Response(body, { status, headers: { "content-type": "application/json", ...headers } });
  Object.defineProperty(result, "url", { value: url }); return result;
}
const request = (method = "eth_chainId", params = []) => ({ method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });

test("claim reader uses actual viem for read-only fixed-testnet or explicit canonical loopback requests", async () => {
  let calls = 0;
  const fetchFn = async (req, init) => {
    calls++; const body = JSON.parse(await req.text()); assert.equal(body.method, "eth_chainId");
    assert.equal(init.redirect, "error"); assert.equal(init.credentials, "omit"); assert.equal(init.cache, "no-store");
    return response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: req.url === REWARD_CLAIM_TESTNET_RPC ? "0x279f" : "0x7a69" }), { url: req.url });
  };
  assert.equal(await createRewardClaimReader({ ...config, chainId: 10143 }, {}, fetchFn).getChainId(), 10143);
  assert.equal(await createRewardClaimReader(config, { RACESON_REWARD_LOCAL_RPC_URL: "http://127.0.0.1:45678/" }, fetchFn).getChainId(), 31337);
  assert.equal(calls, 2);
  for (const [settings, env] of [[{ ...config, chainId: 143 }, {}], [config, {}],
    [config, { NODE_ENV: "production", RACESON_REWARD_LOCAL_RPC_URL: "http://127.0.0.1:45678/" }],
    [{ ...config, chainId: 10143 }, { RACESON_REWARD_LOCAL_RPC_URL: "http://127.0.0.1:45678/" }]]) {
    assert.throws(() => createRewardClaimReader(settings, env, fetchFn), { code: "reward_claim_transport_unavailable" });
  }
  for (const url of ["https://rpc.monad.xyz/", "http://localhost:45678/", "http://127.0.0.1:45678", "http://127.0.0.1/",
    "http://127.0.0.1:45678/path", "http://127.0.0.1:45678/?secret=x", "http://user:secret@127.0.0.1:45678/", REWARD_CLAIM_TESTNET_RPC]) {
    assert.throws(() => createRewardClaimReader(config, { RACESON_REWARD_LOCAL_RPC_URL: url }, fetchFn));
  }
  assert.equal(calls, 2);
});

test("claim transport rejects all wallet, broadcast, arbitrary-header and foreign-URL requests before network IO", async () => {
  let calls = 0; const fetchFn = rewardClaimChainFetch(REWARD_CLAIM_TESTNET_RPC, async () => { calls++; throw new Error(secret); });
  for (const method of ["eth_sendRawTransaction", "eth_sendTransaction", "personal_sign", "eth_signTypedData_v4", "eth_estimateGas", "wallet_switchEthereumChain"]) {
    await assert.rejects(fetchFn(REWARD_CLAIM_TESTNET_RPC, request(method)), { code: "reward_claim_transport_unavailable" });
  }
  for (const [url, init] of [["https://rpc.monad.xyz/", request()], [REWARD_CLAIM_TESTNET_RPC, { ...request(), method: "GET" }],
    [REWARD_CLAIM_TESTNET_RPC, { ...request(), body: "x".repeat(65537) }], [REWARD_CLAIM_TESTNET_RPC, { ...request(), body: "[]" }]]) {
    await assert.rejects(fetchFn(url, init));
  }
  for (const key of ["authorization", "apikey", "cookie", "x-private-token"]) {
    await assert.rejects(fetchFn(REWARD_CLAIM_TESTNET_RPC, { ...request(), headers: { [key]: secret } }));
  }
  assert.equal(calls, 0);
  const reader = createPublicClient({ transport: http(REWARD_CLAIM_TESTNET_RPC, { fetchFn, retryCount: 0 }), cacheTime: 0 });
  await assert.rejects(reader.request({ method: "eth_sendRawTransaction", params: ["0x1234"] }, { retryCount: 0 }));
  assert.equal(calls, 0);
});

test("claim transport bounds complete response bodies and masks failure, redirects, non-JSON and excess data", async () => {
  for (const make of [() => response("{}", { url: "https://foreign.invalid/" }), () => response("{}", { status: 500 }),
    () => response("{}", { headers: { "content-type": "text/html" } }),
    () => response("{}", { headers: { "content-length": "8388609" } }), () => response("{}", { headers: { "content-length": "invalid" } }),
    () => response(new Uint8Array(8388609))]) {
    await assert.rejects(rewardClaimChainFetch(REWARD_CLAIM_TESTNET_RPC, async () => make())(REWARD_CLAIM_TESTNET_RPC, request()), { code: "reward_claim_transport_unavailable" });
  }
  for (const fetchFn of [async () => { throw new Error(secret); }, () => new Promise(() => {}),
    async () => response(new ReadableStream({ pull: () => new Promise(() => {}) }))]) {
    const started = Date.now();
    await assert.rejects(rewardClaimChainFetch(REWARD_CLAIM_TESTNET_RPC, fetchFn, 20)(REWARD_CLAIM_TESTNET_RPC, request()),
      error => error.code === "reward_claim_transport_unavailable" && !error.message.includes(secret));
    assert(Date.now() - started < 2000);
  }
});

test("consent repository and service freeze recipient identity and never accept an operator role from input", async () => {
  let calls = 0, captured;
  const actor = { ...identity };
  const pending = readRewardAthleteConsentContext(actor, id(3), async (name, args) => {
    assert.equal(name, "service_read_reward_athlete_consent_context"); captured = args; await Promise.resolve();
    return { data: null, error: { message: "reward_claim_proof_scope_required" } };
  });
  actor.userId = id(9); actor.sessionId = id(9);
  await assert.rejects(pending, { code: "reward_claim_proof_scope_required" });
  assert.deepEqual(captured, { p_actor_user_id: id(1), p_actor_session_id: id(2), p_intent_id: id(3) });
  const rpc = async (name, args) => { calls++; assert.equal(args.p_role, "recipient"); return { data: null, error: { message: "reward_claim_proof_scope_required" } }; };
  await assert.rejects(consentToAthleteRewardClaim(identity, { intentId: id(3), signature: "0x", idempotencyKey: "test-consent-key", role: "operator" }, { ...config, reader: {}, rpc }), { code: "reward_claim_proof_scope_required" });
  assert.equal(calls, 1);
  await assert.rejects(getAthleteRewardClaimConsent({ ...identity, sessionId: "invalid" }, id(3), { ...config, reader: {}, rpc }));
  assert.equal(calls, 1);
});

async function route(method, path, body = null, overrides = {}) {
  const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(v) { this.body = JSON.parse(v); } };
  let calls = 0, auth = 0;
  const routed = await dispatchAthleteRewardRoutes({ method, headers: {} }, res, new URL(path, config.origin), {
    config: () => config, claimReader: {}, requireIdentity: async () => { auth++; return identity; }, readJsonBody: async () => body,
    sendSuccess: (r, data) => r.end(JSON.stringify({ data })), sendError: (r, status, code, message) => { r.statusCode = status; r.end(JSON.stringify({ error: { code, message } })); },
    applyPrivateSessionHeaders, rpc: async () => { calls++; return { data: null, error: { message: "reward_claim_proof_scope_required" } }; }, ...overrides,
  });
  return { ...res, routed, calls, auth };
}
const path = `/api/v1/athlete/rewards/claims/${id(3)}`;
test("consent routes strictly validate one signature/key and ID before any private read or chain request", async () => {
  const body = { signature: `0x${"12".repeat(65)}`, idempotencyKey: "test-consent-key" };
  for (const extra of [{ role: "operator" }, { amountWei: "1" }, { recipientAddress: `0x${"12".repeat(20)}` },
    { userId: id(1) }, { chainId: 143 }, { witness: {} }, { calldata: "0x" }, { intentId: id(9) }]) {
    const r = await route("POST", `${path}/consent`, { ...body, ...extra }); assert.equal(r.statusCode, 400); assert.equal(r.calls, 0);
  }
  for (const [method, url, value] of [["GET", `${path}?role=operator`, null], ["GET", `${path}?after=${id(1)}`, null],
    ["GET", "/api/v1/athlete/rewards/claims/bad", null], ["POST", `${path}/consent`, { ...body, signature: "0x" }],
    ["POST", `${path}/consent`, { ...body, idempotencyKey: "short" }]]) {
    const r = await route(method, url, value); assert.equal(r.statusCode, 400); assert.equal(r.calls, 0);
  }
  for (const method of ["GET", "POST"]) {
    const url = method === "GET" ? path : `${path}/consent`;
    const missing = await route(method, url, body); assert.equal(missing.statusCode, 404); assert.equal(missing.body.error.code, "reward_claim_not_found");
    assert.equal(missing.headers["Cache-Control"], "private, no-store");
    const disabled = await route(method, url, body, { config: () => null }); assert.equal(disabled.routed, false); assert.equal(disabled.auth, 0);
    const revoked = await route(method, url, body, { rpc: async () => ({ data: null, error: { message: "reward_account_session_required" } }) }); assert.equal(revoked.statusCode, 401);
  }
});

test("consent routes return useful bounded holds without exposing private source or provider diagnostics", async () => {
  for (const [code, status] of [["reward_claim_readiness_required", 409], ["reward_review_source_changed", 409],
    ["reward_account_session_required", 401], [secret, 503]]) {
    const r = await route("GET", path, null, { rpc: async () => ({ data: null, error: { message: code } }) });
    assert.equal(r.statusCode, status); assert.doesNotMatch(JSON.stringify(r.body), /synthetic-private-provider-diagnostic/);
  }
  for (const [message, status] of [["Unauthorized", 401], ["Untrusted browser origin", 403]]) {
    const r = await route("GET", path, null, { requireIdentity: async () => { throw new Error(message); } });
    assert.equal(r.statusCode, status); assert.equal(r.calls, 0);
  }
});
