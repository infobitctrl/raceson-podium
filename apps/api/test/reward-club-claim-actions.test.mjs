import assert from "node:assert/strict";
import test from "node:test";
import { readRewardClubSigningContext } from "../../../packages/db/dist/rewards/index.js";
import { dispatchOrganizerRewardRoutes } from "../dist/routes/rewards/organizer.js";
import { dispatchClubRewardRoutes } from "../dist/routes/rewards/clubs.js";
import { getClubClaimAction, prepareOrganizerClubClaim } from "../dist/features/rewards/club-claim-action-service.js";
import { applyPrivateSessionHeaders } from "../dist/browser-session.js";

const id = n => `7c800000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const identity = { userId: id(1), sessionId: id(2) };
const config = { chainId: 31337, origin: "http://127.0.0.1:3101" };
const root = `/api/v1/organizer/rewards/programmes/${id(3)}/club-claims`;
const paths = [root, `/api/v1/athlete/rewards/club-claims/${id(4)}/consent`, `${root}/${id(4)}/approval`];
const bodies = [
  { reviewId: id(5), entitlementId: id(6), idempotencyKey: "prepare-club-http", confirmPrepare: true },
  { signature: `0x${"ab".repeat(130)}`, idempotencyKey: "consent-club-http", confirmConsent: true },
  { signature: `0x${"ab".repeat(65)}`, idempotencyKey: "approve-club-http", confirmApproval: true },
];
async function route(index, { path = paths[index], method = "POST", body = bodies[index], error = index === 0 ? "reward_claim_scope_required" : "reward_claim_proof_scope_required", ...overrides } = {}) {
  const calls = [], counts = { auth: 0, body: 0, chain: 0 };
  const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(v) { this.body = JSON.parse(v); } };
  const dispatch = path.startsWith("/api/v1/organizer/") ? dispatchOrganizerRewardRoutes : dispatchClubRewardRoutes;
  const handled = await dispatch({ method, headers: {} }, res, new URL(path, config.origin), {
    config: () => config, requireIdentity: async () => { counts.auth++; return identity; },
    readJsonBody: async () => { counts.body++; return body; }, applyPrivateSessionHeaders,
    clubClaimReader: new Proxy({}, { get() { counts.chain++; throw Error("unauthorized chain access"); } }),
    sendSuccess: (r, data) => r.end(JSON.stringify({ data })),
    sendError: (r, status, code, message) => { r.statusCode = status; r.end(JSON.stringify({ error: { code, message } })); },
    rpc: async (name, args) => { calls.push({ name, args }); return { data: null, error: { message: error } }; }, ...overrides,
  });
  assert.equal(counts.chain, 0);
  return { ...res, handled, calls, counts };
}

test("club claim commands fix actor, session, intent and role from the authenticated route", async () => {
  for (const index of [0, 1, 2]) {
    const r = await route(index);
    assert.equal(r.handled, true); assert.equal(r.statusCode, 404);
    assert.equal(r.headers["Cache-Control"], "private, no-store");
    assert.equal(r.counts.auth, 1); assert.equal(r.counts.body, 1); assert.equal(r.calls.length, 1);
    assert.equal(r.calls[0].args.p_actor_user_id, identity.userId);
    assert.equal(r.calls[0].args.p_actor_session_id, identity.sessionId);
    if (index === 0) {
      assert.equal(r.calls[0].name, "service_read_reward_club_claim_context");
      assert.equal(r.calls[0].args.p_review_id, id(5)); assert.equal(r.calls[0].args.p_entitlement_id, id(6));
    } else {
      assert.equal(r.calls[0].name, "service_read_reward_club_claim_proofs");
      assert.equal(r.calls[0].args.p_intent_id, id(4));
      assert.equal(r.calls[0].args.p_role, index === 1 ? "recipient" : "operator");
    }
  }
});
test("club signing GETs use the fresh SQL guard and never consume a body or start chain access after denial", async () => {
  for (const index of [1, 2]) {
    const r = await route(index, { method: "GET" }); assert.equal(r.statusCode, 404); assert.equal(r.counts.body, 0);
    assert.equal(r.calls[0].name, "service_read_reward_club_signing_context");
    assert.equal(r.calls[0].args.p_role, index === 1 ? "recipient" : "operator");
  }
});
test("club claim routes require the demo configuration before authentication or any IO", async () => {
  for (const index of [0, 1, 2]) {
    const r = await route(index, { config: () => null }); assert.equal(r.handled, false);
    assert.deepEqual(r.counts, { auth: 0, body: 0, chain: 0 }); assert.deepEqual(r.calls, []);
    for (const method of ["PUT", "DELETE", "PATCH", ...(index === 0 ? ["GET"] : [])])
      assert.equal((await route(index, { method })).handled, false);
  }
});
test("club claim inputs reject role, wallet, amount, chain and caller overrides before SQL", async () => {
  for (const index of [0, 1, 2]) {
    const confirmation = ["confirmPrepare", "confirmConsent", "confirmApproval"][index];
    for (const patch of [{ [confirmation]: false }, { [confirmation]: undefined }, { idempotencyKey: "tiny" },
      { idempotencyKey: "x".repeat(129) }, { role: "operator" }, { userId: id(99) }, { sessionId: id(99) },
      { chainId: 143 }, { recipientAddress: `0x${"cd".repeat(20)}` }, { amountWei: "1" }, { programmeId: id(99) }]) {
      const r = await route(index, { body: { ...bodies[index], ...patch } }); assert.equal(r.statusCode, 400); assert.equal(r.calls.length, 0);
    }
    for (const query of ["?chainId=143", "?role=operator", "?userId=x", "?after=x", "?a=1&a=2"]) {
      const r = await route(index, { path: paths[index] + query }); assert.equal(r.statusCode, 400);
      assert.equal(r.calls.length, 0); assert.equal(r.counts.body, 0);
    }
    const r = await route(index, { path: paths[index].replace(id(index === 0 ? 3 : 4), "bad") });
    assert.equal(r.statusCode, 400); assert.equal(r.calls.length, 0);
  }
});
test("club consent signatures are bounded bytes while operator approval requires exactly 65 bytes", async () => {
  for (const index of [1, 2]) {
    for (const signature of ["0x", "0x1", "private", `0x${"01".repeat(8193)}`, ...(index === 2 ? [`0x${"01".repeat(64)}`, `0x${"01".repeat(66)}`] : [])]) {
      const r = await route(index, { body: { ...bodies[index], signature } }); assert.equal(r.statusCode, 400); assert.equal(r.calls.length, 0);
      assert.doesNotMatch(JSON.stringify(r.body), /signature":"0x|private/);
    }
  }
  // Structural acceptance only; SQL refuses scope and no signature is verified/stored.
  const bounded = await route(1, { body: { ...bodies[1], signature: `0x${"AB".repeat(8192)}` } });
  assert.equal(bounded.statusCode, 404); assert.equal(bounded.calls.length, 1);
});
test("club actions distinguish private session, authority, scope, current holds and unavailable services", async () => {
  for (const [error, status] of [["reward_account_session_required", 401], ["reward_operator_permission_required", 403],
    ["reward_claim_proof_scope_required", 404], ["reward_claim_readiness_required", 409], ["reward_mapping_source_not_ready", 409],
    ["reward_claim_recipient_consent_required", 409], ["private SQL diagnostics", 503]]) {
    const r = await route(1, { error, method: "GET" }); assert.equal(r.statusCode, status);
    assert.equal(r.headers["Cache-Control"], "private, no-store"); assert.doesNotMatch(JSON.stringify(r.body), /private SQL diagnostics/);
  }
  for (const [message, status] of [["Unauthorized", 401], ["Missing bearer token", 401], ["Untrusted browser origin", 403]]) {
    const r = await route(1, { requireIdentity: async () => { throw Error(message); } });
    assert.equal(r.statusCode, status); assert.equal(r.counts.body, 0); assert.equal(r.calls.length, 0);
  }
  assert.equal((await route(1, { readJsonBody: async () => { throw new SyntaxError("private body"); } })).statusCode, 400);
  const unavailable = await route(1, { rpc: async () => { throw Error("private transport key"); } });
  assert.equal(unavailable.statusCode, 503); assert.doesNotMatch(JSON.stringify(unavailable.body), /private transport key/);
});
test("fresh club signing reads freeze the actual caller and whitelist source/session failures", async () => {
  const actor = { ...identity }, input = { intentId: id(4), role: "recipient" }; let sent;
  const pending = readRewardClubSigningContext(actor, input, async (method, args) => {
    assert.equal(method, "service_read_reward_club_signing_context"); sent = args; await Promise.resolve();
    return { data: null, error: { message: "reward_mapping_source_not_ready" } };
  });
  actor.userId = id(99); actor.sessionId = id(99); input.intentId = id(99); input.role = "operator";
  await assert.rejects(pending, { code: "reward_mapping_source_not_ready" });
  assert.deepEqual(sent, { p_actor_user_id: identity.userId, p_actor_session_id: identity.sessionId, p_intent_id: id(4), p_role: "recipient" });
});
test("club action services reject invalid private scope before constructing chain or touching SQL", async () => {
  let calls = 0; const deps = { ...config, rpc: async () => { calls++; throw Error("unexpected SQL"); }, reader: () => { calls++; throw Error("unexpected chain"); } };
  for (const input of [{ intentId: "bad", role: "recipient" }, { intentId: id(4), role: "admin" },
    { intentId: id(4), role: "operator" }, { intentId: id(4), role: "recipient", programmeId: id(3) }])
    await assert.rejects(getClubClaimAction(identity, input, deps));
  await assert.rejects(prepareOrganizerClubClaim(identity, { programmeId: "bad", ...bodies[0] }, deps));
  await assert.rejects(getClubClaimAction({ ...identity, sessionId: "bad" }, { intentId: id(4), role: "recipient" }, deps));
  assert.equal(calls, 0);
});
