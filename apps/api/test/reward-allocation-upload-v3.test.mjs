import assert from "node:assert/strict";
import test from "node:test";
import { dispatchRewardPlanningRoutes } from "../dist/routes/rewards/planning.js";
import { readAllocationUploadV3 } from "../../../packages/db/dist/rewards/index.js";
const id = n => `8d000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const identity = { userId: id(1), sessionId: id(2) }, digest = "a".repeat(64);
const scope = { chainId: 31337, draftId: id(3), slot: 1, approvalId: id(4) };
const body = { requestId: id(5), contextHash: digest, documentHash: digest };

test("V3 preparation HTTP permits exact expectations only, with Auth, origin, network and private error boundaries", async () => {
  const request = async ({ payload = body, method = "POST", query = "", slot = 1, approvalId = scope.approvalId,
    authError, rpcError = "private provider text" } = {}) => {
    const response = {}, calls = [];
    const handled = await dispatchRewardPlanningRoutes({ method }, response,
      new URL(`http://127.0.0.1:3101/api/v1/organizer/rewards/drafts/${scope.draftId}/allocation-upload/${slot}/${approvalId}${query}`), {
        config: () => ({ chainId: 31337 }), requireIdentity: async () => { if (authError) throw Error(authError); return identity; },
        readJsonBody: async () => payload, applyPrivateSessionHeaders: () => response.private = true,
        sendSuccess: (_, data) => Object.assign(response, { status: 200, data }), sendError: (_, status, code) => Object.assign(response, { status, code }),
        rpc: async (name, args) => { calls.push({ name, args }); return { data: null, error: { message: rpcError } }; } });
    return { response, calls, handled };
  };
  for (const extra of [{ amountWei: "1" }, { wallet: `0x${"1".repeat(40)}` }, { reviewStartedAt: 1 }, { officialPublishedAt: 1 },
    { package: {} }, { chainId: 143 }, { contextHash: "a" }, { documentHash: 1 }]) {
    const result = await request({ payload: { ...body, ...extra } });
    assert.equal(result.response.status, 400); assert.equal(result.calls.length, 0);
  }
  assert.equal((await request({ payload: { ...body, requestId: "00000000-0000-0000-0000-000000000000" } })).response.status, 400);
  for (const authError of ["Unauthorized", "Missing bearer token"]) {
    const r = await request({ authError }); assert.equal(r.response.status, 401); assert.equal(r.calls.length, 0);
  }
  assert.equal((await request({ authError: "Untrusted browser origin" })).response.status, 403);
  assert.equal((await request({ query: "?chainId=143" })).response.status, 400);
  assert.equal((await request({ approvalId: "missing" })).response.status, 400);
  for (const slot of [0, 5, 6]) assert.equal((await request({ slot })).handled, false);
  for (const method of ["PATCH", "DELETE"]) assert.equal((await request({ method })).handled, false);
  for (const code of ["reward_allocation_upload_conflict", "reward_allocation_not_ready", "reward_planning_revision_changed"])
    assert.equal((await request({ rpcError: code })).response.status, 409);
  for (const code of ["reward_allocation_upload_not_found", "reward_planning_not_found"])
    assert.equal((await request({ rpcError: code })).response.status, 404);
  const r = await request({ method: "GET" }); assert.equal(r.response.status, 503); assert.equal(r.response.private, true);
  assert.doesNotMatch(JSON.stringify(r.response), /private provider text/);
  assert.deepEqual(r.calls[0], { name: "service_read_reward_allocation_upload_v3", args: {
    p_actor_user_id: identity.userId, p_actor_session_id: identity.sessionId, p_chain_id: 31337,
    p_draft_id: scope.draftId, p_slot: 1, p_approval_id: scope.approvalId } });
});

test("private V3 export refuses unsupported scopes before RPC and sanitizes provider failures", async () => {
  for (const patch of [{ chainId: 143 }, { chainId: 1 }, { slot: 5 }, { slot: 1.5 }, { approvalId: "00000000-0000-0000-0000-000000000000" }]) {
    let called = false;
    await assert.rejects(readAllocationUploadV3(identity, { ...scope, ...patch }, async () => { called = true; throw Error("never"); }));
    assert.equal(called, false);
  }
  await assert.rejects(readAllocationUploadV3(identity, scope, async () => { throw Error("credential-bearing provider message"); }), { code: "reward_ledger_unavailable" });
  await assert.rejects(readAllocationUploadV3(identity, scope, async () => ({ data: { secret: "redacted" }, error: null })));
});
