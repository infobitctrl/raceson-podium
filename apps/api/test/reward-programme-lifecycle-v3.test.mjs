import assert from "node:assert/strict";
import test from "node:test";
import { decodeProgrammeLifecycleBodyV3, readProgrammeLifecycleV3, reserveProgrammeLifecycleV3 } from "../../../packages/db/dist/rewards/index.js";
import { prepareProgrammeLifecycleV3 } from "../dist/features/rewards/programme-lifecycle-v3-service.js";
const id = n => `8c000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const identity = { userId: id(1), sessionId: id(2) };
const scope = { chainId: 31337, draftId: id(3), slot: 1, approvalId: id(4), uploadId: id(5), intentId: id(6) };
const body = { action: "complete_funding", batchStart: null, batchSize: null, packageHash: "a".repeat(64),
  gasLimit: "12000000", maxFeePerGas: "10000000000", maxPriorityFeePerGas: "0", maxGasCostWei: "200000000000000000" };

test("V3 stored closure/upload descriptors bind strict fee ceilings and bounded batches, never publication", () => {
  assert.equal(decodeProgrammeLifecycleBodyV3(body).action, "complete_funding");
  const upload = { ...body, action: "upload_awards", batchStart: 0, batchSize: 64 };
  assert.equal(decodeProgrammeLifecycleBodyV3(upload).batchSize, 64);
  for (const patch of [{ action: "stage_allocation" }, { action: "activate" }, { publication: {} }, { batchStart: 0 },
    { gasLimit: "0" }, { gasLimit: "30000001" }, { maxFeePerGas: "0" }, { maxPriorityFeePerGas: "10000000001" },
    { maxGasCostWei: "1" }, { gasLimit: 12000000 }, { gasLimit: "01" }, { packageHash: "private" }]) {
    assert.throws(() => decodeProgrammeLifecycleBodyV3({ ...body, ...patch }));
  }
  for (const patch of [{ batchStart: -1 }, { batchStart: 1.5 }, { batchStart: "0" }, { batchSize: 0 }, { batchSize: 65 }, { batchSize: null }])
    assert.throws(() => decodeProgrammeLifecycleBodyV3({ ...upload, ...patch }));
});
test("V3 descriptor rejects accessors and executable serializers without running them", async () => {
  let executed = false;
  for (const key of ["gasLimit", "action"]) {
    const malformed = { ...body }; Object.defineProperty(malformed, key, { enumerable: true, get() { executed = true; return body[key]; } });
    assert.throws(() => decodeProgrammeLifecycleBodyV3(malformed));
    await assert.rejects(prepareProgrammeLifecycleV3(identity, { ...scope, predecessorId: null, body: malformed }, { reader: {}, rpc: async () => { throw Error("not reached"); } }));
  }
  assert.equal(executed, false);
});
test("V3 lifecycle transport rejects mainnet and unsupported/unselected scopes before RPC", async () => {
  for (const patch of [{ chainId: 143 }, { chainId: 1 }, { slot: 0 }, { slot: 7 }, { slot: 1.5 }, { uploadId: "missing" },
    { intentId: "00000000-0000-0000-0000-000000000000" }]) {
    let called = false;
    await assert.rejects(readProgrammeLifecycleV3(identity, { ...scope, ...patch }, async () => { called = true; return { data: null, error: null }; }));
    assert.equal(called, false);
  }
});
test("final execution requires the SQL-verified source publication; a supplied clock grants no authority", async () => {
  for (const slot of [5, 6]) {
    let called = false;
    await assert.rejects(readProgrammeLifecycleV3(identity, { ...scope, slot }, async () => {
      called = true; return { data: null, error: { message: "reward_allocation_upload_not_found" } };
    }), { code: "reward_allocation_upload_not_found" });
    assert.equal(called, true);
    for (const action of ["stage_allocation", "activate"]) {
      const publication = { reviewId: id(7), publicationId: id(8), reviewPeriod: "0", reviewStartedAt: "1",
        officialPublishedAt: "1", publicationEvidenceHash: "0x" + "1".repeat(64) };
      let reserved = false;
      await assert.rejects(reserveProgrammeLifecycleV3(identity, { ...scope, slot }, { predecessorId: id(9),
        pendingNonce: 1n, body: { ...body, action, publication } }, async name => {
        assert.equal(name, "service_reserve_reward_programme_activation_v3"); reserved = true;
        return { data: null, error: { message: "reward_final_publication_required" } };
      }), { code: "reward_final_publication_required" });
      assert.equal(reserved, true);
      await assert.rejects(reserveProgrammeLifecycleV3(identity, { ...scope, slot }, { predecessorId: id(9),
        pendingNonce: 1n, body: { ...body, action, publication: { ...publication, officialPublishedAt: "0" } } },
      () => assert.fail("invalid clock must fail before RPC")), { code: "invalid_reward_programme_lifecycle" });
    }
  }
});
test("V3 private transport emits no provider error data and preserves explicit hold/Auth errors", async () => {
  const calls = [];
  const rpc = async (name, args) => { calls.push({ name, args }); return { error: { message: "private credentials in provider error" }, data: null }; };
  await assert.rejects(readProgrammeLifecycleV3(identity, scope, rpc), { code: "reward_ledger_unavailable" });
  assert.equal(calls[0].name, "service_read_reward_programme_lifecycle_v3");
  assert.equal(calls[0].args.p_actor_session_id, identity.sessionId);
  for (const message of ["reward_account_session_required", "reward_allocation_not_ready", "reward_programme_lifecycle_conflict"])
    await assert.rejects(readProgrammeLifecycleV3(identity, scope, async () => ({ error: { message }, data: null })), { code: message });
  await assert.rejects(readProgrammeLifecycleV3(identity, scope, async () => { throw Error("private endpoint"); }), { code: "reward_ledger_unavailable" });
});
test("V3 reservation rejects invalid nonces and accidental descriptor fields before RPC", async () => {
  for (const pendingNonce of [-1n, 9007199254740992n, 1, "1"]) {
    let called = false;
    await assert.rejects(reserveProgrammeLifecycleV3(identity, scope, { predecessorId: null, pendingNonce, body }, async () => { called = true; return { data: null, error: null }; }));
    assert.equal(called, false);
  }
  await assert.rejects(readProgrammeLifecycleV3(identity, scope, async () => ({ error: null, data: { privateKey: "never accepted" } })));
});
