import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createReadOnlyWorkflowHostV3, createWorkflowHostControllerV3 } from '../dist/features/rewards/workflow-v3-host.js';
import { WorkflowScheduleStoreV3 } from '../dist/features/rewards/workflow-v3-scheduler.js';
import { dispatchWorkflowV3 } from '../dist/routes/rewards/workflow-v3.js';

const id = n => `aa100000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const hash = n => `0x${String(n).padStart(64, '0')}`;
const actor = { userId: id(1), sessionId: id(2) };
const demo = { mode: 'local', chainId: 31337, origin: 'http://127.0.0.1:3101', supabaseUrl: 'http://127.0.0.1:55321' };
const target = slot => ({ kind: 'programme', draftId: id(3), slot, approvalId: id(10 + slot), uploadId: id(20 + slot),
  intentId: id(30 + slot), attemptId: id(40 + slot) });
const job = slot => ({ target: target(slot), jobId: id(50 + slot), transactionHash: hash(60 + slot) });
const noIO = () => assert.fail('No key, broadcast or unapproved IO');
function directory(t) {
  const path = mkdtempSync(join(tmpdir(), 'reward-host-fixture-'));
  t.after(() => rmSync(path, { recursive: true, force: true })); return path;
}
// Explicit SQL transport fixture, NOT live Auth, sporting results or testnet evidence.
function ledger(slot, confirmed = true) {
  const r = job(slot), zero = hash(0), time = '2026-09-10T00:00:00Z';
  return { schema: 'raceson-programme-lifecycle-job-v3', job: {
    jobId: r.jobId, intentId: r.target.intentId, attemptId: r.target.attemptId, transactionHash: r.transactionHash,
    createdByUserId: actor.userId, createdAt: time, state: confirmed ? 'confirmed' : 'queued', mayHaveBroadcast: confirmed,
    leaseOwner: null, leaseToken: null, leaseExpiresAt: null, leaseGeneration: confirmed ? 1 : 0,
  }, receipt: confirmed ? { recordedAt: time, recordedByUserId: actor.userId, body: {
    protocolVersion: 3, provenance: { kind: 'programme-child', programmeAddress: '0x' + '1'.repeat(40), deploymentTransactionHash: hash(1), slot: slot - 1 },
    action: 'complete_funding', campaignAddress: '0x' + '2'.repeat(40), transactionHash: r.transactionHash,
    nonce: '3', blockNumber: '10', blockHash: hash(11), blockTimestamp: '1000', gasUsed: '100', effectiveGasPrice: '2', feeWei: '200',
    finalizedBlock: { number: '11', hash: hash(12), timestamp: '1001' },
    accountingAtReceiptBlock: { state: 1, paused: false, accountedFunding: '10', treasuryReturned: '0',
      budgets: slot === 6 ? ['0', '10'] : ['10', '0'], allocated: ['0', '0'], paid: ['0', '0'], nativeBalance: '10',
      entitlementCount: '0', uploadDigest: zero, snapshotDigest: zero, allocationDigest: zero,
      activationNotBefore: '0', claimDeadline: '0', pausedAt: '0' },
    publicationAtReceiptBlock: { reviewPeriod: '86400', reviewStartedAt: '0', officialPublishedAt: '0', publicationEvidenceHash: zero },
  } } : null };
}
const rpc = async (method, args) => {
  assert.equal(method, 'service_read_reward_programme_lifecycle_job_v3');
  assert.equal(args.p_actor_user_id, actor.userId); assert.equal(args.p_actor_session_id, actor.sessionId);
  return { data: ledger(args.p_slot), error: null };
};
async function http(host, operation, body) {
  const res = {};
  await dispatchWorkflowV3({ method: 'POST' }, res, new URL(`/api/v1/organizer/rewards/workflow-v3/${operation}`, demo.origin), {
    config: () => demo, requireIdentity: async () => actor, readJsonBody: async () => body,
    applyPrivateSessionHeaders: () => res.private = true,
    sendSuccess: (_, data) => Object.assign(res, { status: 200, data }),
    sendError: (_, status, code) => Object.assign(res, { status, code }),
  }, host);
  return res;
}
function controller(t, overrides = {}) {
  const c = createWorkflowHostControllerV3({ target: demo, directory: directory(t), durationMs: 60_000,
    signal: new AbortController().signal, rpc, reader: {}, loadSigner: noIO, loadApprovalSigner: noIO, broadcast: noIO,
    authorize: async a => { assert.deepEqual(a, actor); return { expiresAtMs: Date.now() + 30_000, assertActive() {} }; }, ...overrides });
  t.after(c.close); return c;
}

test('read-only host connects all six exact saved receipts without signing, scheduling or exposing private fields', async t => {
  const store = new WorkflowScheduleStoreV3(directory(t));
  const host = createReadOnlyWorkflowHostV3({ target: demo, store, rpc, reader: {}, assertActive() {} });
  for (let slot = 1; slot <= 6; slot++) {
    const result = await http(host, 'status', job(slot));
    assert.equal(result.status, 200); assert.equal(result.private, true); assert.equal(result.data.confirmed, true);
    assert.equal(result.data.transactionHash, job(slot).transactionHash); assert.equal(result.data.scheduled, false);
    assert.doesNotMatch(JSON.stringify(result), /sessionId|leaseToken|signature|signedTransaction|privateKey/);
    for (const operation of ['sign', 'approve', 'schedule']) {
      const body = operation === 'schedule' ? job(slot) : { target: target(slot), planHash: hash(8) };
      assert.equal((await http(host, operation, body)).status, 403);
    }
  }
  assert.deepEqual(store.list(), []);
});

test('read-only reads preserve current SQL session denial and reject target changes', async t => {
  let active = true;
  const host = createReadOnlyWorkflowHostV3({ target: demo, store: new WorkflowScheduleStoreV3(directory(t)), reader: {},
    assertActive: () => { if (!active) throw Error('reward_workflow_not_configured'); },
    rpc: async () => ({ data: null, error: { message: 'reward_account_session_required' } }) });
  assert.equal((await http(host, 'status', job(1))).status, 401);
  active = false; assert.equal((await http(host, 'status', job(1))).status, 503);
});

test('private controller starts idle and checks delivery authority again after HTTP scheduling', async t => {
  const seen = [], c = controller(t, { authorize: async (a, operation, selected, binding) => {
    assert.deepEqual(a, actor); seen.push({ operation, selected, binding });
    return { expiresAtMs: Date.now() + 30_000, assertActive() {} };
  } });
  assert.equal(c.state().workerRunning, false); assert.equal(seen.length, 0);
  for (let slot = 1; slot <= 6; slot++) assert.equal((await http(c.host, 'schedule', job(slot))).status, 200);
  const result = await c.pass(); assert.equal(result.entries.length, 6);
  assert.ok(result.entries.every(e => e.outcome === 'confirmed'));
  assert.deepEqual(seen.map(e => e.operation), [...Array(6).fill('schedule'), ...Array(6).fill('deliver')]);
  assert.equal((await c.pass()).entries.length, 0); // terminal marker never repays
});

test('worker restart keeps exact jobs but requires a freshly authorized request before delivery', async t => {
  const path = directory(t), first = controller(t, { directory: path });
  await http(first.host, 'schedule', job(1)); first.close();
  const second = controller(t, { directory: path });
  assert.equal((await second.pass()).entries[0].outcome, 'authorization_required');
  assert.equal((await http(second.host, 'status', job(1))).status, 200);
  // Owned fixture advances retry time; no send marker or real ledger is altered.
  second.host.store.record(job(1).jobId, { ...second.host.store.progress(job(1).jobId), nextAttemptAt: 0 });
  assert.equal((await second.pass()).entries[0].outcome, 'confirmed');
  for (const name of readdirSync(path)) assert.doesNotMatch(readFileSync(join(path, name), 'utf8'), /sessionId|accessToken|privateKey|signature/);
});

test('source/session revocation after scheduling prevents all delivery reads and key access', async t => {
  let valid = true, reads = 0;
  const c = controller(t, { authorize: async () => {
    if (!valid) throw Error('reward_account_session_required');
    return { expiresAtMs: Date.now() + 30_000, assertActive() {} };
  }, rpc: async (...args) => { reads++; return rpc(...args); } });
  await http(c.host, 'schedule', job(1)); const initial = reads; valid = false;
  assert.equal((await c.pass()).entries[0].outcome, 'authorization_required'); assert.equal(reads, initial);
});

test('closing while authority is pending blocks the eventual operation before SQL access', async t => {
  let release, entered;
  const waiting = new Promise(resolve => entered = resolve), c = controller(t, { rpc: noIO,
    authorize: async () => { entered(); await new Promise(resolve => release = resolve);
      return { expiresAtMs: Date.now() + 30_000, assertActive() {} }; } });
  const pending = http(c.host, 'status', job(1)); await waiting; c.close(); release();
  assert.equal((await pending).status, 403); assert.equal(c.state().configured, false);
  assert.throws(() => c.start(), /authority_required/); await assert.rejects(c.pass(), /authority_required/);
});

test('external stop is terminal; invalid/expired/unbounded authority never admits a worker session', async t => {
  const abort = new AbortController(), c = controller(t, { signal: abort.signal });
  c.start(1000); c.start(1000); assert.equal(c.state().workerRunning, true);
  abort.abort(); assert.equal(c.state().workerRunning, false); assert.equal(c.state().configured, false);
  await new Promise(resolve => setImmediate(resolve));
  for (const expiresAtMs of [0, Infinity, Date.now() + 3_600_000]) {
    const invalid = controller(t, { rpc: noIO, authorize: async () => ({ expiresAtMs, assertActive() {} }) });
    assert.equal((await http(invalid.host, 'status', job(1))).status, 403);
  }
});

test('local Next adapter wires isolated inspection or private IPC, never a request-driven worker or key loader', () => {
  const adapter = readFileSync(new URL('../../../demo/rewards/web/pages/api/[...path].ts', import.meta.url), 'utf8');
  const host = readFileSync(new URL('../../../demo/rewards/web/server/workflow-host.ts', import.meta.url), 'utf8');
  assert.match(adapter, /localWorkflowHostV3\(request\.url, request\.headers\.authorization\)/);
  assert.match(adapter, /handleRewardDemoApiRequest\(request, response, localPilotRunner\(\), workflow, publicRewardReport\)/);
  assert.match(host, /127\.0\.0\.1:3102/); assert.match(host, /127\.0\.0\.1:55321/);
  assert.match(host, /createReadOnlyWorkflowHostV3/);
  assert.match(host, /createWorkflowBridgeV3/);
  assert.doesNotMatch(host, /startWorkflow|loadSigner|loadTestnetOperatorAccount|execFile|spawn\(/);
});
