import assert from "node:assert/strict";
import test from "node:test";
import { programmeDeploymentFixtureV3, programmeTestId as id } from "./fixtures/programme-deployment-v3.mjs";
import { readProgrammeJobV3, queueProgrammeJobV3, stepProgrammeJobV3, readProgrammeRegistryV3 } from "../../../packages/db/dist/rewards/index.js";
import { readRegisteredProgrammeFundingV3 } from "../dist/features/rewards/programme-registry-v3-service.js";
import { runProgrammeDeploymentJobV3 } from "../dist/features/rewards/programme-worker-v3.js";
import { dispatchRewardPlanningRoutes } from "../dist/routes/rewards/planning.js";
const identity = () => ({ userId: id(4), sessionId: id(5) });
const scope = () => ({ chainId: 31337, draftId: id(1), intentId: id(81) });
const selected = () => ({ ...scope(), jobId: id(90), attemptId: id(91), workerId: id(92) });
const job = (state = "queued") => ({ jobId: id(90), intentId: id(81), attemptId: id(91), transactionHash: `0x${"c".repeat(64)}`,
  createdByUserId: id(4), createdAt: "2026-09-10T00:03:00Z", state, mayHaveBroadcast: state === "confirmed",
  leaseOwner: state === "leased" ? id(92) : null, leaseToken: state === "leased" ? id(93) : null,
  leaseExpiresAt: state === "leased" ? "2026-09-10T00:04:00Z" : null, leaseGeneration: state === "queued" ? 0 : 1 });
const ok = data => async () => ({ data, error: null });
test("programme job queue/read validates exact identity without accepting signed bytes", async () => {
  assert.equal(await readProgrammeJobV3(identity(), scope(), ok(null)), null);
  assert.deepEqual(await queueProgrammeJobV3(identity(), selected(), ok(job())), job());
  for (const patch of [{ jobId: id(99) }, { attemptId: id(99) }, { createdByUserId: id(99) }, { signedTransaction: "forbidden" }, { state: "paid" }])
    await assert.rejects(queueProgrammeJobV3(identity(), selected(), ok({ ...job(), ...patch })));
});
test("programme lease decoder refuses mismatched tokens, invalid state and mixed nullable fields", async () => {
  const input = { ...selected(), action: "lease", leaseToken: null };
  assert.equal(await stepProgrammeJobV3(identity(), input, ok(null)), null);
  assert.equal((await stepProgrammeJobV3(identity(), input, ok(job("leased")))).leaseToken, id(93));
  for (const patch of [{ leaseOwner: id(99) }, { leaseToken: null }, { leaseGeneration: 0 }, { mayHaveBroadcast: "true" }, { state: "submitted" }])
    await assert.rejects(stepProgrammeJobV3(identity(), input, ok({ ...job("leased"), ...patch })));
  await assert.rejects(stepProgrammeJobV3(identity(), { ...input, action: "arm", leaseToken: id(94) }, ok({ ...job("leased"), state: "broadcasting", mayHaveBroadcast: true })));
});
test("programme job captures scope before awaiting transport and redacts provider detail", async () => {
  const a = identity(), input = selected();
  await queueProgrammeJobV3(a, input, async (_, args) => {
    a.userId = id(99); input.jobId = id(99); assert.equal(args.p_actor_user_id, id(4)); assert.equal(args.p_job_id, id(90));
    return { data: job(), error: null };
  });
  await assert.rejects(readProgrammeJobV3(identity(), scope(), async () => { throw Error("private endpoint and secret"); }), { code: "reward_ledger_unavailable" });
  await assert.rejects(readProgrammeJobV3(identity(), scope(), async () => ({ data: null, error: { message: "private transaction bytes" } })), { code: "reward_ledger_unavailable" });
});
test("confirmed programme job is durable history, not another broadcast request", async () => {
  const result = await runProgrammeDeploymentJobV3(identity(), selected(), { rpc: ok(job("confirmed")),
    reader: { getChainId() { throw Error("must not read chain"); } }, broadcast() { throw Error("must not broadcast"); } });
  assert.deepEqual(result, { jobId: id(90), outcome: "confirmed" });
  assert.doesNotMatch(JSON.stringify(result), /leaseToken|signedTransaction/);
});
test("registered funding without a deployment remains unknown and needs no RPC provider", async () => {
  const context = programmeDeploymentFixtureV3(), rpc = ok({ schema: "raceson-programme-registry-v3", context, registry: null });
  const result = await readRegisteredProgrammeFundingV3(identity(), context.approvalView.record, { rpc });
  assert.equal(result.status, "awaiting_deployment"); assert.equal(result.observation, null); assert.equal(result.operationsEnabled, false);
});
test("registry read rejects wrong scope and cannot leak an unexpected signed payload", async () => {
  for (const mutate of [v => { v.signedTransaction = "never"; }, v => { v.context.approvalView.record.draftId = id(99); }, v => { v.context.intent.chainId = 10143; }]) {
    const r = { schema: "raceson-programme-registry-v3", context: programmeDeploymentFixtureV3(), registry: null }; mutate(r);
    await assert.rejects(readProgrammeRegistryV3(identity(), scope(), ok(r)));
  }
});
test("normal funding route consults the persisted registry and rechecks Auth, without a test binding or provider", async () => {
  for (const revoke of [false, true]) {
    const context = programmeDeploymentFixtureV3(), response = {}, calls = [];
    await dispatchRewardPlanningRoutes({ method: "GET" }, response,
      new URL(`http://127.0.0.1:3101/api/v1/organizer/rewards/drafts/${id(1)}/funding`), {
        config: () => ({ chainId: 31337, origin: "http://127.0.0.1:3101" }), requireIdentity: async () => identity(),
        readJsonBody: async () => { throw Error("must not read a body"); }, applyPrivateSessionHeaders: () => { response.private = true; },
        sendSuccess: (_, data) => Object.assign(response, { status: 200, data }), sendError: (_, status, code) => Object.assign(response, { status, code }),
        rpc: async (name, args) => {
          calls.push(name); assert.equal(args.p_actor_session_id, id(5));
          if (revoke && calls.length === 3) return { data: null, error: { message: "reward_account_session_required" } };
          return { data: name === "service_read_reward_programme_registry_v3"
            ? { schema: "raceson-programme-registry-v3", context, registry: null } : context.approvalView.record, error: null };
        },
      });
    assert.deepEqual(calls, ["service_read_reward_planning_draft", "service_read_reward_programme_registry_v3", "service_read_reward_planning_draft"]);
    assert.equal(response.status, revoke ? 401 : 200); assert.equal(response.private, true);
    if (revoke) assert.equal(response.data, undefined); else assert.equal(response.data.status, "awaiting_deployment");
  }
});
