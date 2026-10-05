import assert from "node:assert/strict";
import { encodeFunctionData } from "viem";
import { readProgrammeJobV3, queueProgrammeJobV3, stepProgrammeJobV3, readProgrammeRegistryV3 } from "../dist/rewards/index.js";
import { queueVerifiedProgrammeDeploymentV3, runProgrammeDeploymentJobV3 } from "../../../apps/api/dist/features/rewards/programme-worker-v3.js";
import { readRegisteredProgrammeFundingV3 } from "../../../apps/api/dist/features/rewards/programme-registry-v3-service.js";
import { dispatchRewardPlanningRoutes } from "../../../apps/api/dist/routes/rewards/planning.js";
import { fixtureSigner } from "../../rewards-chain/integration/owned-chain.mjs";
import { rewardProgrammeV3Abi } from "../../rewards-chain/dist/programme-v3.js";
import { literal as q } from "./reward-integration-fixture.mjs";
const id = n => `79000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export async function programmeJobV3Scenarios({ harness, scenario, identity, input, chain }) {
  const { query, scalar, rpc, rpcSql, lock, waiting } = harness;
  const { chainId, draftId, intentId, attemptId } = input, jobId = id(979301), workerId = id(979302), otherWorker = id(979303);
  const scope = { chainId, draftId, intentId }, selected = { ...scope, jobId, attemptId }, table = "app_private.reward_programme_jobs_v3";
  const queue = () => queueVerifiedProgrammeDeploymentV3(identity, selected, rpc), read = () => readProgrammeJobV3(identity, scope, rpc);
  const step = (worker, token, action, provenance) => stepProgrammeJobV3(identity, { ...scope, jobId, workerId: worker, leaseToken: token, action, provenance }, rpc);
  const lease = (worker = workerId) => step(worker, null, "lease");
  const expireLease = () => query(`update ${table} set lease_expires_at=clock_timestamp()-interval '1 second' where id=${q(jobId)}`);
  const expireSession = () => query(`update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${q(identity.sessionId)}`);
  const restoreSession = () => query(`update auth.sessions set not_after=clock_timestamp()+interval '1 hour' where id=${q(identity.sessionId)}`);
  const revision = delta => query(`update app_private.reward_planning_drafts set revision=revision+(${delta}) where id=${q(draftId)}`);
  const args = { p_actor_user_id: identity.userId, p_actor_session_id: identity.sessionId, p_chain_id: chainId,
    p_draft_id: draftId, p_intent_id: intentId, p_attempt_id: attemptId, p_job_id: jobId };
  const count = () => scalar(`select count(*) from ${table} where intent_id=${q(intentId)}`);
  const registry = () => readProgrammeRegistryV3(identity, scope, rpc);
  let broadcasts = 0;
  const broadcast = async signed => { broadcasts++; return chain.publicClient.sendRawTransaction({ serializedTransaction: signed }); };
  const run = (deps = {}, worker = workerId) => runProgrammeDeploymentJobV3(identity, { ...scope, jobId, workerId: worker },
    { rpc, reader: chain.publicClient, broadcast, ...deps });

  await scenario("programme job queue requires a current exact stored attempt; no job or registry is inferred", async () => {
    assert.equal(await read(), null); assert.equal((await registry()).registry, null);
    await revision(1); await assert.rejects(queue(), { code: "reward_programme_approval_required" }); await revision(-1);
    await assert.rejects(queueProgrammeJobV3(identity, { ...selected, attemptId: id(979399) }, rpc), { code: "reward_programme_attempt_required" });
    assert.equal(await count(), 0);
  });
  await scenario("programme job insertion and events roll back after session expiry or source drift", async () => {
    const release = await lock(`lock table ${table} in share mode`);
    const pending = assert.rejects(queue(), { code: "reward_account_session_required" }); pending.catch(() => {});
    try { await waiting(1); await expireSession(); } finally { await release(); }
    await pending; await restoreSession(); assert.equal(await count(), 0);
    await assert.rejects(query(`begin;
      create function pg_temp.synthetic_job_drift() returns trigger language plpgsql as $$ begin
        update app_private.reward_planning_drafts set revision=revision+1 where id=${q(draftId)};return new;end $$;
      create trigger synthetic_job_drift after insert on ${table} for each row execute function pg_temp.synthetic_job_drift();
      ${rpcSql("service_queue_reward_programme_job_v3", args)}rollback;`), /reward_programme_approval_required/);
    assert.equal(await count(), 0);
    assert.equal(await scalar(`select count(*) from app_private.reward_programme_job_events_v3 where job_id=${q(jobId)}`), 0);
  });
  await scenario("programme queue concurrent and lost-response retries preserve one fixed hash and one queued event", async () => {
    const release = await lock(`select pg_advisory_xact_lock(hashtextextended('reward-deployment-nonce:${chainId}:'||${q(chain.operator.address.toLowerCase())},0))`);
    const pending = Promise.all([queue(), queue()]); pending.catch(() => {});
    try {
      await waiting(2);
      // Both writers must wait for the signer WITHOUT holding draft SHARE locks.
      await query(`begin;select id from app_private.reward_planning_drafts where id=${q(draftId)} for update nowait;rollback;`);
    } finally { await release(); }
    const [a, b] = await pending; assert.deepEqual(a, b); assert.equal(await count(), 1);
    assert.equal(await scalar(`select count(*) from app_private.reward_programme_job_events_v3 where job_id=${q(jobId)}`), 1);
    await assert.rejects(queueProgrammeJobV3(identity, { ...selected, jobId: id(979399) }, rpc), { code: "reward_programme_job_conflict" });
    await assert.rejects(queueVerifiedProgrammeDeploymentV3(identity, selected, async (name, values) => {
      const result = await rpc(name, values); if (name === "service_queue_reward_programme_job_v3") throw Error("synthetic lost queue acknowledgement"); return result;
    }), { code: "reward_ledger_unavailable" });
    assert.deepEqual(await queue(), a);
  });
  await scenario("programme leases exclude other workers, recover one token and fence an expired generation", async () => {
    const pair = await Promise.all([lease(workerId), lease(otherWorker)]), first = pair.find(Boolean);
    assert.equal(pair.filter(Boolean).length, 1); assert.equal(first.leaseGeneration, 1);
    assert.deepEqual(await lease(first.leaseOwner), first);
    await expireLease(); const next = await lease(workerId); assert.equal(next.leaseGeneration, 2); assert.notEqual(next.leaseToken, first.leaseToken);
    await assert.rejects(step(first.leaseOwner, first.leaseToken, "arm"), { code: "reward_programme_lease_lost" });
    for (const kind of ["deployment", "funding", "lifecycle"]) assert.equal(await scalar(`select app_private.reward_operator_job_busy(${chainId},${q(chain.operator.address.toLowerCase())},${q(kind)},${q(id(979399))})`), true);
    assert.equal(await scalar(`select app_private.reward_operator_job_busy(${chainId},${q(chain.operator.address.toLowerCase())},'programme-v3',${q(jobId)})`), false);
    assert.equal(await scalar(`select app_private.reward_operator_job_busy(31337,${q(chain.operator.address.toLowerCase())},'deployment',${q(id(979399))})`), false);
  });
  await scenario("stale or revoked programme approvals hold unsent bytes without losing the recovery job", async () => {
    await revision(1); assert.equal((await run()).outcome, "held"); assert.equal(broadcasts, 0);
    const current = await read(); await assert.rejects(step(workerId, current.leaseToken, "arm"), { code: "reward_programme_approval_required" });
    assert.equal((await queue()).jobId, jobId); await revision(-1);
    await expireSession(); await assert.rejects(run(), { code: "reward_account_session_required" }); await restoreSession();
    assert.equal(broadcasts, 0);
  });
  await scenario("unknown RPC, wrong network, nonce conflict and insufficient gas never become permission to send", async () => {
    for (const [reader, expected] of [
      [{ ...chain.publicClient, getTransaction: async () => { throw Error("synthetic provider timeout"); } }, "unavailable"],
      [{ ...chain.publicClient, getChainId: async () => 1 }, "unavailable"],
      [{ ...chain.publicClient, getTransactionCount: async () => 99 }, "nonce_conflict"],
      [{ ...chain.publicClient, getBalance: async () => 0n }, "requires_attention"],
    ]) assert.equal((await run({ reader })).outcome, expected);
    assert.equal(broadcasts, 0); assert.equal((await read()).mayHaveBroadcast, false);
  });
  await scenario("source changes after chain preflight and lost arm acknowledgements do not broadcast", async () => {
    let changed = false;
    const reader = { ...chain.publicClient, getBalance: async args => {
      const result = await chain.publicClient.getBalance(args); if (!changed) { changed = true; await revision(1); } return result;
    } };
    assert.equal((await run({ reader })).outcome, "held"); assert.equal(broadcasts, 0); await revision(-1);
    assert.equal((await run({ rpc: async (name, values) => {
      const result = await rpc(name, values);
      if (name === "service_step_reward_programme_job_v3" && values.p_action === "arm") throw Error("synthetic lost arm acknowledgement");
      return result;
    } })).outcome, "unavailable");
    assert.equal(broadcasts, 0); assert.equal((await read()).mayHaveBroadcast, true);
  });
  await scenario("late arm response is caught by the last synchronous send fence", async () => {
    assert.equal((await run({ rpc: async (name, values) => {
      const result = await rpc(name, values);
      if (name === "service_step_reward_programme_job_v3" && values.p_action === "arm") result.data.leaseExpiresAt = "2000-01-01T00:00:00Z";
      return result;
    } })).outcome, "busy");
    assert.equal(broadcasts, 0);
  });
  await scenario("actual worker send survives lost broadcast response and reconciles the original pending transaction", async () => {
    await chain.testClient.setAutomine(false);
    assert.equal((await run({ broadcast: async signed => { await broadcast(signed); throw Error("synthetic lost send acknowledgement"); } })).outcome, "broadcast_unknown");
    assert.equal(broadcasts, 1); assert.equal((await read()).mayHaveBroadcast, true);
    await revision(1); await expireLease();
    assert.equal((await run({}, otherWorker)).outcome, "pending"); assert.equal(broadcasts, 1);
    assert.equal((await read()).state, "submitted");
    await chain.testClient.setAutomine(true); await chain.testClient.mine({ blocks: 96, interval: 1 });
  });
  await scenario("finalized registry and job completion roll back together if Auth expires during confirmation", async () => {
    const release = await lock("lock table app_private.reward_programme_registry_v3 in share mode");
    const pending = run({}, otherWorker); pending.catch(() => {});
    try { await waiting(1); await expireSession(); } finally { await release(); }
    assert.equal((await pending).outcome, "unavailable"); await restoreSession();
    assert.equal((await registry()).registry, null); assert.notEqual((await read()).state, "confirmed");
  });
  await scenario("finalized six-pot deployment is recorded atomically even when sources changed after broadcast", async () => {
    assert.equal((await run({}, otherWorker)).outcome, "confirmed"); assert.equal(broadcasts, 1);
    const r = await registry(); assert.equal(r.registry.jobId, jobId); assert.equal(r.context.intent.current, false);
    const job = await read(); assert.equal(job.state, "confirmed"); assert.equal(job.leaseToken, null);
    assert.equal(job.transactionHash, r.registry.provenance.transactionHash);
    await assert.rejects(readRegisteredProgrammeFundingV3(identity, r.context.approvalView.record, { rpc, reader: chain.publicClient }), { code: "reward_programme_approval_required" });
    await revision(-1);
    // A finished job is history, not a request to run the transaction again.
    assert.equal((await run({ reader: { getChainId() { throw Error("no new network work"); } } })).outcome, "confirmed");
  });
  await scenario("registered funding view uses actual provenance and fresh six-pot balances, never signed bytes", async () => {
    const r = await registry(), record = r.context.approvalView.record;
    const view = await readRegisteredProgrammeFundingV3(identity, record, { rpc, reader: chain.publicClient });
    assert.equal(view.status, "verified"); assert.equal(view.observation.depositedWei, "0"); assert.equal(view.observation.pots.length, 6);
    assert.doesNotMatch(JSON.stringify(view), /signedTransaction|leaseToken|leaseOwner|privateKey/);
    const response = {};
    assert.equal(await dispatchRewardPlanningRoutes({ method: "GET" }, response,
      new URL(`http://127.0.0.1:3102/api/v1/organizer/rewards/drafts/${draftId}/funding`), {
        config: () => ({ chainId, origin: "http://127.0.0.1:3102" }), requireIdentity: async () => identity,
        readJsonBody: async () => { throw Error("read-only route"); }, applyPrivateSessionHeaders: () => { response.private = true; },
        sendSuccess: (_, data) => Object.assign(response, { status: 200, data }), sendError: (_, status, code) => Object.assign(response, { status, code }),
        rpc, programmeFundingReader: chain.publicClient,
      }), true);
    assert.equal(response.status, 200); assert.equal(response.private, true); assert.deepEqual(response.data, view);
    for (const field of ["runtimeCodeHash", "deploymentBlockHash", "finalizedBlockHash", "programmeManifestHash"]) await assert.rejects(
      readRegisteredProgrammeFundingV3(identity, record, { reader: chain.publicClient, rpc: async (name, values) => {
        const result = await rpc(name, values); if (name === "service_read_reward_programme_registry_v3") result.data.registry.provenance[field] = `0x${"a".repeat(64)}`;
        return result;
      } }));
    let changed = false;
    await assert.rejects(readRegisteredProgrammeFundingV3(identity, record, { rpc, reader: { ...chain.publicClient, getBalance: async args => {
      const value = await chain.publicClient.getBalance(args); if (!changed) { changed = true; await revision(1); } return value;
    } } }), { code: "reward_programme_binding_mismatch" });
    await revision(-1);
  });
  await scenario("programme registry/history and job identity remain immutable with browser grants closed", async () => {
    for (const sql of [`update ${table} set attempt_id=${q(id(979399))} where id=${q(jobId)}`,
      `update ${table} set state='queued' where id=${q(jobId)}`, `delete from ${table} where id=${q(jobId)}`,
      `delete from app_private.reward_programme_registry_v3 where job_id=${q(jobId)}`,
      `delete from app_private.reward_programme_job_events_v3 where job_id=${q(jobId)}`]) await assert.rejects(query(sql), /immutable/);
    for (const table of ["reward_programme_jobs_v3", "reward_programme_registry_v3", "reward_programme_job_events_v3"]) {
      assert.equal(await scalar(`select relrowsecurity from pg_class where oid='app_private.${table}'::regclass`), true);
      for (const role of ["anon", "authenticated"]) assert.equal(await scalar(`select has_table_privilege('${role}','app_private.${table}','SELECT,INSERT,UPDATE,DELETE')`), false);
    }
    assert.equal(await scalar(`select count(*) from app_private.reward_programme_registry_v3 where job_id=${q(jobId)}`), 1);
    assert.equal(await scalar(`select count(*) from app_private.reward_programme_job_events_v3 where job_id=${q(jobId)} and kind='confirmed'`), 1);
  });
  await scenario("registered endpoint reflects an actual local 100,000 MON deposit and six routed pots", async () => {
    const funder = fixtureSigner(0x777), r = await registry(), address = r.registry.provenance.contractAddress;
    assert.equal(funder.address, chain.treasury);
    // This balance exists ONLY in the owned loopback node. No public faucet,
    // real wallet key or claimed public programme funding is involved.
    await chain.testClient.setBalance({ address: funder.address, value: 100001n * 10n ** 18n });
    const data = encodeFunctionData({ abi: rewardProgrammeV3Abi, functionName: "deposit", args: [0n] }), value = 100000n * 10n ** 18n;
    const gas = (await chain.publicClient.estimateGas({ account: funder.address, to: address, data, value })) * 12n / 10n;
    const signed = await funder.signTransaction({ chainId, type: "eip1559", to: address, data, value, gas,
      nonce: await chain.publicClient.getTransactionCount({ address: funder.address, blockTag: "pending" }), maxFeePerGas: 100_000_000_000n, maxPriorityFeePerGas: 0n });
    const hash = await chain.publicClient.sendRawTransaction({ serializedTransaction: signed });
    assert.equal((await chain.publicClient.waitForTransactionReceipt({ hash, timeout: 10000 })).status, "success");
    for (let slot = 0; slot < 6; slot++) {
      const tx = await chain.operatorClient.writeContract({ address, abi: rewardProgrammeV3Abi, functionName: "routePot", args: [slot] });
      assert.equal((await chain.publicClient.waitForTransactionReceipt({ hash: tx, timeout: 10000 })).status, "success");
    }
    await chain.testClient.mine({ blocks: 96, interval: 1 });
    const response = {};
    await dispatchRewardPlanningRoutes({ method: "GET" }, response,
      new URL(`http://127.0.0.1:3102/api/v1/organizer/rewards/drafts/${draftId}/funding`), {
        config: () => ({ chainId, origin: "http://127.0.0.1:3102" }), requireIdentity: async () => identity,
        readJsonBody: async () => { throw Error("read-only route"); }, applyPrivateSessionHeaders: () => { response.private = true; },
        sendSuccess: (_, data) => Object.assign(response, { status: 200, data }), sendError: (_, status, code) => Object.assign(response, { status, code }),
        rpc, programmeFundingReader: chain.publicClient,
      });
    assert.equal(response.status, 200); const observed = response.data.observation;
    assert.equal(observed.depositedWei, value.toString()); assert.equal(observed.totalRoutedWei, value.toString()); assert.equal(observed.pendingFundingWei, "0");
    assert.deepEqual(observed.pots.map(p => p.accountedFundingWei), [...Array(5).fill((10000n * 10n ** 18n).toString()), (50000n * 10n ** 18n).toString()]);
    assert.ok(observed.pots.every(p => p.routed && p.paidWei === "0"));
    assert.equal(response.data.operationsEnabled, false);
  });
  return (await registry()).registry;
}
