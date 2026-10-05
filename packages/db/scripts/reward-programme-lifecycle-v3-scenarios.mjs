import assert from "node:assert/strict";
import { prepareProgrammeLifecycleV3, recordSignedProgrammeLifecycleV3, loadVerifiedProgrammeLifecycleV3 } from "../../../apps/api/dist/features/rewards/programme-lifecycle-v3-service.js";
import { readProgrammeLifecycleV3, readProgrammeLifecycleJobV3, stepProgrammeLifecycleJobV3, readProgrammeExecutionStatusV3 } from "../dist/rewards/index.js";
import { programmeExecutionProgressV3 } from "../../domain/dist/rewards/programme-execution-status-v3.js";
import { dispatchRewardPlanningRoutes } from "../../../apps/api/dist/routes/rewards/planning.js";
import { dispatchProgrammeActionsV3 } from "../../../apps/api/dist/routes/rewards/programme-actions-v3.js";
import { queueVerifiedProgrammeLifecycleV3, runProgrammeLifecycleJobV3 } from "../../../apps/api/dist/features/rewards/programme-lifecycle-worker-v3.js";
import { runAuthenticatedProgrammeOperatorV3 } from "../../../apps/api/dist/features/rewards/programme-operator-v3.js";
import { programmeOperatorAuthFixtureV3 } from "../../../apps/api/test/fixtures/reward-programme-operator-v3.mjs";
import { canonicalRewardJson } from "../../rewards-chain/dist/index.js";
import { encodeRewardProgrammeLifecycleV3, readVerifiedRewardProgrammeLifecycleV3, verifySignedRewardProgrammeLifecycleV3 } from "../../rewards-chain/dist/programme-lifecycle-v3.js";
import { literal as q } from "./reward-integration-fixture.mjs";
const id = n => `8c000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

// Uses ONLY the caller-owned disposable DB/chain and synthetic signer. No RPC
// endpoint, real wallet, account, result or signature is imported from outside.
export async function programmeLifecycleV3Scenarios({ harness, scenario, identity, scope, chain, operator, facts, review }) {
  const { rpc, rpcSql, scalar, query, lock, waiting } = harness, deps = { rpc, reader: chain.publicClient };
  const table = "app_private.reward_programme_lifecycle_intents_v3", attempts = "app_private.reward_programme_lifecycle_attempts_v3";
  const jobs = "app_private.reward_programme_lifecycle_jobs_v3", confirmations = "app_private.reward_programme_lifecycle_receipts_v3";
  const fees = { gasLimit: "12000000", maxFeePerGas: "10000000000", maxPriorityFeePerGas: "0", maxGasCostWei: "200000000000000000" };
  const body = (action, batchStart = null, batchSize = null) => ({ action, batchStart, batchSize, packageHash: facts.prepared.packageHash, ...fees });
  const close = { ...scope, intentId: id(984001), predecessorId: null, body: body("complete_funding") };
  const args = input => ({ p_actor_user_id: identity.userId, p_actor_session_id: identity.sessionId, p_chain_id: scope.chainId,
    p_draft_id: scope.draftId, p_slot: scope.slot, p_approval_id: scope.approvalId, p_upload_id: scope.uploadId, p_intent_id: input.intentId });
  const reserveSql = async input => rpcSql("service_reserve_reward_programme_lifecycle_v3", { ...args(input), p_predecessor_id: input.predecessorId,
    p_pending_nonce: String(await chain.publicClient.getTransactionCount({ address: operator.address, blockTag: "pending" })), p_body: input.body });
  const count = () => scalar(`select count(*) from ${table}`);
  const stored = [], receipts = [], ahead = new Map();
  async function actionHttp(change, overrides = {}) {
    const result = {};
    await dispatchProgrammeActionsV3({ method: change ? "POST" : "GET" }, result,
      new URL(`http://127.0.0.1:3101/api/v1/organizer/rewards/drafts/${scope.draftId}/allocation-actions/${scope.slot}/${scope.approvalId}/${scope.uploadId}`), {
        config: () => ({ chainId: scope.chainId }), requireIdentity: async () => identity, rpc, programmeActionReader: chain.publicClient,
        applyPrivateSessionHeaders: () => result.private = true, readJsonBody: async () => change,
        sendSuccess: (_, data) => Object.assign(result, { status: 200, data }), sendError: (_, status, code) => Object.assign(result, { status, code }), ...overrides });
    assert.equal(result.private, true);
    assert.doesNotMatch(JSON.stringify(result), /signedTransaction|privateKey|snapshotSalt|leaseToken|sessionId|accessToken/);
    return result;
  }
  const prepareRequest = { kind: "prepare", requestId: close.intentId, expectedPredecessorId: null, packageHash: facts.prepared.packageHash, fees };
  const queueRequest = (job, transactionHash) => ({ kind: "queue", requestId: job.jobId, intentId: job.intentId, attemptId: job.attemptId,
    transactionHash, packageHash: facts.prepared.packageHash });
  const commandJob = (job, hash) => Object.fromEntries(["slot", "approvalId", "uploadId", "intentId", "attemptId", "jobId", "transactionHash"]
    .map(key => [key, key === "transactionHash" ? hash : job[key]]));
  async function command(job, hash, dependencies, patch = {}) {
    const auth = programmeOperatorAuthFixtureV3(identity, dependencies.rpc ?? rpc);
    const result = await runAuthenticatedProgrammeOperatorV3({ ...auth.credentials, target: auth.target,
      draftId: scope.draftId, programmeAddress: facts.prepared.package.programmeAddress.toLowerCase(), operatorAddress: operator.address.toLowerCase(),
      operatorUserId: identity.userId, workerId: job.workerId, durationMs: 60000, maxGasCostWei: 1_000_000_000_000_000_000n,
      jobs: [commandJob(job, hash)], ...patch }, dependencies, auth.clientFactory);
    assert.doesNotMatch(JSON.stringify(result), /signedTransaction|privateKey|snapshotSalt|leaseToken|sessionId|sb_secret_|accessToken/);
    return result;
  }
  let prepared;
  await scenario("V3 organizer execution status starts empty and rechecks revoked Auth after a real read lock wait", async () => {
    const view = await readProgrammeExecutionStatusV3(identity, scope, rpc);
    assert.equal(view.current, true); assert.equal(view.steps.length, 0); assert.equal(view.uploadId, facts.prepared.id);
    assert.deepEqual(programmeExecutionProgressV3(view), { fundingClosed: false, uploaded: 0, uploadComplete: false });
    const release = await lock(`lock table ${jobs} in access exclusive mode`);
    const pending = assert.rejects(readProgrammeExecutionStatusV3(identity, scope, rpc), { code: "reward_account_session_required" }); pending.catch(() => {});
    try { await waiting(1); await query(`update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${q(identity.sessionId)}`); }
    finally { await release(); }
    await pending; await query(`update auth.sessions set not_after=clock_timestamp()+interval '1 hour' where id=${q(identity.sessionId)}`);
  });
  await scenario("V3 lifecycle reservation rechecks Auth after a table wait and rolls back source drift including its nonce", async () => {
    const sql = await reserveSql(close), beforeNonces = await scalar("select count(*) from app_private.reward_operator_nonce_slots");
    const release = await lock(`lock table ${table} in share mode`);
    const pending = assert.rejects(query(sql), /reward_account_session_required/); pending.catch(() => {});
    try { await waiting(1); await query(`update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${q(identity.sessionId)}`); }
    finally { await release(); }
    await pending; assert.equal(await count(), 0);
    await query(`update auth.sessions set not_after=clock_timestamp()+interval '1 hour' where id=${q(identity.sessionId)}`);
    await assert.rejects(query(`begin;
      create function pg_temp.synthetic_lifecycle_drift() returns trigger language plpgsql as $$ begin
        update app_private.reward_planning_drafts set revision=revision+1 where id=${q(scope.draftId)};return new;end $$;
      create trigger synthetic_lifecycle_drift after insert on ${table} for each row execute function pg_temp.synthetic_lifecycle_drift();
      ${sql} rollback;`), /reward_allocation_not_ready|reward_planning_revision_changed/);
    assert.equal(await count(), 0); assert.equal(await scalar("select count(*) from app_private.reward_operator_nonce_slots"), beforeNonces);
  });
  await scenario("concurrent V3 lifecycle retries retain one nonce and refuse fee, action, batch and recipient-package substitutions", async () => {
    const pair = await Promise.all([actionHttp(prepareRequest), prepareProgrammeLifecycleV3(identity, close, deps)]);
    assert.equal(pair[0].status, 200); assert.deepEqual(pair[0].data.ack, { kind: "prepare", requestId: close.intentId });
    assert.equal(pair[0].data.selected.nonce, pair[1].plan.nonce.toString()); prepared = pair[1]; assert.equal(await count(), 1);
    const noChain = { rpc, reader: new Proxy({}, { get() { throw Error("exact retry must not use chain IO"); } }) };
    assert.deepEqual(await prepareProgrammeLifecycleV3(identity, close, noChain), prepared);
    for (const patch of [{ maxGasCostWei: "300000000000000000" }, { packageHash: "d".repeat(64) }, { action: "activate" },
      { batchStart: 0 }, { gasLimit: "0" }, { maxFeePerGas: "0" }, { maxPriorityFeePerGas: "10000000001" }, { publication: {} }]) {
      await assert.rejects(prepareProgrammeLifecycleV3(identity, { ...close, body: { ...close.body, ...patch } }, noChain));
    }
    await assert.rejects(query(await reserveSql({ ...close, intentId: id(984002) })), /reward_programme_lifecycle_conflict/);
    const upload = { ...close, intentId: id(984003), predecessorId: close.intentId, body: body("upload_awards", 1, 1) };
    await assert.rejects(query(await reserveSql(upload)), /invalid_reward_programme_lifecycle/);
    await assert.rejects(query(await reserveSql({ ...upload, predecessorId: id(984999), body: body("upload_awards", 0, 1) })), /reward_programme_lifecycle_predecessor_required/);
    assert.equal(await count(), 1);
    assert.equal(await scalar(`select count(*) from app_private.reward_operator_nonce_slots where programme_lifecycle_intent_id=${q(close.intentId)}`), 1);
  });
  await scenario("organizer HTTP reconciles lost preparation replies exactly and blocks mismatched gas, source, predecessor and pending advancement", async () => {
    const noChain = new Proxy({}, { get() { throw Error("exact retry must not read chain"); } });
    assert.equal((await actionHttp(prepareRequest, { programmeActionReader: noChain })).status, 200);
    for (const patch of [{ fees: { ...fees, maxGasCostWei: "300000000000000000" } }, { packageHash: "d".repeat(64) },
      { expectedPredecessorId: id(999999) }, { requestId: id(999998) }]) {
      assert.equal((await actionHttp({ ...prepareRequest, ...patch }, { programmeActionReader: noChain })).status, 409);
    }
    assert.equal(await count(), 1);
    const read = await actionHttp(); assert.equal(read.status, 200); assert.equal(read.data.execution.steps[0].state, "reserved");
  });
  async function execute(input, reserved) {
    const plan = reserved.plan, encoded = encodeRewardProgrammeLifecycleV3(plan);
    const gas = (await chain.publicClient.estimateGas({ account: operator.address, to: encoded.to, data: encoded.data })) * 12n / 10n;
    const signedTransaction = ahead.get(input.intentId) ?? await operator.signTransaction({ ...encoded, type: "eip1559", gas, maxFeePerGas: 10_000_000_000n, maxPriorityFeePerGas: 0n });
    const selected = { ...input, attemptId: id(985000 + stored.length) }, sendInput = { ...selected, signedTransaction };
    if (stored.length === 0) await scenario("V3 signed-attempt insertion rechecks expired sessions and rolls back drift after the private write", async () => {
      const b = await verifySignedRewardProgrammeLifecycleV3(plan, signedTransaction);
      const rawBody = JSON.parse(canonicalRewardJson({ ...b, contractAddress: b.contractAddress.toLowerCase(), operatorAddress: b.operatorAddress.toLowerCase() }));
      const sql = rpcSql("service_record_reward_programme_lifecycle_attempt_v3", { ...args(input), p_attempt_id: selected.attemptId, p_body: rawBody });
      const release = await lock(`lock table ${attempts} in share mode`);
      const pending = assert.rejects(query(sql), /reward_account_session_required/); pending.catch(() => {});
      try { await waiting(1); await query(`update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${q(identity.sessionId)}`); }
      finally { await release(); }
      await pending; assert.equal(await scalar(`select count(*) from ${attempts}`), 0);
      await query(`update auth.sessions set not_after=clock_timestamp()+interval '1 hour' where id=${q(identity.sessionId)}`);
      await assert.rejects(query(`begin;
        create function pg_temp.synthetic_lifecycle_attempt_drift() returns trigger language plpgsql as $$ begin
          update app_private.reward_planning_drafts set revision=revision+1 where id=${q(scope.draftId)};return new;end $$;
        create trigger synthetic_lifecycle_attempt_drift after insert on ${attempts} for each row execute function pg_temp.synthetic_lifecycle_attempt_drift();
        ${sql} rollback;`), /reward_allocation_not_ready|reward_planning_revision_changed/);
      assert.equal(await scalar(`select count(*) from ${attempts}`), 0);
    });
    const recorded = await Promise.all([recordSignedProgrammeLifecycleV3(identity, sendInput, rpc), recordSignedProgrammeLifecycleV3(identity, sendInput, rpc)]);
    assert.deepEqual(recorded[0], recorded[1]); assert.doesNotMatch(JSON.stringify(recorded[0]), /signedTransaction|privateKey|snapshotSalt/);
    // Reload through a fresh service entry; no in-memory signed witness trusted.
    const loaded = await loadVerifiedProgrammeLifecycleV3(identity, selected, rpc);
    assert.equal(loaded.status, "current"); assert.equal(loaded.verified.signedTransaction, signedTransaction);
    for (const mutate of [b => b.calldataHash = `0x${"e".repeat(64)}`, b => b.transactionHash = `0x${"e".repeat(64)}`,
      b => b.gasLimit = "1", b => b.contractAddress = facts.prepared.package.programmeAddress]) {
      const alteredRpc = async (fn, a) => {
        const result = structuredClone(await rpc(fn, a));
        if (fn === "service_read_reward_programme_lifecycle_v3" && result.data?.attempt) mutate(result.data.attempt.body);
        return result;
      };
      await assert.rejects(loadVerifiedProgrammeLifecycleV3(identity, selected, alteredRpc));
    }
    await assert.rejects(recordSignedProgrammeLifecycleV3(identity, { ...sendInput, attemptId: id(985999) }, rpc), { code: "reward_programme_lifecycle_attempt_conflict" });
    const job = { ...selected, jobId: id(986000 + stored.length), workerId: id(987000 + stored.length) };
    if (!ahead.has(input.intentId)) assert.deepEqual(await readProgrammeLifecycleJobV3(identity, selected, rpc), { job: null, receipt: null });
    if (stored.length === 0) await scenario("organizer HTTP shows signed limits and rejects a substituted transaction hash before queueing", async () => {
      const read = await actionHttp(); assert.equal(read.status, 200); assert.equal(read.data.execution.steps[0].state, "signed");
      assert.equal(read.data.selected.attemptId, selected.attemptId); assert.equal(read.data.selected.jobId, null);
      const before = await scalar(`select count(*) from ${jobs}`);
      assert.equal((await actionHttp(queueRequest(job, `0x${"e".repeat(64)}`))).status, 409);
      assert.equal(await scalar(`select count(*) from ${jobs}`), before);
    });
    const queued = await Promise.all([actionHttp(queueRequest(job, loaded.verified.transactionHash)), queueVerifiedProgrammeLifecycleV3(identity, job, rpc)]);
    assert.equal(queued[0].status, 200); assert.equal(queued[0].data.selected.jobId, job.jobId);
    assert.equal(queued[1].state, ahead.has(input.intentId) ? "leased" : "queued");
    const visible = await readProgrammeExecutionStatusV3(identity, scope, rpc);
    assert.equal(visible.steps.at(-1).state, queued[1].state);
    assert.equal(visible.steps.at(-1).receipt, null);
    let broadcasts = 0;
    const broadcast = async signed => { broadcasts++; assert.equal(signed, signedTransaction);
      return chain.publicClient.sendRawTransaction({ serializedTransaction: signed }); };
    const workerDeps = { ...deps, broadcast };
    if (stored.length === 0) await scenario("authenticated V3 command refuses substituted jobs/parent/signer and insufficient total gas before any lease or chain IO", async () => {
      const noChain = { rpc, reader: new Proxy({}, { get() { throw Error("preflight must not access chain"); } }),
        broadcast() { throw Error("preflight must not send"); } };
      for (const patch of [{ maxGasCostWei: 1n }, { programmeAddress: `0x${"1".repeat(40)}` }, { operatorAddress: `0x${"2".repeat(40)}` },
        { jobs: [commandJob(job, `0x${"3".repeat(64)}`)] }, { jobs: [{ ...commandJob(job, loaded.verified.transactionHash), attemptId: id(998888) }] }]) {
        const result = await command(job, loaded.verified.transactionHash, noChain, patch);
        assert.equal(result.stop, "attention_required"); assert.equal(result.entries.length, 0);
      }
      assert.equal((await readProgrammeLifecycleJobV3(identity, job, rpc)).job.state, "queued");
      assert.equal((await readProgrammeLifecycleJobV3(identity, job, rpc)).job.leaseGeneration, 0);
      await query(`update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${q(identity.sessionId)}`);
      assert.equal((await command(job, loaded.verified.transactionHash, noChain)).stop, "unavailable");
      await query(`update auth.sessions set not_after=clock_timestamp()+interval '1 hour' where id=${q(identity.sessionId)}`);
      assert.equal((await readProgrammeLifecycleJobV3(identity, job, rpc)).job.state, "queued");
    });
    if (stored.length === 0) await scenario("V3 job leases exclude competing workers and all legacy operator kinds; expired Auth/lease responses cannot send", async () => {
      const leased = await stepProgrammeLifecycleJobV3(identity, { ...job, action: "lease", leaseToken: null }, rpc);
      assert.equal(await stepProgrammeLifecycleJobV3(identity, { ...job, workerId: id(987999), action: "lease", leaseToken: null }, rpc), null);
      for (const kind of ["deployment", "funding", "lifecycle", "programme-v3"]) {
        assert.equal(await scalar(`select app_private.reward_operator_job_busy(31337,${q(operator.address.toLowerCase())},${q(kind)},${q(id(987999))})`), true);
      }
      assert.equal(await scalar(`select app_private.reward_operator_job_busy(31337,${q(operator.address.toLowerCase())},'programme-lifecycle-v3',${q(job.jobId)})`), false);
      const release = await lock(`lock table ${jobs} in share mode`);
      const pending = assert.rejects(query(rpcSql("service_step_reward_programme_lifecycle_job_v3", { ...args(input), p_job_id: job.jobId,
        p_worker_id: job.workerId, p_lease_token: leased.leaseToken, p_action: "arm", p_receipt: null })), /reward_account_session_required/); pending.catch(() => {});
      try { await waiting(1); await query(`update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${q(identity.sessionId)}`); }
      finally { await release(); }
      await pending;
      await query(`update auth.sessions set not_after=clock_timestamp()+interval '1 hour' where id=${q(identity.sessionId)}`);
      assert.equal((await runProgrammeLifecycleJobV3(identity, job, { ...workerDeps, reader: { ...chain.publicClient, getChainId: async () => 143 } })).outcome, "unavailable");
      const expiredArm = async (fn, a) => { const r = structuredClone(await rpc(fn, a));
        if (fn === "service_step_reward_programme_lifecycle_job_v3" && a.p_action === "arm" && r.data) r.data.leaseExpiresAt = "2000-01-01T00:00:00Z";
        return r; };
      assert.equal((await runProgrammeLifecycleJobV3(identity, job, { ...workerDeps, rpc: expiredArm })).outcome, "busy");
      const expireAfterChainIo = { ...chain.publicClient, getBalance: async a => {
        const value = await chain.publicClient.getBalance(a);
        if (a.blockTag === "latest" && a.address.toLowerCase() === operator.address.toLowerCase())
          await query(`update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${q(identity.sessionId)}`);
        return value;
      } };
      const expired = await command(job, loaded.verified.transactionHash, { ...workerDeps, reader: expireAfterChainIo });
      assert.equal(expired.stop, "unavailable"); assert.equal(expired.entries[0].outcome, "unavailable");
      await query(`update auth.sessions set not_after=clock_timestamp()+interval '1 hour' where id=${q(identity.sessionId)}`);
      assert.equal(broadcasts, 0);
    });
    if (stored.length === 0) await scenario("V3 operator cancellation after committed SQL arm prevents the actual broadcast handoff", async () => {
      const controller = new AbortController();
      const cancelAfterArm = async (fn, args) => {
        const result = await rpc(fn, args);
        if (fn === "service_step_reward_programme_lifecycle_job_v3" && args.p_action === "arm") controller.abort();
        return result;
      };
      const result = await command(job, loaded.verified.transactionHash, { ...workerDeps, rpc: cancelAfterArm, signal: controller.signal });
      assert.equal(result.stop, "stopped"); assert.equal(broadcasts, 0);
      assert.equal((await readProgrammeLifecycleJobV3(identity, job, rpc)).job.state, "broadcasting");
    });
    // The first send lands on the local chain but deliberately loses its reply.
    // Recovery must confirm the same saved attempt without broadcasting again.
    const sent = await command(job, loaded.verified.transactionHash, { ...workerDeps, broadcast: async signed => {
      const hash = await broadcast(signed); if (stored.length === 0) throw Error("synthetic lost response"); return hash;
    } });
    assert.equal(sent.stop, "deferred"); assert.equal(sent.entries[0].outcome, stored.length === 0 ? "broadcast_unknown" : "submitted");
    const hash = loaded.verified.transactionHash;
    assert.equal((await chain.publicClient.waitForTransactionReceipt({ hash, timeout: 10000 })).status, "success");
    await chain.testClient.mine({ blocks: 96, interval: 1 });
    const proof = await readVerifiedRewardProgrammeLifecycleV3(chain.publicClient, loaded.plan, loaded.verified.signedTransaction);
    assert.equal(proof.transactionHash, hash); assert.equal(proof.accountingAtReceiptBlock.paid[0], 0n);
    if (stored.length === 0) await scenario("a queued next upload cannot arm before its already-mined predecessor is confirmed in the private ledger", async () => {
      const next = { ...scope, intentId: id(984010), predecessorId: input.intentId, body: body("upload_awards", 0, 1) };
      const nextPlan = (await prepareProgrammeLifecycleV3(identity, next, deps)).plan;
      const encoded = encodeRewardProgrammeLifecycleV3(nextPlan);
      const nextGas = (await chain.publicClient.estimateGas({ account: operator.address, to: encoded.to, data: encoded.data })) * 12n / 10n;
      const signed = await operator.signTransaction({ ...encoded, type: "eip1559", gas: nextGas, maxFeePerGas: 10_000_000_000n, maxPriorityFeePerGas: 0n });
      ahead.set(next.intentId, signed);
      const nextJob = { ...next, attemptId: id(985001), jobId: id(986001), workerId: id(987001) };
      await recordSignedProgrammeLifecycleV3(identity, { ...nextJob, signedTransaction: signed }, rpc);
      await queueVerifiedProgrammeLifecycleV3(identity, nextJob, rpc);
      // Explicit pending-observation fault: the already-mined first transaction
      // is temporarily reported as pending. The command must defer the entire
      // nonce-ordered pass, not lease/send the next approved batch.
      const nextHash = (await loadVerifiedProgrammeLifecycleV3(identity, nextJob, rpc)).verified.transactionHash;
      const pendingReader = { ...chain.publicClient, getTransaction: async a => {
        const tx = await chain.publicClient.getTransaction(a);
        return a.hash === hash ? { ...tx, blockNumber: null, blockHash: null, transactionIndex: null } : tx;
      } };
      const pass = await command(job, hash, { ...workerDeps, reader: pendingReader },
        { jobs: [commandJob(job, hash), commandJob(nextJob, nextHash)] });
      assert.equal(pass.stop, "deferred"); assert.equal(pass.entries.length, 1); assert.equal(pass.entries[0].outcome, "pending");
      assert.equal((await readProgrammeLifecycleJobV3(identity, nextJob, rpc)).job.state, "queued");
      assert.equal(broadcasts, 1);
      assert.equal(await stepProgrammeLifecycleJobV3(identity, { ...nextJob, action: "lease", leaseToken: null }, rpc), null);
      // Simulate expiry of a disposable execution lease only, never a sporting
      // review/publication clock. No existing live service or lease is touched.
      await query(`update ${jobs} set lease_expires_at=clock_timestamp()-interval '1 second' where id=${q(job.jobId)}`);
      const lease = await stepProgrammeLifecycleJobV3(identity, { ...nextJob, action: "lease", leaseToken: null }, rpc);
      await assert.rejects(stepProgrammeLifecycleJobV3(identity, { ...nextJob, action: "arm", leaseToken: lease.leaseToken }, rpc),
        { code: "reward_programme_lifecycle_predecessor_required" });
      await query(`update ${jobs} set lease_expires_at=clock_timestamp()-interval '1 second' where id=${q(nextJob.jobId)}`);
      await stepProgrammeLifecycleJobV3(identity, { ...job, action: "lease", leaseToken: null }, rpc);
    });
    if (stored.length === 0) await scenario("V3 receipt confirmation rejects mismatched witnesses and rolls back receipt/job together after Auth expiry", async () => {
      const lease = (await readProgrammeLifecycleJobV3(identity, job, rpc)).job;
      const receipt = JSON.parse(canonicalRewardJson({ ...proof, campaignAddress: proof.campaignAddress.toLowerCase(),
        provenance: { ...proof.provenance, programmeAddress: proof.provenance.programmeAddress.toLowerCase() } }));
      const sql = body => rpcSql("service_step_reward_programme_lifecycle_job_v3", { ...args(input), p_job_id: job.jobId,
        p_worker_id: job.workerId, p_lease_token: lease.leaseToken, p_action: "confirm", p_receipt: body });
      for (const mutate of [r => r.feeWei = "1", r => r.provenance.slot = 1, r => r.nonce = "999", r => r.transactionHash = `0x${"f".repeat(64)}`,
        r => r.accountingAtReceiptBlock.paid[0] = "1", r => r.finalizedBlock.number = "0", r => r.publicationAtReceiptBlock.officialPublishedAt = "1",
        r => r.signedTransaction = "forbidden"]) {
        const r = structuredClone(receipt); mutate(r); await assert.rejects(query(sql(r)), /invalid_reward_programme_lifecycle_receipt|invalid_reward_campaign_accounting/);
      }
      const release = await lock(`lock table ${confirmations} in share mode`), pending = assert.rejects(query(sql(receipt)), /reward_account_session_required/); pending.catch(() => {});
      try { await waiting(1); await query(`update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${q(identity.sessionId)}`); }
      finally { await release(); }
      await pending;
      await query(`update auth.sessions set not_after=clock_timestamp()+interval '1 hour' where id=${q(identity.sessionId)}`);
      assert.equal(await scalar(`select count(*) from ${confirmations}`), 0);
      assert.notEqual((await readProgrammeLifecycleJobV3(identity, job, rpc)).job.state, "confirmed");
    });
    const deferred = input.body.action === "upload_awards" && input.body.batchStart + input.body.batchSize === facts.prepared.package.awards.length;
    if (!deferred) {
      assert.equal((await command(job, hash, workerDeps)).stop, "jobs_confirmed");
      const confirmed = await readProgrammeLifecycleJobV3(identity, job, rpc);
      assert.equal(confirmed.receipt.body.transactionHash, hash); assert.equal(confirmed.receipt.body.nonce, plan.nonce);
      assert.equal((await command(job, hash, { rpc, reader: {}, broadcast() { throw Error("duplicate send"); } })).stop, "jobs_confirmed");
    }
    assert.equal(broadcasts, 1);
    stored.push({ selected, sendInput, reservation: input, reserved, hash, job, deferred }); receipts.push(proof);
  }
  await scenario("authenticated V3 command executes exact stored closure/upload jobs and recovers a lost send on the registered local child", async () => {
    await execute(close, prepared);
    let predecessorId = close.intentId;
    for (let start = 0, n = 0; start < facts.prepared.package.awards.length; n++) {
      const size = Math.min(n === 0 ? 1 : 64, facts.prepared.package.awards.length - start);
      const input = { ...scope, intentId: id(984010 + n), predecessorId, body: body("upload_awards", start, size) };
      const reserved = await prepareProgrammeLifecycleV3(identity, input, deps);
      assert.ok(reserved.plan.nonce > stored.at(-1).reserved.plan.nonce);
      await execute(input, reserved); predecessorId = input.intentId; start += size;
    }
    assert.ok(stored.length >= 3);
    assert.equal(await count(), stored.length); assert.equal(await scalar(`select count(*) from ${attempts}`), stored.length);
    assert.equal(await scalar(`select count(*) from ${jobs} where state='confirmed'`), stored.length - 1);
    assert.equal(await scalar(`select count(*) from ${confirmations}`), stored.length - 1);
    assert.equal(await scalar(`select count(*) from app_private.reward_operator_nonce_slots where programme_lifecycle_intent_id is not null`), stored.length);
  });
  await scenario("V3 signed lifecycle history recovers after a source hold, but a new reservation cannot execute stale approval", async () => {
    await review(1, "held", id(984100));
    const nonce = await chain.publicClient.getTransactionCount({ address: operator.address });
    for (let n = 0; n < stored.length; n++) {
      const s = stored[n], loaded = await loadVerifiedProgrammeLifecycleV3(identity, s.selected, rpc);
      assert.equal(loaded.status, "held"); assert.equal(loaded.verified.transactionHash, s.hash);
      const retry = await prepareProgrammeLifecycleV3(identity, s.reservation, { rpc, reader: {} });
      assert.equal(retry.status, "held"); assert.deepEqual(retry.plan, s.reserved.plan);
      assert.equal((await recordSignedProgrammeLifecycleV3(identity, s.sendInput, rpc)).transactionHash, s.hash);
      assert.equal((await queueVerifiedProgrammeLifecycleV3(identity, s.job, rpc)).state, s.deferred ? "submitted" : "confirmed");
      assert.equal((await command(s.job, s.hash, { rpc, reader: chain.publicClient, broadcast() { throw Error("duplicate send"); } })).stop, "jobs_confirmed");
      assert.equal((await readProgrammeLifecycleJobV3(identity, s.job, rpc)).receipt.body.transactionHash, s.hash);
      const proof = await readVerifiedRewardProgrammeLifecycleV3(chain.publicClient, loaded.plan, loaded.verified.signedTransaction);
      assert.deepEqual({ ...proof, finalizedBlock: receipts[n].finalizedBlock }, receipts[n]);
    }
    await assert.rejects(prepareProgrammeLifecycleV3(identity, { ...close, intentId: id(984101) }, { rpc, reader: {} }), { code: "reward_allocation_not_ready" });
    assert.equal(await chain.publicClient.getTransactionCount({ address: operator.address }), nonce);
    assert.equal(await scalar(`select count(*) from ${jobs} where state='confirmed'`), stored.length);
    assert.equal(await scalar(`select count(*) from ${confirmations}`), stored.length);
    await query(`update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${q(identity.sessionId)}`);
    await assert.rejects(loadVerifiedProgrammeLifecycleV3(identity, stored[0].selected, rpc), { code: "reward_account_session_required" });
    await query(`update auth.sessions set not_after=clock_timestamp()+interval '1 hour' where id=${q(identity.sessionId)}`);
  });
  await scenario("authenticated V3 operator reconciles the exact ordered list after hold and rejects reversed nonce order without sending", async () => {
    const noSend = { rpc, reader: {}, broadcast() { throw Error("confirmed history cannot send"); } };
    const jobs = stored.map(s => commandJob(s.job, s.hash));
    const result = await command(stored[0].job, stored[0].hash, noSend, { jobs });
    assert.equal(result.stop, "jobs_confirmed"); assert.equal(result.requestedJobs, stored.length);
    assert.deepEqual(result.entries.map(e => e.transactionHash), stored.map(s => s.hash));
    assert.ok(BigInt(result.verifiedGasCeilingWei) > 0n);
    const insufficient = await command(stored[0].job, stored[0].hash, noSend, { jobs, maxGasCostWei: BigInt(result.verifiedGasCeilingWei) - 1n });
    assert.equal(insufficient.stop, "attention_required"); assert.equal(insufficient.entries.length, 0);
    assert.equal((await command(stored[0].job, stored[0].hash, noSend, { jobs: [...jobs].reverse() })).stop, "attention_required");
  });
  await scenario("organizer HTTP keeps original recovery after source hold, returns verified receipts and honors live session revocation", async () => {
    const old = await actionHttp(prepareRequest, { programmeActionReader: {} }); assert.equal(old.status, 200); assert.equal(old.data.execution.current, false);
    const recovered = await actionHttp(queueRequest(stored[0].job, stored[0].hash)); assert.equal(recovered.status, 200);
    assert.deepEqual(recovered.data.execution.steps.map(s => s.transactionHash), stored.map(s => s.hash));
    assert.equal((await actionHttp({ ...prepareRequest, requestId: id(999997) }, { programmeActionReader: {} })).status, 409);
    await query(`update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${q(identity.sessionId)}`);
    try { assert.equal((await actionHttp()).status, 401); }
    finally { await query(`update auth.sessions set not_after=clock_timestamp()+interval '1 hour' where id=${q(identity.sessionId)}`); }
  });
  await scenario("V3 organizer HTTP reads the exact persisted local receipts after a source hold without exposing capabilities", async () => {
    const result = {};
    await dispatchRewardPlanningRoutes({ method: "GET" }, result,
      new URL(`http://127.0.0.1:3101/api/v1/organizer/rewards/drafts/${scope.draftId}/allocation-execution/${scope.slot}/${scope.approvalId}/${scope.uploadId}`), {
        config: () => ({ chainId: scope.chainId }), requireIdentity: async () => identity, rpc,
        applyPrivateSessionHeaders: () => result.private = true,
        sendSuccess: (_, data) => Object.assign(result, { status: 200, data }), sendError: (_, status, code) => Object.assign(result, { status, code }) });
    assert.equal(result.status, 200); assert.equal(result.private, true); assert.equal(result.data.current, false);
    assert.deepEqual(result.data.steps.map(s => s.transactionHash), stored.map(s => s.hash));
    assert.deepEqual(result.data.steps.map(s => s.receipt.blockNumber), receipts.map(r => r.blockNumber.toString()));
    assert.deepEqual(programmeExecutionProgressV3(result.data), { fundingClosed: true, uploaded: facts.prepared.package.awards.length, uploadComplete: true });
    assert.doesNotMatch(JSON.stringify(result.data), /signedTransaction|leaseToken|leaseOwner|snapshotSalt|explanationSalt|sourceBeneficiaryId/);
    for (const patch of [{ chainId: 10143 }, { draftId: id(993333) }, { slot: 2 }, { approvalId: id(993334) }, { uploadId: id(993335) }])
      await assert.rejects(readProgrammeExecutionStatusV3(identity, { ...scope, ...patch }, rpc));
    await assert.rejects(readProgrammeExecutionStatusV3({ ...identity, userId: id(999999) }, scope, rpc));
  });
  await scenario("V3 lifecycle private records deny browser roles, mutations, alternate scopes and orphan nonce owners", async () => {
    for (const t of [table, attempts, confirmations, "app_private.reward_programme_lifecycle_job_events_v3"]) {
      assert.equal(await scalar(`select relrowsecurity from pg_class where oid='${t}'::regclass`), true);
      for (const role of ["anon", "authenticated"]) assert.equal(await scalar(`select has_table_privilege('${role}','${t}','SELECT,INSERT,UPDATE,DELETE')`), false);
      await assert.rejects(query(`delete from ${t}`), /reward_ledger_is_immutable/);
    }
    await assert.rejects(query(`delete from ${jobs}`), /reward_job_identity_is_immutable/);
    assert.equal(await scalar(`select relrowsecurity from pg_class where oid='${jobs}'::regclass`), true);
    for (const role of ["anon", "authenticated"]) assert.equal(await scalar(`select has_table_privilege('${role}','${jobs}','SELECT,INSERT,UPDATE,DELETE')`), false);
    for (const fn of ["public.service_read_reward_programme_execution_status_v3(uuid,uuid,integer,uuid,integer,uuid,uuid)",
      "public.service_read_reward_programme_lifecycle_v3(uuid,uuid,integer,uuid,integer,uuid,uuid,uuid)",
      "public.service_reserve_reward_programme_lifecycle_v3(uuid,uuid,integer,uuid,integer,uuid,uuid,uuid,uuid,text,jsonb)",
      "public.service_record_reward_programme_lifecycle_attempt_v3(uuid,uuid,integer,uuid,integer,uuid,uuid,uuid,uuid,jsonb)",
      "public.service_read_reward_programme_lifecycle_job_v3(uuid,uuid,integer,uuid,integer,uuid,uuid,uuid)",
      "public.service_queue_reward_programme_lifecycle_job_v3(uuid,uuid,integer,uuid,integer,uuid,uuid,uuid,uuid,uuid)",
      "public.service_step_reward_programme_lifecycle_job_v3(uuid,uuid,integer,uuid,integer,uuid,uuid,uuid,uuid,uuid,uuid,text,jsonb)"]) {
      assert.equal(await scalar(`select prosecdef from pg_proc where oid='${fn}'::regprocedure`), false);
      for (const role of ["anon", "authenticated"]) assert.equal(await scalar(`select has_function_privilege('${role}','${fn}','EXECUTE')`), false);
    }
    for (const patch of [{ chainId: 10143 }, { slot: 2 }, { uploadId: id(983001) }, { approvalId: id(982010) }])
      await assert.rejects(readProgrammeLifecycleV3(identity, { ...close, ...patch }, rpc));
    await assert.rejects(query(`insert into app_private.reward_operator_nonce_slots(chain_id,operator_address,nonce,programme_lifecycle_intent_id)
      values(31337,${q(operator.address.toLowerCase())},999,${q(id(984999))})`), /foreign key constraint/);
    const raw = await readProgrammeLifecycleV3(identity, close, rpc);
    assert.equal(raw.intent.nonce, prepared.plan.nonce); assert.equal(raw.upload.current, false);
    assert.equal(canonicalRewardJson(raw.upload.prepared.package), canonicalRewardJson(facts.prepared.package));
  });
}
