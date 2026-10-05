import assert from "node:assert/strict";
import test from "node:test";
import { decodeClubRewardAward, decodeClubRewardClaim, decodeClubPortalPage, decodeClubRewardPayment } from "../../../packages/domain/dist/rewards/index.js";
import { listRewardClubAwards, listRewardClubClaims, readRewardClubPaymentStatus } from "../../../packages/db/dist/rewards/index.js";
import { getClubRewardPaymentStatus } from "../dist/features/rewards/club-portal-service.js";
import { dispatchClubRewardRoutes } from "../dist/routes/rewards/clubs.js";
import { applyPrivateSessionHeaders } from "../dist/browser-session.js";
import { clubPaymentFixture as fixture, clubPortalId as id, clubPortalIdentity as identity, clubPortalConfig as config } from "./fixtures/reward-club-portal.mjs";
const transport = data => async () => ({ data, error: null });
const award = () => { const { intentId, recipientAddress, issuedAt, expiresAt, preparedAt, recipientConsentRecordedAt, operatorApprovalRecordedAt, ...a } = fixture().claim; return a; };

test("club award and claim reads freeze private actor/network/selection and return only exact read models", async () => {
  const actor = { ...identity }, input = { chainId: 31337, clubId: id(7), afterId: null }; let args;
  const p = listRewardClubAwards(actor, input, async (name, a) => { assert.equal(name, "service_list_reward_club_awards"); args = a; await Promise.resolve(); return { data: { items: [award()], nextCursor: null }, error: null }; });
  actor.userId = id(99); actor.sessionId = id(99); input.chainId = 143; input.clubId = id(99);
  assert.deepEqual((await p).items, [award()]); assert.deepEqual(args, { p_user_id: identity.userId, p_session_id: identity.sessionId, p_chain_id: 31337, p_club_id: id(7), p_after_id: null });
  const page = await listRewardClubClaims(identity, { chainId: 31337 }, transport({ items: [fixture().claim], nextCursor: null }));
  assert.deepEqual(page.items, [fixture().claim]); assert.doesNotMatch(JSON.stringify(page), /signature|userId|sessionId|witness|nonce|idempotency|lease/i);
  await assert.rejects(listRewardClubAwards(identity, { chainId: 31337, clubId: id(8) }, transport({ items: [award()], nextCursor: null })));
});
test("club portal documents reject extra fields, getters, scope/economic/window corruption and unbounded or unordered pages", () => {
  for (const patch of [{ chainId: 143 }, { pot: "athlete" }, { clubId: "bad" }, { amountWei: "01" }, { amountWei: "0" }, { amountWei: String(1n << 256n) },
    { roundNumber: 0 }, { roundNumber: 6 }, { clubName: " " }, { raceName: "x".repeat(257) }, { signature: "private" }])
    assert.throws(() => decodeClubRewardAward({ ...award(), ...patch }, 31337));
  for (const patch of [{ issuedAt: "0" }, { expiresAt: "1788940801" }, { recipientAddress: `0x${"0".repeat(40)}` },
    { recipientConsentRecordedAt: null }, { preparedAt: "bad" }, { nonce: "1" }]) assert.throws(() => decodeClubRewardClaim({ ...fixture().claim, ...patch }, 31337));
  const getter = award(); Object.defineProperty(getter, "amountWei", { enumerable: true, get() { assert.fail("getter executed"); } });
  assert.throws(() => decodeClubRewardAward(getter, 31337), e => e.code === "invalid_reward_club_portal_document");
  const items = Array.from({ length: 25 }, (_, i) => ({ ...fixture().claim, intentId: id(100 + i) }));
  const read = (page, after = null) => decodeClubPortalPage(page, after, v => decodeClubRewardClaim(v, 31337), v => v.intentId);
  assert.equal(read({ items, nextCursor: id(124) }).nextCursor, id(124));
  for (const page of [{ items: [...items, items[0]], nextCursor: null }, { items: [...items].reverse(), nextCursor: null },
    { items: items.slice(0, 1), nextCursor: id(100) }, { items, nextCursor: id(125) }, { items: Array(1), nextCursor: null }]) assert.throws(() => read(page));
  assert.throws(() => read({ items, nextCursor: null }, id(100)));
  const league = { ...award(), pot: "league", scopeKey: "rounds-1-5", roundNumber: null, raceName: null };
  assert.equal(decodeClubRewardAward(league, 31337).pot, "league");
});
test("club status projects the worker's exact two-event receipt without raw capabilities or fresh RPC", async () => {
  const result = await getClubRewardPaymentStatus(identity, id(10), { ...config, rpc: transport(fixture()) });
  assert.equal(result.status, "confirmed"); assert.equal(result.receipt.safeReceivedLogIndex, 1);
  assert.deepEqual(decodeClubRewardPayment(result, fixture().claim), result);
  assert.doesNotMatch(JSON.stringify(result), /signature|signedTransaction|sessionId|userId|witness|lease|relayer|authorizationNonce|accounting|balance|idempotency/i);
  for (const status of ["no_confirmation", "queued", "processing", "submission_unconfirmed"]) {
    const r = await getClubRewardPaymentStatus(identity, id(10), { ...config, rpc: transport(fixture(status)) }); assert.equal(r.status, status); assert.equal(r.receipt, null);
  }
});
test("club confirmation decoder rejects athlete-only receipts, wrong events, fees, destinations, scope and private fields", async () => {
  const changes = [d => { d.claim.intentId = id(99); }, d => { d.claim.clubId = "bad"; }, d => { d.status = "queued"; }, d => { d.confirmation = null; },
    d => { d.chainEntitlementId = `0x${"8".repeat(64)}`; }, d => { d.confirmation.payment.action = "pay_athlete"; },
    d => { delete d.confirmation.payment.safeReceivedLogIndex; }, d => { d.confirmation.payment.safeReceivedLogIndex = 0; },
    d => { d.confirmation.payment.safeReceivedLogIndex = "1"; }, d => { d.confirmation.payment.safeReceivedLogIndex = Number.MAX_SAFE_INTEGER + 1; },
    d => { d.confirmation.payment.recipient = `0x${"8".repeat(40)}`; }, d => { d.confirmation.payment.amount = "1"; },
    d => { d.confirmation.payment.gasUsed = "99999999"; }, d => { d.confirmation.payment.blockTimestamp = d.claim.expiresAt; },
    d => { d.confirmation.payment.signature = "private"; }, d => { d.confirmation.observation.accounting.paid[0] = "0"; },
    d => { d.confirmation.recordedAt = "2020-01-01T00:00:00Z"; }];
  for (const mutate of changes) { const d = fixture(); mutate(d); await assert.rejects(readRewardClubPaymentStatus(identity, { chainId: 31337, intentId: id(10) }, transport(d))); }
  const good = await getClubRewardPaymentStatus(identity, id(10), { ...config, rpc: transport(fixture()) });
  for (const mutate of [d => { d.receipt.safeReceivedLogIndex = 2; }, d => { d.claim.amountWei = "1"; }, d => { d.receipt.extra = "private"; }]) {
    const d = structuredClone(good); mutate(d); assert.throws(() => decodeClubRewardPayment(d, fixture().claim));
  }
});
async function route(path, overrides = {}, method = "GET") {
  let calls = 0, auth = 0; const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(v) { this.body = JSON.parse(v); } };
  const routed = await dispatchClubRewardRoutes({ method, headers: {} }, res, new URL(path, config.origin), {
    config: () => config, requireIdentity: async () => { auth++; return identity; }, applyPrivateSessionHeaders,
    readJsonBody: async () => { assert.fail("read must not consume a body"); },
    sendSuccess: (r, data) => r.end(JSON.stringify({ data })), sendError: (r, status, code, message) => { r.statusCode = status; r.end(JSON.stringify({ error: { code, message } })); },
    rpc: async name => { calls++; return { data: name.endsWith("payment_status") ? fixture() : { items: [name.endsWith("awards") ? award() : fixture().claim], nextCursor: null }, error: null }; }, ...overrides,
  }); return { ...res, calls, auth, routed };
}
const paths = [`/api/v1/athlete/rewards/club-awards/${id(7)}`, "/api/v1/athlete/rewards/club-claims", `/api/v1/athlete/rewards/club-claims/${id(10)}/payment`];
test("club read routes are demo-only, no-store, authenticated and strict about scope, pagination and read methods", async () => {
  for (const path of paths) {
    const r = await route(path); assert.equal(r.statusCode, 200); assert.equal(r.calls, 1); assert.equal(r.headers["Cache-Control"], "private, no-store");
    assert.equal((await route(path, {}, "POST")).routed, false);
    const disabled = await route(path, { config: () => null }); assert.equal(disabled.routed, false); assert.equal(disabled.auth, 0); assert.equal(disabled.calls, 0);
    for (const q of ["?chainId=143", "?userId=other", "?role=operator", "?after=bad", `?after=${id(1)}&after=${id(1)}`]) {
      const bad = await route(path + q); assert.equal(bad.statusCode, 400); assert.equal(bad.calls, 0);
    }
  }
  assert.equal((await route(paths[2] + `?after=${id(1)}`)).statusCode, 400);
  assert.equal((await route(paths[0].replace(id(7), "bad"))).statusCode, 400);
});
test("club read errors mask provider details and distinguish session, ownership and absent original claim", async () => {
  for (const [message, status] of [["reward_account_session_required", 401], ["reward_club_owner_required", 403], ["reward_payment_status_not_found", 404], ["private provider detail", 503]]) {
    const r = await route(message === "reward_club_owner_required" ? paths[0] : paths[2], { rpc: async () => ({ data: null, error: { message } }) }); assert.equal(r.statusCode, status); assert.doesNotMatch(JSON.stringify(r.body), /private provider/);
  }
  for (const [message, status] of [["Unauthorized", 401], ["Untrusted browser origin", 403]]) {
    const r = await route(paths[0], { requireIdentity: async () => { throw Error(message); } }); assert.equal(r.statusCode, status); assert.equal(r.calls, 0);
  }
  let calls = 0; const never = async () => { calls++; throw Error("unexpected"); };
  await assert.rejects(listRewardClubAwards(identity, { chainId: 143, clubId: id(7) }, never));
  await assert.rejects(listRewardClubClaims(identity, { chainId: 31337, afterId: "bad" }, never));
  await assert.rejects(readRewardClubPaymentStatus(identity, { chainId: 143, intentId: id(10) }, never)); assert.equal(calls, 0);
});
