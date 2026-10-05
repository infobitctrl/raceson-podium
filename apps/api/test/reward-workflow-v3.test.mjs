import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createWorkflowRuntimeV3, workflowTargetV3, traceWorkflowV3 } from '../dist/features/rewards/workflow-v3-service.js';
import { WorkflowScheduleStoreV3, runWorkflowSchedulerPassV3, startWorkflowSchedulerV3 } from '../dist/features/rewards/workflow-v3-scheduler.js';
import { dispatchWorkflowV3 } from '../dist/routes/rewards/workflow-v3.js';
const id = n => `a1100000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const hash = n => '0x' + n.repeat(64);
const actor = { userId: id(1), sessionId: id(2) };
const target = slot => ({ kind: 'programme', draftId: id(3), slot, approvalId: id(10 + slot), uploadId: id(20 + slot), intentId: id(30 + slot), attemptId: id(40 + slot) });
const job = slot => ({ target: target(slot), jobId: id(50 + slot), transactionHash: hash(String(slot)) });
const noIO = () => assert.fail('No unapproved IO');
const demo = { mode: 'local', chainId: 31337, origin: 'http://127.0.0.1:3101', supabaseUrl: 'http://127.0.0.1:54321' };
function fixture(t) { const dir = mkdtempSync(join(tmpdir(), 'rewards-workflow-test-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { dir, store: new WorkflowScheduleStoreV3(dir) }; }

test('six-pot and recipient targets are strict; browser cannot choose chain, actor, amount, key, command or URL', () => {
  for (let slot = 1; slot <= 6; slot++) assert.deepEqual(workflowTargetV3.parse(target(slot)), target(slot));
  for (const patch of [{ slot: 0 }, { slot: 7 }, { slot: 1.5 }, { chainId: 143 }, { actor }, { amountWei: '1' }, { privateKey: 'secret' },
    { command: 'send' }, { url: 'https://www.raceson.com' }, { attemptId: '../path' }]) assert.throws(() => workflowTargetV3.parse({ ...target(1), ...patch }));
  const athlete = { kind: 'athlete', uploadId: id(2), destinationId: id(3), entitlementId: hash('a'), claimId: id(4), paymentId: id(5), attemptId: id(6) };
  assert.deepEqual(workflowTargetV3.parse(athlete), athlete);
  assert.throws(() => workflowTargetV3.parse({ ...athlete, kind: 'club' }));
});

test('durable exact schedules recover lost responses; changed scope and other owners conflict', async t => {
  const { dir, store } = fixture(t);
  for (let slot = 1; slot <= 6; slot++) {
    const [a, b] = await Promise.all([Promise.resolve().then(() => store.enqueue(actor.userId, 31337, job(slot))),
      Promise.resolve().then(() => new WorkflowScheduleStoreV3(dir).enqueue(actor.userId, 31337, job(slot)))]);
    assert.deepEqual(a, b);
    assert.throws(() => store.enqueue(id(99), 31337, job(slot)), /reward_workflow_job_conflict/);
    assert.throws(() => store.enqueue(actor.userId, 31337, { ...job(slot), target: { ...target(slot), uploadId: id(99) } }), /conflict/);
  }
  assert.equal(new WorkflowScheduleStoreV3(dir).list().length, 6);
  for (const name of readdirSync(dir)) assert.doesNotMatch(readFileSync(join(dir, name), 'utf8'), /sessionId|accessToken|signature|privateKey|signedTransaction/);
});

test('send fence is exclusive across processes and survives a crash before a lost response is recorded', t => {
  const { dir, store } = fixture(t), record = store.enqueue(actor.userId, 31337, job(1));
  store.markSend(record);
  const module = new URL('../dist/features/rewards/workflow-v3-scheduler.js', import.meta.url).href;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `import {WorkflowScheduleStoreV3} from ${JSON.stringify(module)};
    const s=new WorkflowScheduleStoreV3(${JSON.stringify(dir)});try{s.markSend(s.list()[0]);process.exitCode=2;}catch{process.exitCode=0;}`], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  assert.throws(() => new WorkflowScheduleStoreV3(dir).markSend(record), /reconciliation_required/);
});

test('six-pot scheduler retries reconcile first, recover restart, and never double-send uncertain broadcasts', async t => {
  const { dir, store } = fixture(t), sent = new Set(), observed = new Set(); let sends = 0, reads = 0;
  for (let slot = 1; slot <= 6; slot++) store.enqueue(actor.userId, 31337, job(slot));
  // Explicit worker/chain fixture. The real SQL/chain worker suite separately
  // verifies leases, receipt provenance and payment duplicate protection.
  const runtime = { chainId: 31337, deliver: async (a, r, mark) => {
    assert.deepEqual(a, actor); reads++;
    if (observed.has(r.jobId)) return { jobId: r.jobId, outcome: 'confirmed' };
    try { mark(); sends++; sent.add(r.jobId); throw Error('lost transport response'); }
    catch { return { jobId: r.jobId, outcome: 'broadcast_unknown' }; }
  } };
  await Promise.all([runWorkflowSchedulerPassV3(store, runtime, async () => actor),
    runWorkflowSchedulerPassV3(new WorkflowScheduleStoreV3(dir), runtime, async () => actor)]);
  assert.equal(sends, 6); assert.equal(sent.size, 6);
  await runWorkflowSchedulerPassV3(new WorkflowScheduleStoreV3(dir), runtime, async () => actor, { now: Date.now() + 1000000 });
  assert.equal(sends, 6);
  for (const key of sent) observed.add(key);
  const final = await runWorkflowSchedulerPassV3(store, runtime, async () => actor, { now: Date.now() + 2000000 });
  assert.equal(final.entries.length, 6); assert.ok(final.entries.every(e => e.outcome === 'confirmed'));
  const old = reads; await runWorkflowSchedulerPassV3(store, runtime, async () => actor, { now: Date.now() + 3000000 });
  assert.equal(reads, old); assert.equal(sends, 6);
});

test('expired/revoked scheduling sessions and unavailable identity never imply successful payment', async t => {
  const { store } = fixture(t); store.enqueue(actor.userId, 31337, job(1));
  const runtime = { chainId: 31337, deliver: noIO };
  for (const resolver of [async () => { throw Error('reward_account_session_required'); }, async () => ({ ...actor, userId: id(99) })]) {
    const result = await runWorkflowSchedulerPassV3(store, runtime, resolver, { now: Date.now() + 1000000 });
    assert.equal(result.entries[0].outcome, 'authorization_required');
  }
  const result = await runWorkflowSchedulerPassV3(store, runtime, async () => { throw Error('provider token secret'); }, { now: Date.now() + 2000000 });
  assert.equal(result.entries[0].outcome, 'unavailable'); assert.doesNotMatch(JSON.stringify(result), /token secret/);
});

test('corrupt schedule progress fails closed instead of resetting the send history', async t => {
  const { store, dir } = fixture(t); store.enqueue(actor.userId, 31337, job(1));
  writeFileSync(join(dir, `${job(1).jobId}.progress.json`), '{', { mode: 0o600 });
  await assert.rejects(runWorkflowSchedulerPassV3(store, { chainId: 31337, deliver: noIO }, async () => actor));
});

test('runtime rejects production targets and expired source authority before ledger/key/provider access', async () => {
  const options = { target: demo, rpc: noIO, reader: {}, loadSigner: noIO, loadApprovalSigner: noIO, broadcast: noIO,
    authorize: async () => ({ expiresAtMs: Date.now() - 1, assertActive: noIO }) };
  const runtime = createWorkflowRuntimeV3(options);
  for (const op of ['inspect', 'sign', 'inspectApproval', 'approve']) await assert.rejects(runtime[op](actor,
    op === 'sign' || op === 'approve' ? { target: target(1), planHash: hash('a') } : { target: target(1) }), /reward_account_session_required/);
  assert.throws(() => createWorkflowRuntimeV3({ ...options, target: { mode: 'testnet', origin: 'https://www.raceson.com', supabaseUrl: 'https://icdtinbmtvzhswrrzjxq.supabase.co' } }));
});

async function http(path, body, options = {}) {
  const res = { headers: {} }; let bodies = 0;
  const handled = await dispatchWorkflowV3({ method: options.method ?? 'POST' }, res, new URL(path, demo.origin), {
    config: () => options.disabled ? null : { chainId: 31337, origin: demo.origin },
    requireIdentity: async () => { if (options.authError) throw Error(options.authError); return actor; },
    readJsonBody: async () => { bodies++; return body; }, rpc: options.rpc ?? noIO,
    applyPrivateSessionHeaders: r => r.headers['Cache-Control'] = 'private, no-store',
    sendSuccess: (r, data) => Object.assign(r, { status: 200, data }), sendError: (r, status, code) => Object.assign(r, { status, code }),
  }, options.host); return { ...res, handled, bodies };
}
test('workflow HTTP is private/demo-only and validates bodies before an injected operator capability', async t => {
  const base = '/api/v1/organizer/rewards/workflow-v3/', { store } = fixture(t);
  const host = { store, runtime: { chainId: 31337, origin: demo.origin, inspect: noIO, sign: noIO, job: async () => ({ state: 'queued', confirmed: false }) } };
  for (const [authError, status] of [['Unauthorized', 401], ['Untrusted browser origin', 403]]) assert.equal((await http(base + 'sign', {}, { host, authError })).status, status);
  assert.equal((await http(base + 'inspect', {}, {})).code, 'reward_workflow_not_configured');
  assert.equal((await http(base + 'inspect', {}, { disabled: true })).handled, false);
  for (const body of [{ target: { ...target(1), privateKey: 'secret' } }, { target: target(1), planHash: hash('a'), signature: '0x' }])
    assert.equal((await http(base + 'sign', body, { host })).status, 400);
  const pair = await Promise.all([http(base + 'schedule', job(1), { host }), http(base + 'schedule', job(1), { host })]);
  assert.ok(pair.every(r => r.status === 200 && r.data.scheduled && !r.data.confirmed));
  assert.match(pair[0].headers['Cache-Control'], /no-store/);
  assert.equal((await http(base + 'inspect?chainId=143', {}, { host })).status, 400);
  assert.equal((await http(base.replace('organizer', 'athlete') + 'sign', {}, { host })).handled, false);
  host.runtime.job = async () => { throw Error('signedTransaction private provider details'); };
  const unavailable = await http(base + 'status', job(1), { host }); assert.equal(unavailable.status, 503);
  assert.doesNotMatch(JSON.stringify(unavailable), /private provider details/);
});

test('trace captures only operation/duration/outcome and does not mask a successful action', async () => {
  const seen = []; assert.equal(await traceWorkflowV3(e => seen.push(e), 'inspect', async () => 'private-result'), 'private-result');
  assert.deepEqual(Object.keys(seen[0]), ['operation', 'durationMs', 'outcome']); assert.equal(seen[0].outcome, 'ok');
  assert.equal(await traceWorkflowV3(() => { throw Error('sink unavailable'); }, 'sign', async () => 7), 7);
  await assert.rejects(traceWorkflowV3(e => seen.push(e), 'inspect', async () => { throw Error('not logged'); }));
  assert.equal(seen[1].outcome, 'error'); assert.doesNotMatch(JSON.stringify(seen), /private-result|not logged/);
});

test('ordinary API excludes new workflow routes even with reward flags; demo requires Auth before IO', () => {
  const code = `import {Readable} from 'node:stream';
    globalThis.fetch=()=>{throw Error('no provider access');};
    const {handleApiRequest}=await import(${JSON.stringify(new URL('../dist/server.js', import.meta.url).href)});
    const {handleRewardDemoApiRequest}=await import(${JSON.stringify(new URL('../dist/rewards-demo.js', import.meta.url).href)});
    const results=[];
    for(const handle of [handleApiRequest,handleRewardDemoApiRequest]){
      const req=Object.assign(Readable.from([]),{method:'POST',url:'/api/v1/organizer/rewards/workflow-v3/sign',headers:{host:'reward-demo.invalid'},socket:{remoteAddress:'127.0.0.1'}});
      const res={statusCode:200,setHeader(){},end(body){this.body=JSON.parse(String(body));}};
      await handle(req,res);results.push({status:res.statusCode,body:res.body});
    }process.stdout.write(JSON.stringify(results));`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', timeout: 10000, env: {
    PATH: process.env.PATH, NODE_ENV: 'production', APP_BASE_URL: 'https://reward-demo.invalid', SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
    SUPABASE_ANON_KEY: 'synthetic-anon-key', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-key',
    RACESON_REWARD_PORTAL_MODE: 'testnet', RACESON_REWARD_DEMO_ORIGIN: 'https://reward-demo.invalid',
    RACESON_REWARD_DEMO_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co', NEXT_PUBLIC_RACESON_REWARDS_ENABLED: 'true',
  } });
  assert.equal(result.status, 0, result.stderr); const [ordinary, demo] = JSON.parse(result.stdout);
  assert.equal(ordinary.status, 404); assert.equal(demo.status, 401);
});


test('stopping the host scheduler fences an in-flight send handoff', async t => {
  const { store } = fixture(t); store.enqueue(actor.userId, 31337, job(1));
  let entered, release, finished, sends = 0;
  const started = new Promise(r => entered = r), ended = new Promise(r => finished = r);
  const stop = startWorkflowSchedulerV3(store, { chainId: 31337, deliver: async (_, r, mark) => {
    entered(); await new Promise(resolve => release = resolve);
    try { mark(); sends++; } finally { finished(); }
    return { jobId: r.jobId, outcome: 'submitted' };
  } }, async () => actor, { signal: new AbortController().signal });
  await started; stop(); release(); await ended;
  assert.equal(sends, 0);
  // Let the pass complete its bounded bookkeeping before fixture cleanup.
  await new Promise(resolve => setImmediate(resolve));
});
