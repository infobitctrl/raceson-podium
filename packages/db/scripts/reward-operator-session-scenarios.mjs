import assert from "node:assert/strict";
import { withRewardOperatorSession, nextRewardOperatorJob, readRewardDeploymentJob } from "../dist/rewards/index.js";
import { rewardId as id } from "../../../apps/api/test/fixtures/reward-calculation.mjs";
import { literal } from "./reward-integration-fixture.mjs";

export async function operatorSessionScenarios({ harness, scenario, programmeId, campaign, deploymentPlans, lifecycleJobs, roleBefore }) {
  const { query, scalar, rpc, rpcSql, lock, waiting } = harness;
  const identity = { userId: id(4), sessionId: id(99501) };
  const other = { userId: id(5), sessionId: id(99502) };
  // Scratch-only session rows, never usable credentials or imported Auth data.
  await query(`insert into auth.sessions(id,user_id,not_after) values
    (${literal(identity.sessionId)},${literal(identity.userId)},clock_timestamp()+interval '1 hour'),
    (${literal(other.sessionId)},${literal(other.userId)},clock_timestamp()+interval '1 hour');`);
  const scoped = withRewardOperatorSession(identity, rpc);
  const selector = { programmeId, chainId: 31337, excludedSigners: [] };
  const wrappedSql = (method, parameters) => rpcSql("service_reward_operator_session_call", {
    p_actor_user_id: identity.userId, p_actor_session_id: identity.sessionId, p_method: method, p_arguments: parameters,
  });
  const jobState = () => scalar(`select jsonb_build_object('job',to_jsonb(j),'events',
    (select count(*) from app_private.reward_lifecycle_job_events where job_id=j.id))
    from app_private.reward_lifecycle_jobs j where id=${literal(lifecycleJobs.activationJob.jobId)}`);
  try {
    await scenario("operator queue reads the first unconfirmed nonce in its programme and rejects other identities/chains", async () => {
      const selected = await nextRewardOperatorJob(identity, selector, rpc);
      // Rounds 2 and 3 were reserved concurrently. Their actual persisted nonce
      // order, not Promise.all input order, determines the next queued job.
      const first = deploymentPlans.get(2).nonce < deploymentPlans.get(3).nonce ? 2 : 3;
      assert.equal(selected.kind, "deployment"); assert.equal(selected.campaignId, campaign(first).id);
      assert.equal(selected.nonce, deploymentPlans.get(first).nonce);
      assert.notEqual(selected.state, "confirmed");
      assert.equal(await nextRewardOperatorJob(identity, { ...selector, excludedSigners: [selected.signerAddress] }, rpc), null);
      await assert.rejects(nextRewardOperatorJob(other, selector, rpc), { code: "reward_operator_permission_required" });
      await assert.rejects(nextRewardOperatorJob({ ...identity, sessionId: other.sessionId }, selector, rpc), { code: "reward_account_session_required" });
      await assert.rejects(nextRewardOperatorJob(identity, { ...selector, chainId: 10143 }, rpc), { code: "invalid_reward_operator_queue" });
      const read = await readRewardDeploymentJob({ jobId: selected.jobId, actorUserId: identity.userId }, scoped);
      assert.equal(read.transactionHash, selected.transactionHash);
      assert.equal(read.campaignId, selected.campaignId);
    });
    await scenario("session envelope is invoker/service-only and rejects arbitrary methods, arguments and stale isolation", async () => {
      const signature = "public.service_reward_operator_session_call(uuid,uuid,text,jsonb)";
      for (const role of ["anon", "authenticated"]) assert.equal(await scalar(`select has_function_privilege('${role}','${signature}','execute')`), false);
      assert.equal(await scalar(`select has_function_privilege('service_role','${signature}','execute')`), true);
      assert.deepEqual(await scalar(`select jsonb_build_object('definer',prosecdef,'volatility',provolatile::text,'config',proconfig)
        from pg_proc where oid='${signature}'::regprocedure`), { definer: false, volatility: "v", config: ['search_path=""'] });
      const selected = await nextRewardOperatorJob(identity, selector, rpc);
      const parameters = { p_job_id: selected.jobId, p_actor_user_id: identity.userId };
      const sql = wrappedSql("service_read_reward_deployment_job", parameters);
      const allowed = JSON.parse(await query(`begin; alter role service_role bypassrls; set local role service_role; ${sql} rollback;`));
      assert.equal(allowed.result.jobId, selected.jobId);
      assert.equal(await scalar("select rolbypassrls from pg_roles where rolname='service_role'"), roleBefore);
      for (const method of ["service_create_reward_programme", "service_next_reward_operator_job", "service_reward_operator_session_call", "pg_sleep", "service_read_reward_deployment_job);--"]) {
        await assert.rejects(query(wrappedSql(method, parameters)), { code: "invalid_reward_operator_session_call" });
      }
      for (const changed of [{ ...parameters, p_actor_user_id: other.userId }, { ...parameters, extra: true },
        { p_actor_user_id: identity.userId }, { ...parameters, p_actor_session_id: other.sessionId }]) {
        await assert.rejects(query(wrappedSql("service_read_reward_deployment_job", changed)), { code: "invalid_reward_operator_session_call" });
      }
      for (const isolation of ["repeatable read", "serializable"]) {
        await assert.rejects(query(`begin isolation level ${isolation}; ${sql} rollback;`), { code: "reward_operator_session_isolation_required" });
      }
    });
    await scenario("operator logout during a real arm lock wait rolls back the attempted transition and event", async () => {
      const before = await jobState();
      const parameters = { p_job_id: lifecycleJobs.activationJob.jobId, p_actor_user_id: identity.userId,
        p_worker_id: lifecycleJobs.activationLease.leaseOwner, p_lease_token: lifecycleJobs.activationLease.leaseToken, p_action: "arm" };
      const unlock = await lock(`select id from app_private.reward_programmes where id=${literal(programmeId)} for update;
        delete from auth.sessions where id=${literal(identity.sessionId)}`);
      const pending = assert.rejects(query(wrappedSql("service_step_reward_lifecycle_job", parameters)), { code: "reward_account_session_required" });
      pending.catch(() => {});
      try { await waiting(1); } finally { await unlock(); }
      await pending; assert.deepEqual(await jobState(), before);
      await assert.rejects(nextRewardOperatorJob(identity, selector, rpc), { code: "reward_account_session_required" });
      await query(`insert into auth.sessions(id,user_id,not_after) values
        (${literal(identity.sessionId)},${literal(identity.userId)},clock_timestamp()+interval '1 hour')`);
      // A valid session can run the identical original transition; roll it back
      // solely to preserve the existing downstream source-withdrawal scenario.
      const valid = JSON.parse(await query(`begin; ${wrappedSql("service_step_reward_lifecycle_job", parameters)} rollback;`));
      assert.equal(valid.result.state, "broadcasting"); assert.deepEqual(await jobState(), before);
    });
    await scenario("queue read rejects a session revoked while its job-table read waits", async () => {
      const unlock = await lock(`lock table app_private.reward_deployment_jobs in access exclusive mode;
        update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${literal(identity.sessionId)}`);
      const pending = assert.rejects(nextRewardOperatorJob(identity, selector, rpc), { code: "reward_account_session_required" });
      pending.catch(() => {});
      try { await waiting(1); } finally { await unlock(); }
      await pending;
      await query(`update auth.sessions set not_after=clock_timestamp()+interval '1 hour' where id=${literal(identity.sessionId)}`);
      assert.ok(await nextRewardOperatorJob(identity, selector, rpc));
    });
  } finally {
    // These are owned synthetic session rows with no reward-history FK refs.
    await query(`delete from auth.sessions where id in (${literal(identity.sessionId)},${literal(other.sessionId)});`);
  }
}
