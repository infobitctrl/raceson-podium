import assert from "node:assert/strict";
import test from "node:test";
import { toHex } from "viem";
import { requestRewardClubTreasury, readRewardClubTreasury, listRewardClubTreasuries, withdrawRewardClubTreasury, listRewardOwnedClubs } from "../../../packages/db/dist/rewards/index.js";
import { nominateClubRewardTreasury } from "../dist/features/rewards/club-treasury-service.js";
import { dispatchClubRewardRoutes } from "../dist/routes/rewards/clubs.js";
import { applyPrivateSessionHeaders } from "../dist/browser-session.js";
const id = n => `7c100000-0000-4000-8000-${String(n).padStart(12, "0")}`, a = n => toHex(BigInt(n), { size: 20 });
const base = "/api/v1/athlete/rewards/club-treasury-requests";
function fixture() {
  const identity = { userId: id(1), sessionId: id(2) }, config = { chainId: 31337, origin: "http://127.0.0.1:3101" };
  const candidate = { safeAddress: a(10), singletonAddress: a(11), fallbackHandlerAddress: a(12), owners: [a(20), a(21), a(22)] };
  const input = { clubId: id(3), candidate: structuredClone(candidate), idempotencyKey: "club-nomination-test" };
  const stored = { requestId: id(4), ...identity, clubId: id(3), chainId: 31337, candidate, idempotencyKey: input.idempotencyKey,
    requestedAt: "2026-09-09T01:00:00Z", withdrawnAt: null, status: "pending_review" };
  const calls = [], rpc = async (name, args) => {
    calls.push({ name, args: structuredClone(args) }); const data = structuredClone(stored);
    if (name === "service_list_reward_owned_clubs") return { data: { chainId: 31337, items: [{ clubId: id(3), name: "Synthetic treasury club" }], nextCursor: null }, error: null };
    if (name === "service_withdraw_reward_club_treasury") Object.assign(data, { status: "withdrawn", withdrawnAt: "2026-09-09T01:01:00Z" });
    return { data: name === "service_list_reward_club_treasuries" ? { items: [data], nextCursor: null } : data, error: null };
  };
  return { identity, config, candidate, input, stored, calls, rpc, nomination: { clubId: input.clubId, ...structuredClone(candidate), idempotencyKey: input.idempotencyKey } };
}
async function route(f, method, path, body = {}, overrides = {}) {
  const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(value) { this.body = JSON.parse(value); } };
  const routed = await dispatchClubRewardRoutes({ method, headers: {} }, res, new URL(path, f.config.origin), {
    config: () => f.config, requireIdentity: async () => f.identity, readJsonBody: async () => body, applyPrivateSessionHeaders, rpc: f.rpc,
    sendSuccess: (r, data) => r.end(JSON.stringify({ data })), sendError: (r, status, code, message) => { r.statusCode = status; r.end(JSON.stringify({ error: { code, message } })); }, ...overrides,
  });
  return { ...res, routed };
}
test("club nomination stores only normalized candidate addresses and never claims verified control", async () => {
  const f = fixture(); f.nomination.owners.reverse();
  const result = await nominateClubRewardTreasury(f.identity, f.nomination, { ...f.config, rpc: f.rpc });
  assert.equal(result.status, "pending_review"); assert.deepEqual(result.candidate, f.candidate);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].name, "service_request_reward_club_treasury");
  assert.deepEqual(f.calls[0].args.p_candidate, f.candidate);
  assert.doesNotMatch(JSON.stringify(result), /userId|sessionId|owner_identity|idempotencyKey|signature|privateKey|approved|verified/);
});
test("owner discovery returns only named club choices and binds private account, network and cursor", async () => {
  const f = fixture(), path = "/api/v1/athlete/rewards/owned-clubs";
  const r = await route(f, "GET", path); assert.equal(r.statusCode, 200); assert.equal(r.headers["Cache-Control"], "private, no-store");
  assert.deepEqual(r.body.data, { chainId: 31337, items: [{ clubId: id(3), name: "Synthetic treasury club" }], nextCursor: null });
  assert.deepEqual(f.calls[0].args, { p_user_id: f.identity.userId, p_session_id: f.identity.sessionId, p_chain_id: 31337, p_after_id: null });
  for (const query of ["?chainId=143", "?after=bad", `?after=${id(3)}&after=${id(3)}`]) assert.equal((await route(f, "GET", path + query)).statusCode, 400);
  assert.equal((await route(f, "GET", path, {}, { requireIdentity: async () => { throw Error("Unauthorized"); } })).statusCode, 401);
  const page = r.body.data;
  for (const bad of [{ ...page, chainId: 10143 }, { ...page, nextCursor: id(3) }, { ...page, items: [{ ...page.items[0], userId: id(1) }] },
    { ...page, items: [page.items[0], page.items[0]] }, { ...page, items: [{ ...page.items[0], name: " " }] }])
    await assert.rejects(listRewardOwnedClubs(f.identity, 31337, null, async () => ({ data: bad, error: null })));
  await assert.rejects(listRewardOwnedClubs(f.identity, 31337, id(3), f.rpc));
});
test("nomination rejects invalid, duplicate, sentinel, zero, self-owner and conflated addresses before storage", async () => {
  const f = fixture();
  for (const patch of [{ owners: [a(20), a(20), a(22)] }, { owners: [a(1), a(21), a(22)] }, { owners: [a(10), a(21), a(22)] },
    { owners: [a(20), a(21)] }, { safeAddress: a(0) }, { singletonAddress: a(1) }, { singletonAddress: a(10) }, { safeAddress: "no-wallet" }])
    await assert.rejects(nominateClubRewardTreasury(f.identity, { ...f.nomination, ...patch }, { ...f.config, rpc: f.rpc }), { code: "invalid_reward_club_treasury_request" });
  assert.equal(f.calls.length, 0);
});
test("repository freezes candidate/actor inputs and permits exact same-account history from a new session", async () => {
  const f = fixture(), original = structuredClone(f.input);
  const rpc = async (name, args) => { f.input.candidate.owners[0] = a(99); f.identity.userId = id(99); return f.rpc(name, args); };
  assert.deepEqual((await requestRewardClubTreasury(f.identity, 31337, f.input, rpc)).candidate, original.candidate);
  assert.equal(f.calls[0].args.p_user_id, id(1)); assert.deepEqual(f.calls[0].args.p_candidate, original.candidate);
  f.identity = { userId: id(1), sessionId: id(9) };
  assert.equal((await requestRewardClubTreasury(f.identity, 31337, original, f.rpc)).sessionId, id(2));
  assert.equal((await readRewardClubTreasury(f.identity, 31337, id(4), f.rpc)).requestId, id(4));
  assert.equal((await withdrawRewardClubTreasury(f.identity, 31337, id(4), f.rpc)).status, "withdrawn");
});
test("private history decoder refuses wrong actor/network/request/candidate and invented approval states", async () => {
  const f = fixture();
  for (const patch of [{ userId: id(99) }, { chainId: 10143 }, { requestId: id(99) }, { status: "approved" },
    { candidate: { ...f.candidate, proof: "untrusted" } }, { status: "withdrawn" }, { withdrawnAt: "2026-09-08T00:00:00Z" }, { extra: "private" }])
    await assert.rejects(readRewardClubTreasury(f.identity, 31337, id(4), async () => ({ data: { ...f.stored, ...patch }, error: null })));
  await assert.rejects(requestRewardClubTreasury(f.identity, 31337, f.input, async () => ({ data: { ...f.stored, clubId: id(99) }, error: null })));
});
test("25-row history pagination is chain-scoped, ordered and binds the returned cursor", async () => {
  const f = fixture(), items = Array.from({ length: 25 }, (_, n) => ({ ...f.stored, requestId: id(100 + n) }));
  const page = { items, nextCursor: id(124) }, rpc = async (_name, args) => { assert.equal(args.p_chain_id, 31337); return { data: page, error: null }; };
  assert.equal((await listRewardClubTreasuries(f.identity, 31337, null, rpc)).nextCursor, id(124));
  for (const invalid of [{ items: [...items, { ...f.stored, requestId: id(125) }], nextCursor: null }, { items: [...items].reverse(), nextCursor: null },
    { items, nextCursor: id(125) }, { items: items.slice(0, 2), nextCursor: id(101) }])
    await assert.rejects(listRewardClubTreasuries(f.identity, 31337, null, async () => ({ data: invalid, error: null })));
  await assert.rejects(listRewardClubTreasuries(f.identity, 31337, id(100), rpc));
});
test("demo nomination, read, history and withdrawal expose only private pending/held/withdrawn records", async () => {
  const f = fixture();
  for (const [method, path, body] of [["POST", base, f.nomination], ["GET", base, {}], ["GET", `${base}/${id(4)}`, {}], ["POST", `${base}/${id(4)}/withdraw`, {}]]) {
    const r = await route(f, method, path, body); assert.equal(r.statusCode, 200); assert.equal(r.routed, true);
    assert.equal(r.headers["Cache-Control"], "private, no-store"); assert.doesNotMatch(JSON.stringify(r.body), /userId|sessionId|idempotencyKey|ownerIdentity|signature/);
  }
});
test("routes reject client control/proof/chain/amount fields, bad paths, query injection and disabled/authless access", async () => {
  const f = fixture();
  for (const patch of [{ userId: id(99) }, { chainId: 10143 }, { ownerIdentity: {} }, { approved: true }, { signature: "0xaa" }, { threshold: 1 }, { amountWei: "1000" }])
    assert.equal((await route(f, "POST", base, { ...f.nomination, ...patch })).statusCode, 400);
  for (const path of [`${base}/bad`, `${base}?after=bad`, `${base}?after=${id(4)}&after=${id(4)}`, `${base}/${id(4)}?chainId=10143`])
    assert.equal((await route(f, "GET", path)).statusCode, 400);
  assert.equal((await route(f, "POST", `${base}/${id(4)}/withdraw`, { approved: true })).statusCode, 400);
  assert.equal((await route(f, "POST", base, f.nomination, { config: () => null })).routed, false);
  assert.equal((await route(f, "GET", base, {}, { requireIdentity: async () => { throw Error("Unauthorized"); } })).statusCode, 401);
  assert.equal(f.calls.length, 0);
});
test("routes distinguish ownership/auth/missing/conflict while keeping RPC failures and corrupt stored data private", async () => {
  const f = fixture();
  for (const [message, status] of [["reward_account_session_required", 401], ["reward_club_owner_required", 403], ["reward_club_treasury_not_found", 404],
    ["reward_club_treasury_withdraw_first", 409], ["reward_ledger_idempotency_conflict", 409], ["private SQL identity detail", 503]]) {
    const r = await route(f, "GET", `${base}/${id(4)}`, {}, { rpc: async () => ({ data: null, error: { message } }) });
    assert.equal(r.statusCode, status); assert.doesNotMatch(JSON.stringify(r.body), /private SQL/);
  }
  const r = await route(f, "GET", `${base}/${id(4)}`, {}, { rpc: async () => ({ data: { ...f.stored, userId: id(99) }, error: null }) });
  assert.equal(r.statusCode, 503);
  await assert.rejects(readRewardClubTreasury(f.identity, 31337, id(4), async () => { throw Error("secret network credentials"); }),
    e => e.code === "reward_ledger_unavailable" && !e.cause && !e.message.includes("secret"));
});
