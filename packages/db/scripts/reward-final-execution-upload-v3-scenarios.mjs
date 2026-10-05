import assert from 'node:assert/strict';
import { readProgrammeLifecycleV3, readProgrammeLifecycleJobV3, readProgrammeExecutionStatusV3,
  readAllocationUploadV3 } from '../dist/rewards/index.js';
import { prepareProgrammeLifecycleV3, recordSignedProgrammeLifecycleV3, loadVerifiedProgrammeLifecycleV3 }
  from '../../../apps/api/dist/features/rewards/programme-lifecycle-v3-service.js';
import { queueVerifiedProgrammeLifecycleV3, runProgrammeLifecycleJobV3 }
  from '../../../apps/api/dist/features/rewards/programme-lifecycle-worker-v3.js';
import { encodeRewardProgrammeLifecycleV3 } from '../../rewards-chain/dist/programme-lifecycle-v3.js';
import { rewardCampaignV3Abi } from '../../rewards-chain/dist/campaign-v3.js';
import { programmeExecutionProgressV3 } from '../../domain/dist/rewards/programme-execution-status-v3.js';
import { literal as q } from './reward-integration-fixture.mjs';
import { finalActionDriverV3 } from './reward-final-action-driver-v3.mjs';
const id = n => `8c000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

// Only called with the parent validator's disposable SQL, unforked local chain
// and synthetic operator. No saved demo, athlete key or public RPC is imported.
export async function finalExecutionUploadV3Scenarios({ harness, scenario, fixture, reader, chain, operator, requests, packages, uploads }) {
  const { rpc, rpcSql, query, scalar, lock, waiting } = harness, { identity, draftId } = fixture;
  const table = 'app_private.reward_programme_lifecycle_intents_v3';
  const fees = { gasLimit: '12000000', maxFeePerGas: '10000000000', maxPriorityFeePerGas: '0', maxGasCostWei: '200000000000000000' };
  const completed = [];
  const actionsDriver = finalActionDriverV3({ identity, harness, reader, operator });
  let sequence = 989000;
  const newId = () => id(++sequence);
  for (const slot of [5, 6]) {
    const p = packages[slot], scope = { chainId: 31337, draftId, slot, approvalId: requests[slot].requestId, uploadId: uploads[slot].requestId };
    const body = (action, batchStart = null, batchSize = null) => ({ action, batchStart, batchSize, packageHash: uploads[slot].packageHash, ...fees });
    const read = (functionName, args = []) => reader.readContract({ address: p.campaignAddress, abi: rewardCampaignV3Abi, functionName, args });
    const close = { ...scope, intentId: newId(), predecessorId: null, body: body('complete_funding') };
    const args = input => ({ p_actor_user_id: identity.userId, p_actor_session_id: identity.sessionId, p_chain_id: 31337,
      p_draft_id: draftId, p_slot: slot, p_approval_id: scope.approvalId, p_upload_id: scope.uploadId, p_intent_id: input.intentId });
    await scenario(`final slot ${slot} selects its strict source decoder and refuses stale Auth without a nonce`, async () => {
      const v = await readProgrammeLifecycleV3(identity, close, rpc);
      assert.equal(v.upload.document.schema, 'raceson-allocation-document-v3.2'); assert.equal(v.upload.document.enabledPot, p.enabledPot);
      assert.equal(v.upload.current, true); assert.equal(v.intent, null);
      const roleRead = JSON.parse(await query(`begin;alter role service_role bypassrls;set local role service_role;
        ${rpcSql('service_read_reward_programme_lifecycle_v3', args(close))} rollback;`));
      assert.equal(roleRead.upload.document.schema, 'raceson-allocation-document-v3.2');
      assert.equal(roleRead.upload.document.slot, slot);
      const other = slot === 5 ? 6 : 5;
      await assert.rejects(readProgrammeLifecycleV3(identity, { ...close, approvalId: requests[other].requestId,
        uploadId: uploads[other].requestId }, rpc), { code: 'reward_allocation_upload_not_found' });
      assert.deepEqual(programmeExecutionProgressV3(await readProgrammeExecutionStatusV3(identity, scope, rpc)),
        { fundingClosed: false, uploaded: 0, uploadComplete: false });
      await assert.rejects(readAllocationUploadV3(identity, scope, () => assert.fail('historical upload must stay narrow')));
      const before = await scalar(`select count(*) from ${table}`);
      const release = await lock(`lock table ${table} in share mode`);
      const pending = assert.rejects(query(rpcSql('service_reserve_reward_programme_lifecycle_v3', { ...args(close),
        p_predecessor_id: null, p_pending_nonce: String(await reader.getTransactionCount({ address: operator.address, blockTag: 'pending' })), p_body: close.body })),
        /reward_account_session_required/); pending.catch(() => {});
      try { await waiting(1); await query(`update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${q(identity.sessionId)}`); }
      finally { await release(); }
      await pending;
      await query(`update auth.sessions set not_after=clock_timestamp()+interval '1 hour' where id=${q(identity.sessionId)}`);
      assert.equal(await scalar(`select count(*) from ${table}`), before);
    });
    if (slot === 6 && p.awards.length > 2) await scenario('league worker retains two-award multi-batch coverage separately from automatic organizer batching', async () => {
      // Both state stores are owned disposable fixtures. Roll back the SQL
      // transaction and chain snapshot together, never a saved demo or public RPC.
      const snapshot = await chain.testClient.snapshot();
      try {
        await harness.rollbackFixture(async ({ rpc: scratchRpc }) => {
          let previous = null;
          const batches = [{ ...scope, intentId: newId(), body: body('complete_funding') }];
          for (let start = 0; start < p.awards.length; start += 2)
            batches.push({ ...scope, intentId: newId(), body: body('upload_awards', start, Math.min(2, p.awards.length - start)) });
          for (const action of batches) {
            const input = { ...action, predecessorId: previous };
            const prepared = await prepareProgrammeLifecycleV3(identity, input, { reader, rpc: scratchRpc });
            const encoded = encodeRewardProgrammeLifecycleV3(prepared.plan);
            const gas = (await reader.estimateGas({ account: operator.address, to: encoded.to, data: encoded.data })) * 12n / 10n;
            const signedTransaction = await operator.signTransaction({ ...encoded, type: 'eip1559', gas, maxFeePerGas: 10_000_000_000n, maxPriorityFeePerGas: 0n });
            const selected = { ...input, attemptId: newId(), jobId: newId(), workerId: newId() };
            const signed = await recordSignedProgrammeLifecycleV3(identity, { ...selected, signedTransaction }, scratchRpc);
            await queueVerifiedProgrammeLifecycleV3(identity, selected, scratchRpc);
            const deps = { reader, rpc: scratchRpc, broadcast: tx => reader.sendRawTransaction({ serializedTransaction: tx }) };
            assert.equal((await runProgrammeLifecycleJobV3(identity, selected, deps)).outcome, 'submitted');
            await reader.waitForTransactionReceipt({ hash: signed.transactionHash, timeout: 10000 });
            await chain.testClient.mine({ blocks: 96, interval: 1 });
            assert.equal((await runProgrammeLifecycleJobV3(identity, selected, deps)).outcome, 'confirmed');
            if (action.body.action === 'upload_awards') assert.equal(await read('entitlementCount'), BigInt(action.body.batchStart + action.body.batchSize));
            previous = input.intentId;
          }
          assert.equal(await read('uploadDigest'), p.uploadDigest); assert.equal(await read('paid', [1]), 0n);
        });
      } finally { await chain.testClient.revert({ id: snapshot }); }
      assert.equal(await read('state'), 0);
      assert.deepEqual((await readProgrammeExecutionStatusV3(identity, scope, rpc)).steps, []);
    });
    let predecessorId = null;
    const actions = [close];
    // Follow the actual organizer API's bounded automatic batching.
    for (let start = 0; start < p.awards.length; start += 64)
      actions.push({ ...scope, intentId: newId(), body: body('upload_awards', start, Math.min(64, p.awards.length - start)) });
    await scenario(`final slot ${slot} executes persisted closure and ordered uploads through durable jobs, with exact retry recovery`, async () => {
      assert.equal(await read('state'), 0);
      for (const [index, action] of actions.entries()) {
        const input = { ...action, predecessorId }, deps = { reader, rpc };
        const [prepared, duplicate] = await Promise.all([actionsDriver.prepare(input), actionsDriver.prepare(input)]);
        assert.deepEqual(prepared, duplicate);
        assert.deepEqual(await prepareProgrammeLifecycleV3(identity, input, { rpc,
          reader: new Proxy({}, { get() { assert.fail('exact retry must not inspect chain'); } }) }), prepared);
        const selected = { ...input, attemptId: newId(), jobId: newId(), workerId: newId() };
        const { signedTransaction, ...recorded } = await actionsDriver.sign(selected);
        await actionsDriver.queue(selected, recorded.transactionHash);
        assert.equal((await readProgrammeLifecycleJobV3(identity, selected, rpc)).job.state, 'queued');
        let broadcasts = 0;
        const broadcast = async signed => { broadcasts++; assert.equal(signed, signedTransaction);
          const hash = await reader.sendRawTransaction({ serializedTransaction: signed });
          if (index === 0) throw Error('synthetic lost send reply'); return hash;
        };
        if (slot === 6 && index === 0) {
          let drifted = false;
          const drift = async (name, a) => {
            if (name === 'service_step_reward_programme_lifecycle_job_v3' && a.p_action === 'arm' && !drifted) {
              drifted = true; await query(`update public.result_rows set finish_time_ms=finish_time_ms+1 where id=${q(id(983021))}`);
            }
            return rpc(name, a);
          };
          try {
            assert.equal((await runProgrammeLifecycleJobV3(identity, selected, { reader, rpc: drift, broadcast })).outcome, 'held');
            assert.equal(drifted, true); assert.equal(broadcasts, 0);
          } finally { if (drifted) await query(`update public.result_rows set finish_time_ms=finish_time_ms-1 where id=${q(id(983021))}`); }
        }
        assert.equal((await runProgrammeLifecycleJobV3(identity, selected, { reader, rpc, broadcast })).outcome,
          index === 0 ? 'broadcast_unknown' : 'submitted');
        assert.equal((await reader.waitForTransactionReceipt({ hash: recorded.transactionHash, timeout: 10000 })).status, 'success');
        await chain.testClient.mine({ blocks: 96, interval: 1 });
        if (slot === 6 && index === 0) {
          let rejected = false;
          const swapped = async (name, a) => {
            if (name === 'service_step_reward_programme_lifecycle_job_v3' && a.p_action === 'confirm') {
              const wrong = structuredClone(a);
              for (const key of ['budgets', 'allocated', 'paid']) wrong.p_receipt.accountingAtReceiptBlock[key].reverse();
              const r = await rpc(name, wrong); assert.equal(r.error?.message, 'invalid_reward_campaign_accounting'); rejected = true; return r;
            }
            return rpc(name, a);
          };
          assert.equal((await runProgrammeLifecycleJobV3(identity, selected, { reader, rpc: swapped, broadcast })).outcome, 'unavailable');
          assert.equal(rejected, true); assert.equal((await readProgrammeLifecycleJobV3(identity, selected, rpc)).receipt, null);
        }
        assert.equal((await runProgrammeLifecycleJobV3(identity, selected, { reader, rpc, broadcast })).outcome, 'confirmed');
        const saved = await readProgrammeLifecycleJobV3(identity, selected, rpc);
        assert.equal(saved.receipt.body.provenance.slot, slot - 1);
        assert.equal(saved.receipt.body.accountingAtReceiptBlock.budgets[p.enabledPot], BigInt(p.budgetWei));
        assert.equal(saved.receipt.body.accountingAtReceiptBlock.paid[p.enabledPot], 0n);
        assert.equal((await runProgrammeLifecycleJobV3(identity, selected, { rpc, reader: {},
          broadcast: () => assert.fail('confirmed job cannot send again') })).outcome, 'confirmed');
        assert.equal(broadcasts, 1); predecessorId = input.intentId; completed.push(selected);
      }
      const view = await readProgrammeExecutionStatusV3(identity, scope, rpc);
      assert.deepEqual(programmeExecutionProgressV3(view), { fundingClosed: true, uploaded: p.awards.length, uploadComplete: true });
      assert.doesNotMatch(JSON.stringify(view), /signedTransaction|snapshotSalt|leaseToken|beneficiaryId|sessionId/);
      assert.equal(await read('uploadDigest'), p.uploadDigest); assert.equal(await read('entitlementCount'), BigInt(p.entitlementCount));
      assert.equal(await read('allocated', [p.enabledPot]), BigInt(p.allocatedWei)); assert.equal(await read('allocated', [1 - p.enabledPot]), 0n);
      assert.equal(await read('paid', [0]), 0n); assert.equal(await read('paid', [1]), 0n); assert.equal(await read('state'), 1);
    });
    await scenario(`final slot ${slot} cannot use synthetic/historical publication or direct inserts to stage`, async () => {
      const input = { ...scope, intentId: newId(), predecessorId, body: { ...body('stage_allocation'), publication: {
        reviewId: newId(), publicationId: newId(), reviewPeriod: p.reviewPeriod, reviewStartedAt: '1', officialPublishedAt: String(1 + Number(p.reviewPeriod)),
        publicationEvidenceHash: '0x' + '1'.repeat(64) } } };
      await assert.rejects(prepareProgrammeLifecycleV3(identity, input, { reader, rpc }), { code: 'reward_final_publication_required' });
      await assert.rejects(query(rpcSql('service_reserve_reward_programme_activation_v3', { ...args(input),
        p_predecessor_id: predecessorId, p_pending_nonce: '0', p_body: input.body })), /reward_final_publication_required/);
      const last = await readProgrammeLifecycleV3(identity, { ...scope, intentId: predecessorId }, rpc);
      await assert.rejects(query(`begin;insert into ${table}(id,programme_intent_id,upload_id,slot,step,predecessor_id,chain_id,
        operator_address,nonce,body,created_by_user_id) values(${q(input.intentId)},${q(last.intent.programmeIntentId)},${q(scope.uploadId)},${slot},
        ${last.intent.step + 1},${q(predecessorId)},31337,${q(operator.address.toLowerCase())},${last.intent.nonce + 1n},
        ${q(JSON.stringify(input.body))}::jsonb,${q(identity.userId)});rollback;`),
        /reward_final_publication_required/);
      assert.equal(await read('state'), 1);
    });
  }
  return async () => {
    for (const s of completed) {
      const v = await loadVerifiedProgrammeLifecycleV3(identity, s, rpc);
      assert.equal(v.status, s.slot === 5 ? 'current' : 'held');
      assert.equal((await readProgrammeLifecycleJobV3(identity, s, rpc)).job.state, 'confirmed');
      assert.equal((await readProgrammeExecutionStatusV3(identity, s, rpc)).current, s.slot === 5);
    }
  };
}
