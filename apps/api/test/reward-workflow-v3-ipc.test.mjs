import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, chmodSync, rmSync, lstatSync, existsSync, readdirSync, readFileSync, realpathSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createWorkflowBridgeV3, startWorkflowIpcV3, assertWorkflowSocketV3, workflowIpcDeadlineMsV3 } from '../dist/features/rewards/workflow-v3-ipc.js';
import { executeWorkflowRequestV3 } from '../dist/features/rewards/workflow-v3-request.js';

const id = n => `98000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const hash = n => `0x${n.toString(16).padStart(64, '0')}`;
const actor = { userId: id(1), sessionId: id(2) };
const target = { kind: 'programme', draftId: id(3), slot: 1, approvalId: id(4), uploadId: id(5), intentId: id(6), attemptId: id(7) };
const demo = { mode: 'local-testnet', chainId: 10143, origin: 'http://127.0.0.1:3102', supabaseUrl: 'http://127.0.0.1:55321' };
const request = { target, jobId: id(8), transactionHash: hash(1) };
test('paced testnet IPC keeps an explicit bounded transport deadline', () => {
  assert.equal(workflowIpcDeadlineMsV3,360_000);
  assert.ok(workflowIpcDeadlineMsV3 < 1_800_000);
});
function directory(t) {
  // Short real path also works with macOS's small Unix-socket path limit.
  const path = mkdtempSync(join(realpathSync(tmpdir()).length < 55 ? realpathSync(tmpdir()) : '/private/tmp', 'rwh-'));
  chmodSync(path, 0o700); t.after(() => rmSync(path, { recursive: true, force: true })); return path;
}

test('real private Unix IPC transports authenticated exact status, never persists the bearer, and closes cleanly', async t => {
  const dir = directory(t), socketPath = join(dir, 'h.sock'), stop = new AbortController();
  const seen = [];
  // Deliberately synthetic runtime, not a testnet payment or live Auth fixture.
  const host = { runtime: { ...demo, job: async (a, input, operation) => {
    seen.push(operation); assert.deepEqual(a, actor); assert.deepEqual(input, request);
    return { confirmed: true, reconciliationRequired: false, transactionHash: request.transactionHash };
  } }, store: { get: () => null } };
  const ipc = await startWorkflowIpcV3({ socketPath, host, signal: stop.signal, authenticate: async (a, token) => {
    seen.push('authenticate'); assert.deepEqual(a, actor); if (token !== 'synthetic-bearer') throw Error('reward_account_session_required');
  } }); t.after(() => { stop.abort(); ipc.stop(); });
  const bridge = createWorkflowBridgeV3({ target: demo, socketPath, accessToken: 'synthetic-bearer' });
  const response = await executeWorkflowRequestV3(bridge, actor, 'status', request);
  assert.equal(response.confirmed, true); assert.equal(response.scheduled, false);
  assert.deepEqual(seen, ['authenticate', 'status']); assert.equal(lstatSync(socketPath).mode & 0o077, 0);
  assert.deepEqual(readdirSync(dir), ['h.sock']);
  const denied = createWorkflowBridgeV3({ target: demo, socketPath, accessToken: 'wrong-token' });
  await assert.rejects(executeWorkflowRequestV3(denied, actor, 'status', request), /session_required/);
  assert.deepEqual(seen, ['authenticate', 'status', 'authenticate']);
  stop.abort(); await ipc.closed; assert.equal(existsSync(socketPath), false);
  await assert.rejects(executeWorkflowRequestV3(bridge, actor, 'status', request));
});

test('both dispatch sides reject request extensions before execution and sanitize unknown host errors', async t => {
  const dir = directory(t), socketPath = join(dir, 'h.sock'), stop = new AbortController(); let calls = 0;
  const ipc = await startWorkflowIpcV3({ socketPath, signal: stop.signal, authenticate: async () => { calls++; },
    host: { runtime: { inspect: async () => { throw Error('private-provider-detail-DO-NOT-LEAK'); } } } });
  t.after(async () => { stop.abort(); await ipc.closed; });
  const bridge = createWorkflowBridgeV3({ target: demo, socketPath, accessToken: 'fixture-token' });
  await assert.rejects(executeWorkflowRequestV3(bridge, actor, 'status', { ...request, shell: 'ignored' })); assert.equal(calls, 0);
  await assert.rejects(executeWorkflowRequestV3(bridge, actor, 'inspect', { target }), /^Error: reward_workflow_unavailable$/);
  assert.equal(calls, 1);
  await assert.rejects(bridge.dispatch(actor, 'inspect', { target, command: 'ignored' }), /invalid_reward_workflow_request/);
});

test('socket policy rejects shared directory, symlink, remote target and existing endpoint without removing it', async t => {
  const dir = directory(t), socketPath = join(dir, 'h.sock');
  chmodSync(dir, 0o755); assert.throws(() => assertWorkflowSocketV3(socketPath, false), /not_configured/); chmodSync(dir, 0o700);
  const link = join(dir, 'alias'); symlinkSync(dir, link);
  assert.throws(() => assertWorkflowSocketV3(join(link, 'h.sock'), false), /not_configured/);
  const stop = new AbortController(), ipc = await startWorkflowIpcV3({ socketPath, signal: stop.signal, host: {}, authenticate: async () => {} });
  t.after(async () => { stop.abort(); await ipc.closed; });
  await assert.rejects(startWorkflowIpcV3({ socketPath, signal: stop.signal, host: {}, authenticate: async () => {} }), /not_configured/);
  assert.ok(lstatSync(socketPath).isSocket());
  assert.throws(() => createWorkflowBridgeV3({ target: { ...demo, origin: 'https://www.raceson.com' }, socketPath, accessToken: 'token' }), /not_configured/);
  assert.throws(() => assertWorkflowSocketV3('relative.sock', false), /not_configured/);
});

test('bootstrap has explicit source/policy pins, fixed isolated credentials and lazy existing operator custody', () => {
  const source = readFileSync(new URL('../../../demo/rewards/scripts/workflow-host-v3.mjs', import.meta.url), 'utf8');
  for (const expected of ['--confirm-source', '--confirm-policy', 'auth.auth.getClaims(token)', 'vault.verify(', 'assertLocalStack()',
    'loadTestnetOperatorAccount(role)', 'policy.permits.length > 0', '127.0.0.1:55321', '127.0.0.1:3102']) assert.ok(source.includes(expected));
  assert.doesNotMatch(source, /generatePrivateKey|signInWithPassword|JWT_SECRET|setSession|service_prepare_|service_queue_/);
});
