import assert from "node:assert/strict";
import test from "node:test";
import { listRewardAthleteClaims } from "../../../packages/db/dist/rewards/index.js";
import { getAthleteRewardClaims } from "../dist/features/rewards/athlete-claim-history-service.js";
import { dispatchAthleteRewardRoutes } from "../dist/routes/rewards/athlete.js";
import { applyPrivateSessionHeaders } from "../dist/browser-session.js";

const id = n => `7a000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const identity = { userId: id(1), sessionId: id(2) };
const config = { chainId: 31337, origin: "http://127.0.0.1:5173" };
const row = (n = 10) => ({ intentId: id(n), programmeId: id(3), campaignId: id(4), entitlementId: id(5),
  scopeKey: id(6), pot: "race", chainId: 31337, amountWei: "999999999999999999", recipientAddress: `0x${"ab".repeat(20)}`,
  issuedAt: "1788854400", expiresAt: "1788940800", preparedAt: "2026-09-08T08:00:00Z",
  recipientConsentRecordedAt: null, operatorApprovalRecordedAt: null });
const page = () => ({ items: [row()], nextCursor: null });
const transport = data => async () => ({ data, error: null });

test("own prepared-claim history preserves exact amounts and excludes all private proof/context fields", async () => {
  const result = await getAthleteRewardClaims(identity, null, { ...config, rpc: async (name, args) => {
    assert.equal(name, "service_list_reward_athlete_claims");
    assert.deepEqual(args, { p_user_id: id(1), p_session_id: id(2), p_chain_id: 31337, p_after_id: null });
    return { data: page(), error: null };
  } });
  assert.deepEqual(result, page());
  assert.doesNotMatch(JSON.stringify(result), /userId|sessionId|signature|witness|reviewContext|dateOfBirth|idempotencyKey|paid|claimable|balance/i);
  const league = { ...row(), chainId: 10143, pot: "league", scopeKey: "rounds-1-5",
    recipientConsentRecordedAt: "2026-09-08T08:00:01Z", operatorApprovalRecordedAt: "2026-09-08T08:00:02Z" };
  assert.deepEqual(await getAthleteRewardClaims(identity, null, { ...config, chainId: 10143,
    rpc: transport({ items: [league], nextCursor: null }) }), { items: [league], nextCursor: null });
});

test("claim discovery freezes verified account/session, selected network and cursor before awaiting RPC", async () => {
  const actor = { ...identity }, input = { chainId: 31337, afterId: id(8) }; let observed;
  const pending = listRewardAthleteClaims(actor, input, async (name, args) => {
    observed = args; await Promise.resolve(); return { data: page(), error: null };
  });
  actor.userId = id(9); actor.sessionId = id(9); input.chainId = 143; input.afterId = id(99);
  assert.equal((await pending).items[0].intentId, id(10));
  assert.deepEqual(observed, { p_user_id: id(1), p_session_id: id(2), p_chain_id: 31337, p_after_id: id(8) });
  let calls = 0; const never = async () => { calls++; throw new Error("unexpected"); };
  for (const [actorValue, request] of [[{ ...identity, sessionId: "bad" }, { chainId: 31337 }],
    [identity, { chainId: 143 }], [identity, { chainId: 31337, afterId: "bad" }]]) {
    await assert.rejects(listRewardAthleteClaims(actorValue, request, never));
  }
  assert.equal(calls, 0);
});

test("claim history strictly decodes selected chain, integers, recipient, time window and proof-record order", async () => {
  for (const patch of [{ chainId: 10143 }, { pot: "club" }, { scopeKey: "invalid" }, { pot: "league" },
    { amountWei: 1 }, { amountWei: "0" }, { amountWei: "01" }, { amountWei: String(1n << 256n) },
    { recipientAddress: `0x${"0".repeat(40)}` }, { recipientAddress: "bad" }, { issuedAt: "0" },
    { expiresAt: "1788854400" }, { expiresAt: "1788940801" }, { expiresAt: String(1n << 64n) },
    { preparedAt: "invalid" }, { recipientConsentRecordedAt: "2026-09-08T07:00:00Z" },
    { operatorApprovalRecordedAt: "2026-09-08T09:00:00Z" },
    { recipientConsentRecordedAt: "2026-09-08T09:00:00Z", operatorApprovalRecordedAt: "2026-09-08T08:00:00Z" },
    { signature: "must-not-escape" }, { reviewContext: {} }]) {
    await assert.rejects(listRewardAthleteClaims(identity, { chainId: 31337 }, transport({ items: [{ ...row(), ...patch }], nextCursor: null })));
  }
  const accessor = row(); Object.defineProperty(accessor, "amountWei", { enumerable: true, get() { throw new Error("getter executed"); } });
  await assert.rejects(listRewardAthleteClaims(identity, { chainId: 31337 }, transport({ items: [accessor], nextCursor: null })),
    error => error.message !== "getter executed");
});

test("claim history validates deterministic bounded pagination and rejects malformed response shapes", async () => {
  const items = Array.from({ length: 50 }, (_, i) => row(i + 10));
  const valid = { items, nextCursor: items.at(-1).intentId };
  assert.equal((await listRewardAthleteClaims(identity, { chainId: 31337 }, transport(valid))).items.length, 50);
  for (const data of [null, [], {}, { ...page(), signature: "private" }, { items: new Array(1), nextCursor: null },
    { items: [...items, row(60)], nextCursor: null }, { items: [row(), row()], nextCursor: null },
    { items: [row(11), row(10)], nextCursor: null }, { ...page(), nextCursor: id(10) }, { ...valid, nextCursor: id(99) }]) {
    await assert.rejects(listRewardAthleteClaims(identity, { chainId: 31337 }, transport(data)));
  }
  await assert.rejects(listRewardAthleteClaims(identity, { chainId: 31337, afterId: id(10) }, transport(page())));
  assert.deepEqual(await listRewardAthleteClaims(identity, { chainId: 31337 }, transport({ items: [], nextCursor: null })), { items: [], nextCursor: null });
});

test("claim history preserves bounded session errors and masks unexpected private provider details", async () => {
  for (const [message, code] of [["reward_account_session_required", "reward_account_session_required"],
    ["invalid_reward_claim_history_request", "invalid_reward_claim_history_request"], ["private database endpoint", "reward_ledger_store_failed"]]) {
    await assert.rejects(listRewardAthleteClaims(identity, { chainId: 31337 }, async () => ({ data: null, error: { message } })), { code });
  }
  await assert.rejects(listRewardAthleteClaims(identity, { chainId: 31337 }, async () => { throw new Error("private credential"); }), { code: "reward_ledger_unavailable" });
});

async function request(path = "/api/v1/athlete/rewards/claims", overrides = {}, method = "GET") {
  const res = { statusCode: 200, headers: {}, setHeader(name, value) { this.headers[name] = value; }, end(value) { this.body = JSON.parse(value); } };
  let auth = 0, calls = 0;
  const routed = await dispatchAthleteRewardRoutes({ method, headers: {} }, res, new URL(path, "https://untrusted.example"), {
    config: () => config, requireIdentity: async () => { auth++; return identity; },
    readJsonBody: async () => { throw new Error("GET must not read a body"); },
    sendSuccess: (r, data) => r.end(JSON.stringify({ data })), sendError: (r, status, code, message) => {
      r.statusCode = status; r.end(JSON.stringify({ error: { code, message } }));
    }, applyPrivateSessionHeaders, rpc: async (name, args) => {
      calls++; assert.equal(args.p_chain_id, config.chainId); assert.equal(args.p_user_id, identity.userId);
      return { data: page(), error: null };
    }, ...overrides,
  });
  return { ...res, routed, auth, calls };
}

test("demo claims route is private, read-only, feature gated and never accepts client scope or network", async () => {
  const result = await request(); assert.equal(result.routed, true); assert.equal(result.auth, 1); assert.equal(result.calls, 1);
  assert.deepEqual(result.body.data, page()); assert.equal(result.headers["Cache-Control"], "private, no-store");
  for (const query of ["?userId=other", "?chainId=143", "?after=bad", `?after=${id(1)}&after=${id(2)}`, "?role=operator"]) {
    const invalid = await request(`/api/v1/athlete/rewards/claims${query}`); assert.equal(invalid.statusCode, 400); assert.equal(invalid.calls, 0);
  }
  const disabled = await request(undefined, { config: () => null }); assert.equal(disabled.routed, false); assert.equal(disabled.auth, 0);
  assert.equal((await request(undefined, {}, "POST")).routed, false);
  assert.equal((await request("/api/v1/athlete/rewards/claims/not-an-intent-id")).statusCode, 400);
  for (const [message, status] of [["Unauthorized", 401], ["Missing bearer token", 401], ["Untrusted browser origin", 403]]) {
    const denied = await request(undefined, { requireIdentity: async () => { throw new Error(message); } });
    assert.equal(denied.statusCode, status); assert.equal(denied.calls, 0);
  }
  const revoked = await request(undefined, { rpc: async () => ({ data: null, error: { message: "reward_account_session_required" } }) });
  assert.equal(revoked.statusCode, 401);
  const failure = await request(undefined, { rpc: async () => ({ data: null, error: { message: "private operator secret" } }) });
  assert.equal(failure.statusCode, 503); assert.doesNotMatch(JSON.stringify(failure.body), /private operator secret/);
});
