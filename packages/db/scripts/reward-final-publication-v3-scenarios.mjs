import assert from 'node:assert/strict';
import { finalPublicationFactsV3, readProgrammeExecutionStatusV3, readProgrammeLifecycleJobV3 } from '../dist/rewards/index.js';
import { finalPublicationV3, composeFinalPublicationEvidenceV3 } from '../../../apps/api/dist/features/rewards/final-publication-v3-service.js';
import { dispatchFinalPublicationV3 } from '../../../apps/api/dist/routes/rewards/final-publication-v3.js';
import { prepareProgrammeLifecycleV3, recordSignedProgrammeLifecycleV3, loadVerifiedProgrammeLifecycleV3 }
  from '../../../apps/api/dist/features/rewards/programme-lifecycle-v3-service.js';
import { queueVerifiedProgrammeLifecycleV3, runProgrammeLifecycleJobV3 }
  from '../../../apps/api/dist/features/rewards/programme-lifecycle-worker-v3.js';
import { encodeRewardProgrammeLifecycleV3 } from '../../rewards-chain/dist/programme-lifecycle-v3.js';
import { rewardCampaignV3Abi } from '../../rewards-chain/dist/campaign-v3.js';
import { canonicalRewardJson } from '../../rewards-chain/dist/index.js';
import { literal as q } from './reward-integration-fixture.mjs';
import { finalActionDriverV3 } from './reward-final-action-driver-v3.mjs';
const id = n => `8c000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

// Receives only the enclosing validator's disposable database, unforked Anvil
// and synthetic operator. Never imports saved-demo or public-chain settings.
export async function finalPublicationV3Scenarios({ harness, scenario, fixture, reader, chain, operator, requests, packages, uploads }) {
  const { rpc, rpcSql, query, scalar, lock, waiting } = harness, { identity, draftId } = fixture;
  const table = 'app_private.reward_final_publications_v3', completed = [], changes = {};
  const actionsDriver = finalActionDriverV3({ identity, harness, reader, operator });
  const count = () => scalar(`select count(*) from ${table}`);
  const scope = slot => ({ chainId: 31337, draftId, slot, approvalId: requests[slot].requestId, uploadId: uploads[slot].requestId });
  let sequence = 990000;
  const newId = () => id(++sequence);
  const args = (s, c, document) => ({ p_actor_user_id: identity.userId, p_actor_session_id: identity.sessionId,
    p_chain_id: s.chainId, p_draft_id: s.draftId, p_slot: s.slot, p_approval_id: s.approvalId, p_upload_id: s.uploadId,
    p_request_id: c?.requestId ?? null, p_context_hash: c?.contextHash ?? null, p_package_hash: c?.packageHash ?? null,
    p_document_text: document ? canonicalRewardJson(document) : null });
  const http = async (s, change) => {
    const res = {};
    assert.equal(await dispatchFinalPublicationV3({ method: change ? 'POST' : 'GET' }, res,
      new URL(`http://127.0.0.1:3101/api/v1/organizer/rewards/drafts/${draftId}/final-publication/${s.slot}/${s.approvalId}/${s.uploadId}`), {
        config: () => ({ chainId: 31337 }), requireIdentity: async () => identity, readJsonBody: async () => change, rpc,
        applyPrivateSessionHeaders: () => res.private = true, sendSuccess: (_, data) => Object.assign(res, { status: 200, data }),
        sendError: (_, status, code) => Object.assign(res, { status, code }),
      }), true);
    assert.equal(res.private, true); return res;
  };
  for (const slot of [5, 6]) {
    const s = scope(slot), p = packages[slot];
    const read = (functionName, params = []) => reader.readContract({ address: p.campaignAddress, abi: rewardCampaignV3Abi, functionName, args: params });
    let binding;
    await scenario(`final slot ${slot} binds actual policy/publication clocks, rejects forged witnesses and preserves private Auth`, async () => {
      const f = await finalPublicationFactsV3(identity, s, undefined, rpc), d = composeFinalPublicationEvidenceV3(f);
      const preview = await http(s); assert.equal(preview.status, 200); assert.equal(preview.data.publication, null);
      assert.equal(d.reviewPeriod, '1'); assert.equal(d.clockKind, slot === 5 ? 'native_round_review' : 'final_round_review');
      assert.deepEqual(d.nativeRaces.map(r => r.finalPublicationId).sort(), f.source.policy.facts.native.document.races.map(r => r.review.finalPublicationId).sort());
      const c = { requestId: newId(), contextHash: preview.data.contextHash, packageHash: preview.data.packageHash, evidenceHash: preview.data.evidenceHash };
      const sqlArgs = args(s, c, d), before = await count();
      const roleWrite = JSON.parse(await query(`begin;alter role service_role bypassrls;set local role service_role;
        ${rpcSql('service_reward_final_publication_v3', sqlArgs)} rollback;`));
      assert.equal(roleWrite.publication.id, c.requestId); assert.equal(await count(), before);
      for (const change of [x => x.reviewStartedAt = '1', x => x.officialPublishedAt = '2',
        x => x.sourceReview.guardHash = 'a'.repeat(64), x => x.nativeRaces[0].policyId = newId(),
        x => x.nativeRaces[0].finalPublicationId = newId(), x => x.slot = slot === 5 ? 6 : 5]) {
        const bad = structuredClone(d); change(bad);
        await assert.rejects(query(rpcSql('service_reward_final_publication_v3', { ...sqlArgs, p_document_text: canonicalRewardJson(bad) })),
          /invalid_reward_final_publication/);
      }
      // The SQL witness independently refuses a package policy mismatch.
      const raw = JSON.parse(await query(rpcSql('service_reward_final_publication_v3', args(s))));
      const v = { source: raw.source, registry: raw.registry, contextHash: raw.upload.contextHash,
        approval: { id: raw.upload.approvalId, current: true } };
      const u = structuredClone(raw.upload); u.prepared.package.reviewPeriod = '86400';
      await assert.rejects(query(`select app_private.reward_final_publication_evidence_v3(${q(JSON.stringify(v))}::jsonb,${q(JSON.stringify(u))}::jsonb);`),
        /reward_final_review_policy_mismatch/);
      // Source correction inside the INSERT must roll back the attestation and
      // correction together. This temporary trigger exists only in this TX.
      await assert.rejects(query(`begin;create function pg_temp.final_publication_test_drift() returns trigger language plpgsql as $body$
        begin update public.result_rows set finish_time_ms=finish_time_ms+1 where id=${q(id(983021))}; return new; end $body$;
        create trigger final_publication_test_drift after insert on ${table} for each row execute function pg_temp.final_publication_test_drift();
        ${rpcSql('service_reward_final_publication_v3', sqlArgs)} rollback;`), /reward_planning_revision_changed/);
      assert.equal(await count(), before);
      const release = await lock(`lock table ${table} in share mode`);
      const pending = assert.rejects(query(rpcSql('service_reward_final_publication_v3', sqlArgs)), /reward_account_session_required/); pending.catch(() => {});
      try { await waiting(1); await query(`update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${q(identity.sessionId)}`); }
      finally { await release(); } await pending;
      await query(`update auth.sessions set not_after=clock_timestamp()+interval '1 hour' where id=${q(identity.sessionId)}`);
      assert.equal(await count(), before);
      const pair = await Promise.all([http(s, c), http(s, c)]);
      assert.equal(pair[0].status, 200); assert.deepEqual(pair[0], pair[1]);
      assert.equal(pair[0].data.publicationBound, true); assert.equal(pair[0].data.stageReady, false); assert.equal(pair[0].data.payableWei, '0');
      assert.doesNotMatch(JSON.stringify(pair[0]), /nativeRaces|snapshotSalt|sessionId|privateKey|beneficiaryId/);
      assert.equal(await count(), before + 1); binding = pair[0].data.publication.binding; changes[slot] = c;
      assert.equal((await http(s, { ...c, requestId: newId() })).status, 409);
      await assert.rejects(query(`update ${table} set document_text=document_text where id=${q(c.requestId)}`), /reward_ledger_is_immutable/);
      await assert.rejects(query(`delete from ${table} where id=${q(c.requestId)}`), /reward_ledger_is_immutable/);
      assert.equal(await read('state'), 1); assert.equal(await read('paid', [p.enabledPot]), 0n);
    });
    await scenario(`final slot ${slot} stages and activates exact official evidence through durable contract jobs with no second review timer`, async () => {
      let predecessorId = (await readProgrammeExecutionStatusV3(identity, s, rpc)).steps.at(-1).intentId;
      const fees = { gasLimit: '12000000', maxFeePerGas: '10000000000', maxPriorityFeePerGas: '0', maxGasCostWei: '200000000000000000' };
      for (const action of ['stage_allocation', 'activate']) {
        const input = { ...s, intentId: newId(), predecessorId, body: { action, batchStart: null, batchSize: null,
          packageHash: uploads[slot].packageHash, publication: binding, ...fees } };
        if (action === 'stage_allocation') await assert.rejects(prepareProgrammeLifecycleV3(identity,
          { ...input, body: { ...input.body, publication: { ...binding, publicationEvidenceHash: '0x' + 'f'.repeat(64) } } }, { reader, rpc }),
          { code: 'reward_round_publication_conflict' });
        const plan = await actionsDriver.prepare(input);
        assert.deepEqual(await prepareProgrammeLifecycleV3(identity, input, { reader: {}, rpc }), plan);
        const selected = { ...input, attemptId: newId(), jobId: newId(), workerId: newId() };
        const { signedTransaction, ...signed } = await actionsDriver.sign(selected);
        await actionsDriver.queue(selected, signed.transactionHash);
        let broadcasts = 0;
        const broadcast = async tx => { broadcasts++; assert.equal(tx, signedTransaction);
          const hash = await reader.sendRawTransaction({ serializedTransaction: tx });
          if (action === 'stage_allocation') throw Error('synthetic lost send reply'); return hash; };
        if (slot === 6 && action === 'activate') {
          let drifted = false;
          const driftRpc = async (name, a) => {
            if (name === 'service_step_reward_programme_lifecycle_job_v3' && a.p_action === 'arm' && !drifted) {
              drifted = true; await query(`update public.result_rows set finish_time_ms=finish_time_ms+1 where id=${q(id(983021))}`);
            } return rpc(name, a);
          };
          try { assert.equal((await actionsDriver.run(selected, { reader, rpc: driftRpc, broadcast }, p.programmeAddress)).outcome, 'held');
            assert.equal(drifted, true); assert.equal(broadcasts, 0); }
          finally { if (drifted) await query(`update public.result_rows set finish_time_ms=finish_time_ms-1 where id=${q(id(983021))}`); }
        }
        assert.equal((await actionsDriver.run(selected, { reader, rpc, broadcast }, p.programmeAddress)).outcome,
          action === 'stage_allocation' ? 'broadcast_unknown' : 'submitted');
        assert.equal((await reader.waitForTransactionReceipt({ hash: signed.transactionHash, timeout: 10000 })).status, 'success');
        await chain.testClient.mine({ blocks: 96, interval: 1 });
        assert.equal((await actionsDriver.run(selected, { reader, rpc, broadcast }, p.programmeAddress)).outcome, 'confirmed');
        const saved = await readProgrammeLifecycleJobV3(identity, selected, rpc), accounting = saved.receipt.body.accountingAtReceiptBlock;
        assert.equal(accounting.state, action === 'stage_allocation' ? 2 : 3);
        if (action === 'stage_allocation') assert.equal(accounting.activationNotBefore, saved.receipt.body.blockTimestamp);
        assert.equal(accounting.paid[p.enabledPot], 0n); assert.equal(await read('publicationEvidenceHash'), binding.publicationEvidenceHash);
        assert.equal(await read('reviewStartedAt'), BigInt(binding.reviewStartedAt)); assert.equal(await read('officialPublishedAt'), BigInt(binding.officialPublishedAt));
        assert.equal((await runProgrammeLifecycleJobV3(identity, selected, { reader: {}, rpc, broadcast: () => assert.fail('confirmed retry must not send') })).outcome, 'confirmed');
        assert.equal(broadcasts, 1); completed.push(selected); predecessorId = input.intentId;
      }
      assert.equal(await read('state'), 3); assert.equal(await read('paid', [0]), 0n); assert.equal(await read('paid', [1]), 0n);
      assert.deepEqual((await readProgrammeExecutionStatusV3(identity, s, rpc)).steps.slice(-2).map(x => [x.action, x.state]),
        [['stage_allocation', 'confirmed'], ['activate', 'confirmed']]);
    });
  }
  await scenario('final publication persistence is service-only, invoker and append-only', async () => {
    assert.equal(await scalar(`select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
      and p.proname='service_reward_final_publication_v3' and not p.prosecdef and has_function_privilege('service_role',p.oid,'execute')
      and not has_function_privilege('anon',p.oid,'execute') and not has_function_privilege('authenticated',p.oid,'execute')`), 1);
    assert.equal(await scalar(`select has_table_privilege('anon','${table}','select') or has_table_privilege('authenticated','${table}','select')
      or has_table_privilege('service_role','${table}','update') or has_table_privilege('service_role','${table}','delete')`), false);
    assert.equal(await count(), 2);
  });
  return async () => {
    for (const slot of [5, 6]) {
      const v = await finalPublicationV3(identity, scope(slot), changes[slot], rpc);
      assert.equal(v.historicalAcknowledgement, true); assert.equal(v.publicationBound, slot === 5); assert.equal(v.current, slot === 5);
    }
    for (const s of completed) {
      assert.equal((await loadVerifiedProgrammeLifecycleV3(identity, s, rpc)).status, s.slot === 5 ? 'current' : 'held');
      assert.equal((await readProgrammeLifecycleJobV3(identity, s, rpc)).job.state, 'confirmed');
    }
  };
}
