import { workflowHttpFixtureV3, programmeWorkflowTargetV3 } from "../../../apps/api/test/fixtures/reward-workflow-v3.mjs";
import assert from 'node:assert/strict';
import { dispatchProgrammeActionsV3 } from '../../../apps/api/dist/routes/rewards/programme-actions-v3.js';
import { prepareProgrammeLifecycleV3, loadVerifiedProgrammeLifecycleV3 } from '../../../apps/api/dist/features/rewards/programme-lifecycle-v3-service.js';
import { inspectProgrammeSigningV3, signProgrammeV3 } from '../../../apps/api/dist/features/rewards/programme-signing-v3.js';
import { runAuthenticatedProgrammeOperatorV3 } from '../../../apps/api/dist/features/rewards/programme-operator-v3.js';
import { createProgrammeSigningClientV3 } from '../dist/rewards/index.js';
import { programmeOperatorAuthFixtureV3 } from '../../../apps/api/test/fixtures/reward-programme-operator-v3.mjs';
import { literal as q } from './reward-integration-fixture.mjs';
const sourceRow = '8c000000-0000-4000-8000-000000983021';

/** Test adapter only: real HTTP dispatch, SDK signature verification, SQL and
 * owned-chain transactions. Auth authority/operator are explicitly synthetic;
 * this is not a real browser, Supabase login or hosted CLI acceptance. */
export function finalActionDriverV3({ identity, harness, reader, operator }) {
  const { rpc, query } = harness;
  const scheduled = new Map();
  async function http(s, change) {
    const res = {};
    assert.equal(await dispatchProgrammeActionsV3({ method: change ? 'POST' : 'GET' }, res,
      new URL(`http://127.0.0.1:3101/api/v1/organizer/rewards/drafts/${s.draftId}/final-allocation-actions/${s.slot}/${s.approvalId}/${s.uploadId}`), {
        config: () => ({ chainId: s.chainId }), requireIdentity: async () => identity, readJsonBody: async () => change,
        rpc, programmeActionReader: reader, applyPrivateSessionHeaders: () => res.private = true,
        sendSuccess: (_, data) => Object.assign(res, { status: 200, data }), sendError: (_, status, code) => Object.assign(res, { status, code }),
      }), true);
    assert.equal(res.private, true); return res;
  }
  return {
    http,
    prepare: async input => {
      const { gasLimit, maxFeePerGas, maxPriorityFeePerGas, maxGasCostWei } = input.body;
      const c = { kind: 'prepare', requestId: input.intentId, expectedPredecessorId: input.predecessorId,
        packageHash: input.body.packageHash, fees: { gasLimit, maxFeePerGas, maxPriorityFeePerGas, maxGasCostWei } };
      const first = await http(input, c); assert.equal(first.status, 200, first.code);
      assert.equal(first.data.schema, 'raceson-final-programme-actions-v3'); assert.equal(first.data.selected.intentId, input.intentId);
      assert.equal(first.data.execution.steps.at(-1).action, input.body.action);
      assert.deepEqual((await http(input, c)).data, first.data);
      assert.doesNotMatch(JSON.stringify(first), /signedTransaction|snapshotSalt|leaseToken|beneficiaryId|sessionId/);
      // An exact private reload proves the action API stored the intended plan,
      // not a new test-only or caller-clock reservation.
      return prepareProgrammeLifecycleV3(identity, input, { reader: {}, rpc });
    },
    sign: async selected => {
      const controller = new AbortController();
      const auth = programmeOperatorAuthFixtureV3(identity, rpc, createProgrammeSigningClientV3);
      const client = auth.clientFactory({ target: auth.target, ...auth.credentials, signal: controller.signal });
      await client.authenticate(auth.credentials.accessToken, identity.userId);
      const deps = { reader, rpc: client.rpc, signal: controller.signal };
      try {
        const preview = await inspectProgrammeSigningV3(identity, selected, deps);
        const input = { ...selected, planHash: preview.plan.planHash };
        await assert.rejects(signProgrammeV3(identity, { ...input, planHash: '0x' + 'f'.repeat(64) },
          { ...deps, loadSigner: () => assert.fail('unapproved plan cannot load a key') }), /reward_programme_signing_plan_changed/);
        if (selected.slot === 6 && selected.body.action === 'activate') {
          let changed = false;
          try {
            await assert.rejects(signProgrammeV3(identity, input, { ...deps, loadSigner: async () => {
              changed = true; await query(`update public.result_rows set finish_time_ms=finish_time_ms+1 where id=${q(sourceRow)}`);
              return { address: operator.address, signTransaction: () => assert.fail('source drift during key retrieval must deny signing') };
            } }), /reward_allocation_not_ready/);
            assert.equal(changed, true);
          } finally { if (changed) await query(`update public.result_rows set finish_time_ms=finish_time_ms-1 where id=${q(sourceRow)}`); }
        }
        let signatures = 0;
        const workflow = workflowHttpFixtureV3({ identity, rpc: client.rpc, reader, loadSigner: async () => ({ address: operator.address,
          signTransaction: tx => { signatures++; return operator.signTransaction(tx); } }) });
        try {
          const target = programmeWorkflowTargetV3(selected);
          const inspected = await workflow.http('inspect', { target }); assert.equal(inspected.status, 200, inspected.code);
          assert.equal(inspected.data.plan.planHash, preview.plan.planHash);
          assert.equal((await workflow.http('sign', { target, planHash: '0x' + 'f'.repeat(64) })).status, 409);
          const result = await workflow.http('sign', { target, planHash: preview.plan.planHash });
          assert.equal(result.status, 200, result.code); assert.equal(result.data.recorded, true);
          assert.deepEqual((await workflow.http('sign', { target, planHash: preview.plan.planHash })).data, result.data);
        } finally { workflow.close(); }
        const record = await signProgrammeV3(identity, input, { ...deps, loadSigner: () => assert.fail('already recorded by HTTP') });
        assert.equal(signatures, 1); assert.equal(record.recorded, true);
        const retry = await signProgrammeV3(identity, input, { ...deps, reader: {}, loadSigner: () => assert.fail('recorded retry must not load signer') });
        assert.deepEqual(retry, record); assert.doesNotMatch(JSON.stringify(record), /signedTransaction|privateKey|snapshotSalt|sessionId/);
        const verified = await loadVerifiedProgrammeLifecycleV3(identity, selected, rpc);
        assert.equal(record.transactionHash, verified.verified.transactionHash);
        return { ...record, signedTransaction: verified.verified.signedTransaction };
      } finally { controller.abort(); }
    },
    queue: async (selected, transactionHash) => {
      const c = { kind: 'queue', requestId: selected.jobId, intentId: selected.intentId, attemptId: selected.attemptId,
        transactionHash, packageHash: selected.body.packageHash };
      assert.equal((await http(selected, { ...c, transactionHash: '0x' + 'f'.repeat(64) })).status, 409);
      const first = await http(selected, c); assert.equal(first.status, 200, first.code);
      assert.deepEqual((await http(selected, c)).data, first.data);
    },
    run: async (selected, deps, programmeAddress) => {
      const auth = programmeOperatorAuthFixtureV3(identity, deps.rpc ?? rpc);
      const stored = await loadVerifiedProgrammeLifecycleV3(identity, selected, rpc);
      const job = { slot: selected.slot, approvalId: selected.approvalId, uploadId: selected.uploadId,
        intentId: selected.intentId, attemptId: selected.attemptId, jobId: selected.jobId, transactionHash: stored.verified.transactionHash };
      let pending = scheduled.get(selected.jobId);
      if (!pending) {
        const current = { deps };
        const workflow = workflowHttpFixtureV3({ identity, reader: deps.reader,
          rpc: (name, args) => (current.deps.rpc ?? rpc)(name, args), broadcast: bytes => current.deps.broadcast(bytes) });
        pending = { current, workflow }; scheduled.set(selected.jobId, pending);
      }
      pending.current.deps = deps;
      const result = await pending.workflow.deliver({ target: programmeWorkflowTargetV3(selected), jobId: selected.jobId,
        transactionHash: stored.verified.transactionHash });
      assert.equal(result.jobId, selected.jobId);
      if (result.outcome === 'confirmed') { pending.workflow.close(); scheduled.delete(selected.jobId); }
      return result;
    },
  };
}
