import assert from "node:assert/strict";
import test from "node:test";
import { rewardId as id } from "./fixtures/reward-calculation.mjs";
import { listRewardOperatorProgrammes, listRewardOperatorDestinations } from "@raceson/db/rewards";
import { dispatchOrganizerRewardRoutes } from "../dist/routes/rewards/organizer.js";

const base = "/api/v1/organizer/rewards/programmes";
const destPath = `${base}/${id(9)}/destinations`;
function fixture(kind = "programmes") {
  const item = kind === "programmes" ? { programmeId: id(9), organizationId: id(1), seasonId: id(3), year: 2026,
    leagueName: "Šibenik Trail League", seasonName: "2026", budgetWei: "100000000000000000001", createdAt: "2026-09-08T09:00:00Z" }
    : { requestId: id(7), athleteProfileId: id(8), athleteName: "Synthetic runner", address: `0x${"12".repeat(20)}`,
      requestedAt: "2026-09-08T09:00:00Z", destinationStatus: "pending_review" };
  return { identity: { userId: id(4), sessionId: id(5) }, config: { chainId: 31337, origin: "http://127.0.0.1:5173" },
    input: { chainId: 31337, programmeId: id(9) }, calls: [], kind,
    data: { ...(kind === "destinations" ? { programmeId: id(9) } : {}), chainId: 31337, items: [item], nextCursor: null } };
}
function rpcFor(f) { return async (method, args) => {
  f.calls.push({ method, args }); return { data: f.data, error: null };
}; }
const list = f => (f.kind === "programmes" ? listRewardOperatorProgrammes : listRewardOperatorDestinations)(f.identity, f.input, rpcFor(f));
async function http(f, { url = f.kind === "programmes" ? base : destPath, method = "GET", config = f.config,
  identity = async () => f.identity, rpc = rpcFor(f) } = {}) {
  const res = { status: 200, body: null, private: false }; let reads = 0;
  const handled = await dispatchOrganizerRewardRoutes({ method }, res, new URL(url, f.config.origin), {
    config: () => config, requireIdentity: identity, rpc, readJsonBody: async () => { reads++; throw Error("No body allowed"); },
    applyPrivateSessionHeaders: r => { r.private = true; }, sendSuccess: (r, body) => { r.body = body; },
    sendError: (r, status, code, message) => { r.status = status; r.body = { error: { code, message } }; },
  });
  assert.equal(reads, 0); return { ...res, handled };
}

for (const kind of ["programmes", "destinations"]) {
  test(`organizer ${kind} discovery returns only bounded display metadata and fixed scope`, async () => {
    const f = fixture(kind), response = await http(f);
    assert.equal(response.status, 200); assert.equal(response.private, true); assert.deepEqual(response.body, f.data);
    assert.doesNotMatch(JSON.stringify(response.body), /sessionId|userId|signature|dateOfBirth|birthYear|EvidenceRef|nonce|idempotency|privateKey/);
    assert.deepEqual(f.calls, [{ method: `service_list_reward_operator_${kind}`, args: {
      p_actor_user_id: id(4), p_actor_session_id: id(5), p_chain_id: 31337, p_after_id: null,
      ...(kind === "destinations" ? { p_programme_id: id(9) } : {}),
    } }]);
    if (kind === "programmes") assert.equal(response.body.items[0].budgetWei, "100000000000000000001");
  });
  test(`organizer ${kind} pagination rejects duplicate, out-of-order, short-page and foreign cursors`, async () => {
    const f = fixture(kind), key = kind === "programmes" ? "programmeId" : "requestId", item = f.data.items[0];
    f.input.afterId = id(99);
    f.data.items = Array.from({ length: 25 }, (_, i) => ({ ...item, [key]: id(100 + i) })); f.data.nextCursor = id(124);
    assert.equal((await list(f)).nextCursor, id(124));
    for (const mutate of [d => { d.items.push({ ...item, [key]: id(125) }); }, d => { d.items[1][key] = id(100); },
      d => { d.items[0][key] = id(99); }, d => { d.items.reverse(); }, d => { d.nextCursor = id(125); },
      d => { d.items.pop(); d.nextCursor = id(123); }]) {
      const bad = fixture(kind); bad.input = f.input; bad.data = structuredClone(f.data); mutate(bad.data);
      await assert.rejects(list(bad));
    }
    f.data.items = []; f.data.nextCursor = null; assert.deepEqual((await list(f)).items, []);
  });
  test(`organizer ${kind} strict decoding rejects leaked fields, malformed scope and lossy values`, async () => {
    const edits = [d => { d.privateProof = "secret"; }, d => { d.items[0].sessionId = id(1); },
      d => { d.chainId = 10143; }, d => { d.nextCursor = "invalid"; },
      d => { d.items[0][kind === "programmes" ? "createdAt" : "requestedAt"] = "yesterday"; },
      ...(kind === "programmes" ? [d => { d.items[0].budgetWei = 100; }, d => { d.items[0].budgetWei = "8"; },
        d => { d.items[0].budgetWei = "1.1"; }, d => { d.items[0].year = "2026"; }, d => { d.items[0].leagueName = "a".repeat(257); }]
        : [d => { d.programmeId = id(99); }, d => { d.items[0].address = `0x${"00".repeat(20)}`; },
          d => { d.items[0].destinationStatus = "paid"; }, d => { d.items[0].athleteName = ""; }]),
    ];
    for (const edit of edits) { const f = fixture(kind); edit(f.data); assert.equal((await http(f)).status, 503); }
  });
  test(`organizer ${kind} fixes all caller scope before asynchronous persistence`, async () => {
    const f = fixture(kind), original = structuredClone(f.data), rpc = async (method, args) => {
      assert.equal(args.p_actor_user_id, id(4)); assert.equal(args.p_chain_id, 31337);
      f.identity.userId = id(99); f.input.chainId = 10143; f.input.programmeId = id(99); f.input.afterId = id(99);
      return { data: original, error: null };
    };
    const result = await (kind === "programmes" ? listRewardOperatorProgrammes : listRewardOperatorDestinations)(f.identity, f.input, rpc);
    assert.deepEqual(result, original);
  });
  test(`organizer ${kind} authentication, permission and private failures use safe responses`, async () => {
    const f = fixture(kind);
    assert.equal((await http(f, { identity: async () => { throw Error("Unauthorized"); } })).status, 401);
    assert.equal(f.calls.length, 0);
    for (const [code, status] of [["reward_account_session_required", 401], ["reward_operator_permission_required", 403],
      ["reward_readiness_scope_required", 404], ["private SQL secret", 503]]) {
      const r = await http(f, { rpc: async () => ({ data: null, error: { message: code } }) });
      assert.equal(r.status, status); assert.deepEqual(Object.keys(r.body), ["error"]); assert.doesNotMatch(JSON.stringify(r), /private SQL secret/);
    }
    assert.equal((await http(f, { rpc: async () => { throw Error("private transport secret"); } })).status, 503);
  });
}
test("discovery accepts exactly one optional UUID cursor; no arbitrary filters, mutations or disabled IO", async () => {
  for (const kind of ["programmes", "destinations"]) {
    const f = fixture(kind), path = kind === "programmes" ? base : destPath;
    assert.equal((await http(f, { config: null })).handled, false);
    for (const method of ["POST", "PUT", "DELETE", "PATCH"]) assert.equal((await http(f, { method })).handled, false);
    for (const query of ["?after=", "?after=bad", `?after=${id(1)}&after=${id(2)}`, "?chainId=143", "?userId=x", "?limit=100"])
      assert.equal((await http(f, { url: path + query })).status, 400);
    assert.equal(f.calls.length, 0);
    const r = await http(f, { url: path + `?after=${id(1)}` }); assert.equal(r.status, 200);
    assert.equal(f.calls[0].args.p_after_id, id(1));
  }
});
test("discovery freezes server network even when verified identity resolution yields", async () => {
  const f = fixture();
  const r = await http(f, { identity: async () => { f.config.chainId = 10143; return f.identity; } });
  assert.equal(r.status, 200); assert.equal(r.body.chainId, 31337);
});
