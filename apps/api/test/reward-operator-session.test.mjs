import assert from "node:assert/strict";
import test from "node:test";
import { withRewardOperatorSession } from "../../../packages/db/dist/rewards/index.js";
import { runStoredRewardOperatorJob } from "../dist/features/rewards/operator-runner.js";
import { calculationFixture, rewardId as id } from "./fixtures/reward-calculation.mjs";

const identity = { userId: id(4), sessionId: id(99501) };
const method = "service_step_reward_deployment_job";
const args = () => ({ p_job_id: id(1), p_actor_user_id: id(4), p_worker_id: id(2), p_lease_token: null, p_action: "lease" });
const envelope = (name, result) => ({ schemaVersion: 1, actorUserId: identity.userId, actorSessionId: identity.sessionId, method: name, result });

test("operator session transport freezes identity/arguments and retains SQL NULL and private result semantics", async () => {
  const mutable = { ...identity }; const input = args(); let sent;
  const rpc = withRewardOperatorSession(mutable, async (name, parameters) => {
    assert.equal(name, "service_reward_operator_session_call"); sent = parameters;
    await Promise.resolve(); return { data: envelope(method, null), error: null };
  });
  const result = rpc(method, input);
  mutable.sessionId = id(9); input.p_action = "arm";
  assert.deepEqual(await result, { data: null, error: null });
  assert.deepEqual(sent, { p_actor_user_id: identity.userId, p_actor_session_id: identity.sessionId, p_method: method, p_arguments: args() });
});

test("session transport cannot dispatch signing, creation, arbitrary methods or another actor/session", async () => {
  let calls = 0;
  const rpc = withRewardOperatorSession(identity, async () => { calls++; throw new Error("must not run"); });
  for (const name of ["service_queue_reward_deployment_job", "service_reserve_reward_deployment", "service_create_reward_programme",
    "service_next_reward_operator_job", "service_reward_operator_session_call", "pg_sleep", "service_step_reward_deployment_job);--"]) {
    await assert.rejects(rpc(name, args()), { code: "invalid_reward_operator_session_call" });
  }
  for (const input of [{ ...args(), p_actor_user_id: id(5) }, { ...args(), p_actor_session_id: id(9) },
    { ...args(), p_action: "x".repeat(131073) }, []]) {
    await assert.rejects(rpc(method, input), { code: "invalid_reward_operator_session_call" });
  }
  assert.equal(calls, 0);
});

test("session transport rejects cross-session/method and extra-field response envelopes", async () => {
  for (const patch of [{ actorUserId: id(5) }, { actorSessionId: id(9) }, { method: "service_create_reward_programme" },
    { schemaVersion: 2 }, { secret: "synthetic-only" }]) {
    const rpc = withRewardOperatorSession(identity, async () => ({ data: { ...envelope(method, null), ...patch }, error: null }));
    await assert.rejects(rpc(method, args()));
  }
  const rpc = withRewardOperatorSession(identity, async () => ({ data: null, error: { message: "reward_account_session_required" } }));
  assert.deepEqual(await rpc(method, args()), { data: null, error: { message: "reward_account_session_required" } });
});

test("every default stored-job adapter uses session-wrapped reads before any chain or broadcast access", async () => {
  const session = calculationFixture().session;
  for (const kind of ["deployment", "funding", "lifecycle", "athlete_payment"]) {
    const calls = [];
    const job = { kind, jobId: id(99801), campaignId: id(99901), intentId: id(99001), attemptId: id(99101),
      transactionHash: `0x${"ab".repeat(32)}`, signerAddress: `0x${"1".repeat(40)}`, nonce: 0n, state: "queued" };
    await assert.rejects(runStoredRewardOperatorJob(session, identity, job,
      { programmeId: id(99800), workerId: id(99899), maxJobs: 1, deadlineMs: Date.now() + 60000 }, {
        rpc: async (name, input) => {
          calls.push(name); assert.equal(name, "service_reward_operator_session_call");
          assert.equal(input.p_actor_session_id, identity.sessionId); assert.equal(input.p_arguments.p_job_id, job.jobId);
          return { data: null, error: { message: "reward_account_session_required" } };
        },
        broadcast: () => { assert.fail("no send after session denial"); },
        reader: new Proxy({}, { get() { assert.fail("no chain read after session denial"); } }),
      }));
    assert.deepEqual(calls, ["service_reward_operator_session_call"]);
  }
});
