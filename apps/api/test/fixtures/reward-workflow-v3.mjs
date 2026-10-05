import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkflowRuntimeV3 } from '../../dist/features/rewards/workflow-v3-service.js';
import { WorkflowScheduleStoreV3, runWorkflowSchedulerPassV3 } from '../../dist/features/rewards/workflow-v3-scheduler.js';
import { dispatchWorkflowV3 } from '../../dist/routes/rewards/workflow-v3.js';
/** Synthetic host authority only. Services/SQL/crypto/owned-chain IO remain real.
 * All signers originate in the existing disposable chain fixture. */
export function workflowHttpFixtureV3({ identity, rpc, reader, loadSigner, loadApprovalSigner, broadcast, active = () => {} }) {
  const timings = [];
  const directory = mkdtempSync(join(tmpdir(), 'reward-workflow-sql-'));
  const target = { mode: 'local', chainId: 31337, origin: 'http://127.0.0.1:3101', supabaseUrl: 'http://127.0.0.1:55321' };
  const runtime = createWorkflowRuntimeV3({ target, rpc, reader, trace: event => timings.push(event), loadSigner: loadSigner ?? (() => assert.fail('no key loading')),
    loadApprovalSigner: loadApprovalSigner ?? (() => assert.fail('no approval signing')), broadcast: broadcast ?? (() => assert.fail('no broadcasting')),
    authorize: async actor => { assert.deepEqual(actor, identity); active(); return { expiresAtMs: Date.now() + 60000, assertActive: active }; } });
  const store = new WorkflowScheduleStoreV3(directory);
  const close = () => { process.removeListener("exit", close); rmSync(directory, { recursive: true, force: true }); };
  process.once("exit", close);
  return {
    runtime, store, timings,
    close,
    async http(operation, body) {
      const response = {};
      const handled = await dispatchWorkflowV3({ method: 'POST' }, response,
        new URL(`/api/v1/organizer/rewards/workflow-v3/${operation}`, target.origin), {
          config: () => target, requireIdentity: async () => identity, readJsonBody: async () => body, rpc,
          applyPrivateSessionHeaders: () => response.private = true,
          sendSuccess: (_, data) => Object.assign(response, { status: 200, data }),
          sendError: (_, status, code) => Object.assign(response, { status, code }),
        }, { runtime, store });
      assert.equal(handled, true); assert.equal(response.private, true);
      assert.doesNotMatch(JSON.stringify(response), /signedTransaction|privateKey|accessToken|sessionId|leaseToken|signature|dateOfBirth/);
      return response;
    },
    async deliver(job) {
      const scheduled = await this.http('schedule', job); assert.equal(scheduled.status, 200, scheduled.code);
      const result = await runWorkflowSchedulerPassV3(store, runtime, async userId => { assert.equal(userId, identity.userId); return identity; }, { now: Date.now() + 1000000 });
      assert.equal(result.entries.length, 1); return result.entries[0];
    },
  };
}
export const programmeWorkflowTargetV3 = s => ({ kind: 'programme', draftId: s.draftId, slot: s.slot,
  approvalId: s.approvalId, uploadId: s.uploadId, intentId: s.intentId, attemptId: s.attemptId });
export const athleteWorkflowTargetV3 = s => ({ kind: 'athlete', uploadId: s.uploadId, destinationId: s.destinationId,
  entitlementId: s.entitlementId, claimId: s.claimId, paymentId: s.paymentId, attemptId: s.attemptId });
