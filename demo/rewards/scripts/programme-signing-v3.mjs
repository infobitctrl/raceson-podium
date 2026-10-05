#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertOperatorSource, parseOperatorArguments, readOperatorCredentials } from './operator.mjs';
import { REWARD_OPERATOR_RPC_URL, rewardOperatorChainFetch } from './operator-transport.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const fail = () => { throw Error('reward_programme_signing_config_invalid'); };
const exact = (v, keys) => v && typeof v === 'object' && !Array.isArray(v) && Reflect.ownKeys(v).length === keys.length
  && keys.every(k => { const d = Object.getOwnPropertyDescriptor(v, k); return d?.enumerable && Object.hasOwn(d, 'value'); });
const uuid = v => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
const hex = (v, n) => typeof v === 'string' && new RegExp(`^0x[0-9a-f]{${n}}$`).test(v) && BigInt(v) !== 0n;
const ids = ['draftId', 'approvalId', 'uploadId', 'intentId', 'attemptId', 'operatorUserId'];
const addresses = ['programmeAddress', 'campaignAddress', 'operatorAddress'];
const scopeKeys = ['draftId', 'slot', 'approvalId', 'uploadId', 'intentId', 'attemptId'];
export function normalizeProgrammeSigningConfigV3(v, validateRelease) {
  if (!exact(v, ['formatVersion', 'release', ...ids, ...addresses, 'slot', 'action', 'packageHash', 'maxGasCostWei', 'durationSeconds'])
    || v.formatVersion !== 3 || !ids.every(k => uuid(v[k])) || !addresses.every(k => hex(v[k], 40))
    || new Set(addresses.map(k => v[k])).size !== 3 || !Number.isInteger(v.slot) || v.slot < 1 || v.slot > 6
    || !['complete_funding', 'upload_awards', 'stage_allocation', 'activate'].includes(v.action)
    || typeof v.packageHash !== 'string' || !/^[0-9a-f]{64}$/.test(v.packageHash)
    || typeof v.maxGasCostWei !== 'string' || !/^[1-9][0-9]{0,77}$/.test(v.maxGasCostWei) || BigInt(v.maxGasCostWei) >= 1n << 256n
    || !Number.isInteger(v.durationSeconds) || v.durationSeconds < 1 || v.durationSeconds > 1800) return fail();
  return { formatVersion: 3, release: validateRelease(v.release), ...Object.fromEntries([...ids, ...addresses].map(k => [k, v[k]])),
    slot: v.slot, action: v.action, packageHash: v.packageHash, maxGasCostWei: v.maxGasCostWei, durationSeconds: v.durationSeconds };
}
export function approvedProgrammeSigningPlanV3(config, sourcePlanDigest, signing) {
  const p = signing.plan;
  if (!/^[0-9a-f]{64}$/.test(sourcePlanDigest) || p.schema !== 'raceson-programme-signing-plan-v3' || p.chainId !== 10143
    || ![...scopeKeys, ...addresses, 'action', 'packageHash'].every(k => p[k] === config[k]) || p.valueWei !== '0'
    || !hex(p.planHash, 64) || BigInt(p.fees.maxGasCostWei) > BigInt(config.maxGasCostWei)) return fail();
  const plan = { schemaVersion: 3, kind: 'raceson-programme-signing-approval-v3', sourcePlanDigest, config, signingPlan: p };
  return { ...plan, planDigest: createHash('sha256').update(JSON.stringify(plan)).digest('hex') };
}
export function programmeSigningChainFetchV3(signal, fetchImpl) {
  const transport = rewardOperatorChainFetch(signal, fetchImpl);
  return (input, init) => {
    try { if (typeof init?.body !== 'string' || Buffer.byteLength(init.body) > 1024 * 1024
      || JSON.parse(init.body)?.method === 'eth_sendRawTransaction') throw Error(); }
    catch { return Promise.reject(Error('reward_programme_signing_read_only')); }
    return transport(input, init);
  };
}
const help = `Isolated Monad testnet V3 programme signing; no broadcast.
  plan --config <non-secret.json>
  run --config <non-secret.json> --confirm-plan <sha256>
Both commands authenticate and inspect one already prepared race/league action.
Plan never accesses a key. Run uses the existing dedicated operator Keychain
account only after exact plan approval and fresh source/session/chain checks.
Stores one immutable signed attempt privately; does not queue, send, publish,
fund, pay recipients, create wallets or access athlete keys.
Credentials arrive only through a finite stdin pipe: accessToken, publishableKey, serverKey.
No .env, CLI-login, production target, source-check or release-gate bypass.
`;
export async function main(args = process.argv.slice(2), log = console.log) {
  const parsed = parseOperatorArguments(args); if (parsed.command === 'help') { log(help); return; }
  let raw;
  try { const s = lstatSync(parsed.configPath); if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1 || s.size > 128 * 1024) return fail();
    raw = JSON.parse(readFileSync(parsed.configPath, 'utf8')); } catch { return fail(); }
  assertOperatorSource(raw?.release?.sourceCommit);
  try { execFileSync(process.execPath, [resolve(root, 'node_modules/typescript/bin/tsc'), '-b', 'packages/domain', 'packages/db', 'apps/api', '--force'],
    { cwd: root, env: { PATH: process.env.PATH }, timeout: 60000, maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch { throw Error('reward_programme_signing_build_required'); }
  assertOperatorSource(raw.release.sourceCommit);
  const { validateDemoReleaseManifest } = await import('./release-manifest.mjs');
  const { readDemoReleaseSource } = await import('./release-source.mjs');
  const config = normalizeProgrammeSigningConfigV3(raw, validateDemoReleaseManifest), source = readDemoReleaseSource(config.release);
  const { createProgrammeSigningClientV3 } = await import('../../../packages/db/dist/rewards/index.js');
  const { inspectProgrammeSigningV3, signProgrammeV3 } = await import('../../../apps/api/dist/features/rewards/programme-signing-v3.js');
  const { createPublicClient, defineChain, http } = await import('viem');
  const controller = new AbortController(), stop = () => controller.abort();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  let deadline = Date.now() + config.durationSeconds * 1000, timer = setTimeout(stop, config.durationSeconds * 1000);
  const check = () => { if (controller.signal.aborted || Date.now() >= deadline) { stop(); throw Error('reward_programme_signing_stopped'); } };
  try {
    const credentials = await readOperatorCredentials(process.stdin, controller.signal); check(); assertOperatorSource(config.release.sourceCommit); check();
    const target = { mode: 'testnet', chainId: 10143, origin: config.release.origin, supabaseUrl: `https://${config.release.supabase.projectRef}.supabase.co` };
    const client = createProgrammeSigningClientV3({ target, ...credentials, signal: controller.signal });
    const auth = await client.authenticate(credentials.accessToken, config.operatorUserId); check();
    deadline = Math.min(deadline, auth.expiresAtMs - 5000); check(); clearTimeout(timer); timer = setTimeout(stop, deadline - Date.now());
    const scope = { chainId: 10143, ...Object.fromEntries(scopeKeys.map(k => [k, config[k]])) };
    const rpc = async (name, a) => {
      check();
      if (a.p_actor_user_id !== auth.identity.userId || a.p_actor_session_id !== auth.identity.sessionId || a.p_chain_id !== 10143
        || a.p_draft_id !== scope.draftId || a.p_slot !== scope.slot || a.p_approval_id !== scope.approvalId || a.p_upload_id !== scope.uploadId
        || a.p_intent_id !== scope.intentId || name === 'service_record_reward_programme_lifecycle_attempt_v3' && a.p_attempt_id !== scope.attemptId) return fail();
      const r = await client.rpc(name, a); check(); return r;
    };
    const chain = defineChain({ id: 10143, name: 'Monad testnet', nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
      rpcUrls: { default: { http: [REWARD_OPERATOR_RPC_URL] } } });
    const reader = createPublicClient({ chain, transport: http(REWARD_OPERATOR_RPC_URL, { timeout: 10000, retryCount: 0,
      fetchFn: programmeSigningChainFetchV3(controller.signal) }), cacheTime: 0 });
    const deps = { reader, rpc }, signing = await inspectProgrammeSigningV3(auth.identity, scope, deps); check();
    const plan = approvedProgrammeSigningPlanV3(config, source.planDigest, signing);
    if (parsed.command === 'plan') { log(JSON.stringify({ ...plan, alreadyRecorded: signing.recorded, transactionHash: signing.transactionHash }, null, 2)); return plan; }
    if (parsed.confirmation !== plan.planDigest) throw Error('reward_programme_signing_confirmation_required');
    assertOperatorSource(config.release.sourceCommit); check();
    const record = await signProgrammeV3(auth.identity, { ...scope, planHash: signing.plan.planHash }, { ...deps, signal: controller.signal,
      loadSigner: async () => {
        check(); assertOperatorSource(config.release.sourceCommit); check();
        const { publicTestnetWallet, loadTestnetOperatorAccount } = await import('./testnet-wallets.mjs');
        if (publicTestnetWallet('operator')?.toLowerCase() !== config.operatorAddress) throw Error('reward_programme_signer_mismatch');
        check(); assertOperatorSource(config.release.sourceCommit); check();
        const account = loadTestnetOperatorAccount('operator'); check();
        return { address: account.address, signTransaction: tx => { assertOperatorSource(config.release.sourceCommit); check(); return account.signTransaction(tx); } };
      } });
    check(); const output = { ...record, planDigest: plan.planDigest, sourceCommit: config.release.sourceCommit }; log(JSON.stringify(output, null, 2)); return output;
  } finally { clearTimeout(timer); controller.abort(); process.off('SIGINT', stop); process.off('SIGTERM', stop); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await main(); } catch { console.error('reward_programme_signing_command_failed'); process.exitCode = 1; }
}
