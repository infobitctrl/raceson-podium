import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { rewardProgrammeApprovalV3, readProgrammeAttemptV3 } from "../dist/rewards/index.js";
import { createDefaultRewardProgrammeDraftV2 } from "../../domain/dist/rewards/programme-draft-v2.js";
import { prepareProgrammeDeploymentV3 } from "../../../apps/api/dist/features/rewards/programme-deployment-v3-service.js";
import { recordSignedProgrammeDeploymentV3, loadVerifiedProgrammeAttemptV3 } from "../../../apps/api/dist/features/rewards/programme-attempt-v3-service.js";
import { startOwnedRewardChain } from "../../rewards-chain/integration/owned-chain.mjs";
import { canonicalRewardJson, verifySignedProgrammeDeploymentV3 } from "../../rewards-chain/dist/index.js";
import { encodeRewardProgrammeDeploymentV3, readVerifiedRewardProgrammeV3 } from "../../rewards-chain/dist/programme-v3.js";
import { literal as q } from "./reward-integration-fixture.mjs";
import { programmeJobV3Scenarios } from "./reward-programme-jobs-v3-scenarios.mjs";
const id = n => `79000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export async function programmeAttemptV3Scenarios({ harness, scenario, fixture }) {
  const { query, scalar, rpc, rpcSql, lock, waiting } = harness, { identity } = fixture;
  // A separate draft on the OTHER chain ID shares the synthetic season, not its
  // deployment. Chain 10143 still runs on a fresh owned LOOPBACK node, never RPC.
  const chain = await startOwnedRewardChain({ chainId: 10143 });
  try {
    const draftId = id(979200), intentId = id(979201), attemptId = id(979202), chainId = 10143;
    await query(`insert into app_private.reward_planning_drafts(id,organization_id,season_id,chain_id,rules,updated_by_user_id)
      values(${q(draftId)},${q(id(1))},${q(id(3))},10143,${q(JSON.stringify(createDefaultRewardProgrammeDraftV2()))}::jsonb,${q(identity.userId)});`);
    const initial = await rewardProgrammeApprovalV3(identity, chainId, draftId, undefined, rpc);
    const mapping = { version: 2, leagueCategories: [], rounds: initial.workspace.catalogue.rounds.map(r => ({ slot: r.slot, roundId: r.id, categories: [] })) };
    await query(`select public.service_save_reward_mapping_v2(${q(identity.userId)},${q(identity.sessionId)},10143,${q(draftId)},0,1,
      ${q(initial.workspace.catalogueHash)},${q(JSON.stringify(mapping))}::jsonb);`);
    const mapped = await rewardProgrammeApprovalV3(identity, chainId, draftId, undefined, rpc);
    const approved = await rewardProgrammeApprovalV3(identity, chainId, draftId, { requestId: id(979203), expectedApprovalId: null,
      contextHash: mapped.contextHash, terms: { operatorAddress: chain.operator.address.toLowerCase(), funderAddress: chain.treasury.toLowerCase(), reviewPeriods: Array(6).fill(86400) } }, rpc);
    const prepared = await prepareProgrammeDeploymentV3(identity, { chainId, draftId, requestId: intentId, approvalId: approved.approval.id,
      contextHash: approved.contextHash, maximumGasCostWei: 3n * 10n ** 18n }, { reader: chain.publicClient, rpc });
    const artifact = JSON.parse(readFileSync(new URL("../../../contracts/out/RacesOnRewardProgrammeV3.sol/RacesOnRewardProgrammeV3.json", import.meta.url)));
    const data = encodeRewardProgrammeDeploymentV3(prepared.plan, artifact.bytecode.object);
    const gas = (await chain.publicClient.estimateGas({ account: chain.operator.address, data })) * 12n / 10n;
    const signedTransaction = await chain.operator.signTransaction({ chainId, type: "eip1559", nonce: Number(prepared.plan.deploymentNonce),
      data, gas, maxFeePerGas: 100_000_000_000n, maxPriorityFeePerGas: 0n, value: 0n });
    const witness = await verifySignedProgrammeDeploymentV3(prepared.plan, signedTransaction, prepared.maximumGasCostWei);
    const body = JSON.parse(canonicalRewardJson({ ...witness, operatorAddress: witness.operatorAddress.toLowerCase(), contractAddress: witness.contractAddress.toLowerCase() }));
    const scope = { chainId, draftId, intentId }, input = { ...scope, attemptId, signedTransaction };
    const args = { p_actor_user_id: identity.userId, p_actor_session_id: identity.sessionId, p_chain_id: chainId,
      p_draft_id: draftId, p_intent_id: intentId, p_attempt_id: attemptId, p_body: body };
    const table = "app_private.reward_programme_attempts_v3", count = () => scalar(`select count(*) from ${table} where intent_id=${q(intentId)}`);
    const record = () => recordSignedProgrammeDeploymentV3(identity, input, rpc);
    const load = transport => loadVerifiedProgrammeAttemptV3(identity, input, transport ?? rpc);
    const expire = () => query(`update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${q(identity.sessionId)}`);
    const restore = () => query(`update auth.sessions set not_after=clock_timestamp()+interval '1 hour' where id=${q(identity.sessionId)}`);

    await scenario("programme attempt rejects stale approval before recording real signed bytes", async () => {
      await query(`update app_private.reward_planning_drafts set revision=revision+1 where id=${q(draftId)}`);
      await assert.rejects(record(), { code: "reward_programme_approval_required" });
      await assert.rejects(query(rpcSql("service_record_reward_programme_attempt_v3", args)), /reward_programme_approval_required/);
      assert.equal(await count(), 0);
      await query(`update app_private.reward_planning_drafts set revision=revision-1 where id=${q(draftId)}`);
    });
    await scenario("programme signed attempt validates structural scope and numeric strings at the SQL boundary", async () => {
      for (const patch of [{ nonce: body.nonce + "0" }, { chainId: 31337 }, { operatorAddress: chain.treasury.toLowerCase() },
        { maximumGasCostWei: "1" }, { gasLimit: "30000001" }, { signedTransaction: "0x01aa" }, { schemaVersion: "3" },
        { maxPriorityFeePerGas: "100000000001" }, { calldataHash: null }, { privateKey: "never" }])
        await assert.rejects(query(rpcSql("service_record_reward_programme_attempt_v3", { ...args, p_body: { ...body, ...patch } })), /invalid_reward_programme_attempt/);
      assert.equal(await count(), 0);
    });
    await scenario("programme attempt rolls back after actual INSERT wait and session expiry", async () => {
      const release = await lock(`lock table ${table} in share mode`);
      const pending = assert.rejects(record(), { code: "reward_account_session_required" }); pending.catch(() => {});
      try { await waiting(1); await expire(); } finally { await release(); }
      await pending; assert.equal(await count(), 0); await restore();
    });
    await scenario("programme attempt source drift after INSERT rolls back stored bytes", async () => {
      await assert.rejects(query(`begin;
        create function pg_temp.synthetic_attempt_drift() returns trigger language plpgsql as $$ begin
          update app_private.reward_planning_drafts set revision=revision+1 where id=${q(draftId)};return new;end $$;
        create trigger synthetic_attempt_drift after insert on ${table} for each row execute function pg_temp.synthetic_attempt_drift();
        ${rpcSql("service_record_reward_programme_attempt_v3", args)}rollback;`), /reward_programme_approval_required/);
      assert.equal(await count(), 0);
    });
    await scenario("programme attempt service-only invoker can record with scoped grants and no persistent role mutation", async () => {
      const prior = await scalar("select rolbypassrls from pg_roles where rolname='service_role'");
      const result = JSON.parse(await query(`begin;alter role service_role bypassrls;set local role service_role;
        ${rpcSql("service_record_reward_programme_attempt_v3", args)}rollback;`));
      assert.equal(result.attemptId, attemptId); assert.equal(await count(), 0);
      assert.equal(await scalar("select rolbypassrls from pg_roles where rolname='service_role'"), prior);
    });
    await scenario("simultaneous signed programme retries store one exact attempt and recover a lost recording response", async () => {
      const release = await lock(`select pg_advisory_xact_lock(hashtextextended('reward-deployment-nonce:${chainId}:'||${q(chain.operator.address.toLowerCase())},0))`);
      const pending = Promise.all([record(), record()]); pending.catch(() => {});
      try {
        await waiting(2);
        await query(`begin;select id from app_private.reward_planning_drafts where id=${q(draftId)} for update nowait;rollback;`);
      } finally { await release(); }
      const [a, b] = await pending; assert.deepEqual(a, b); assert.equal(await count(), 1);
      assert.doesNotMatch(JSON.stringify(a), /signedTransaction|privateKey/);
      let lose = true;
      await assert.rejects(recordSignedProgrammeDeploymentV3(identity, input, async (name, values) => {
        const response = await rpc(name, values);
        if (name === "service_record_reward_programme_attempt_v3" && lose) { lose = false; throw Error("synthetic lost acknowledgement"); }
        return response;
      }), { code: "reward_ledger_unavailable" });
      assert.deepEqual(await record(), a); assert.equal(await count(), 1);
      const recovered = await load(); assert.equal(recovered.status, "current");
      assert.ok(recovered.verified.signedTransaction === signedTransaction); assert.equal(recovered.verified.transactionHash, a.transactionHash);
    });
    await scenario("changed attempt IDs/fees cannot replace the signed programme and rows cannot be mutated", async () => {
      await assert.rejects(recordSignedProgrammeDeploymentV3(identity, { ...input, attemptId: id(979299) }, rpc), { code: "reward_programme_attempt_conflict" });
      await assert.rejects(query(rpcSql("service_record_reward_programme_attempt_v3", { ...args, p_body: { ...body, maxFeePerGas: "99999999999" } })), /reward_programme_attempt_conflict/);
      await assert.rejects(query(`update ${table} set body='{}'::jsonb where intent_id=${q(intentId)}`), /immutable/);
      await assert.rejects(query(`delete from ${table} where intent_id=${q(intentId)}`), /immutable/);
      assert.equal(await count(), 1);
    });
    await scenario("cryptographic reload rejects tampered stored hash/address and rechecks Auth after async verification", async () => {
      for (const field of ["transactionHash", "calldataHash", "contractAddress"]) await assert.rejects(load(async (name, values) => {
        const result = await rpc(name, values), changed = structuredClone(result);
        changed.data.attempt.body[field] = `0x${"a".repeat(field === "contractAddress" ? 40 : 64)}`;
        return changed;
      }), { code: "reward_programme_attempt_mismatch" });
      let calls = 0;
      await assert.rejects(load(async (name, values) => {
        const result = await rpc(name, values); if (++calls === 1) await expire(); return result;
      }), { code: "reward_account_session_required" });
      await restore();
    });
    await scenario("stale signed history remains recoverable and held, while private reads reject revoked organization access", async () => {
      await query(`update app_private.reward_planning_drafts set revision=revision+1 where id=${q(draftId)}`);
      assert.equal((await load()).status, "held"); assert.equal((await record()).attemptId, attemptId);
      await query(`update app_private.reward_planning_drafts set revision=revision-1 where id=${q(draftId)}`);
      await query(`update public.organizations set status='inactive' where id=${q(id(1))}`);
      await assert.rejects(load(), { code: "reward_planning_not_found" });
      await query(`update public.organizations set status='active' where id=${q(id(1))}`);
    });
    await scenario("programme attempt read stays private during a real table wait and browser roles have no access", async () => {
      const release = await lock(`lock table ${table} in access exclusive mode`);
      const pending = assert.rejects(readProgrammeAttemptV3(identity, scope, rpc), { code: "reward_account_session_required" }); pending.catch(() => {});
      try { await waiting(1); await expire(); } finally { await release(); }
      await pending; await restore();
      assert.equal(await scalar(`select relrowsecurity from pg_class where oid='${table}'::regclass`), true);
      for (const role of ["anon", "authenticated"]) {
        assert.equal(await scalar(`select has_table_privilege('${role}','${table}','SELECT,INSERT,UPDATE,DELETE')`), false);
        for (const fn of ["public.service_read_reward_programme_attempt_v3(uuid,uuid,integer,uuid,uuid)", "public.service_record_reward_programme_attempt_v3(uuid,uuid,integer,uuid,uuid,uuid,jsonb)"]) {
          assert.equal(await scalar(`select has_function_privilege('${role}','${fn}','EXECUTE')`), false);
          assert.equal(await scalar(`select prosecdef from pg_proc where oid='${fn}'::regprocedure`), false);
        }
      }
    });
    const registered = await programmeJobV3Scenarios({ harness, scenario, identity, input, chain });
    await scenario("actual PostgreSQL signed-attempt worker deploys the exact six-pot factory on owned loopback only", async () => {
      const recovered = await load(); assert.equal(recovered.status, "current");
      const hash = registered.provenance.transactionHash;
      assert.equal(hash, recovered.verified.transactionHash);
      const receipt = await chain.publicClient.waitForTransactionReceipt({ hash, timeout: 10000 }); assert.equal(receipt.status, "success");
      await chain.testClient.mine({ blocks: 96, interval: 1 });
      const observed = await readVerifiedRewardProgrammeV3(chain.publicClient, { ...recovered.plan, deploymentTransactionHash: hash });
      assert.equal(observed.pots.length, 6); assert.equal(observed.depositedWei, 100000n * 10n ** 18n);
      assert.deepEqual(observed.pots.map(p => p.capWei), [...Array(5).fill(10000n * 10n ** 18n), 50000n * 10n ** 18n]);
      assert.ok(observed.pots.every(p => p.paidWei === 0n && p.accountedFundingWei === p.capWei && p.routed));
      assert.equal((await record()).transactionHash, hash); assert.equal(await count(), 1);
    });
  } finally { await chain.stop(); }
}
