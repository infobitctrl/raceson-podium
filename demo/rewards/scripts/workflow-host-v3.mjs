import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createAdminSupabaseClient, createServerAuthSupabaseClient, loadServerEnv, verifiedRequestIdentityFromClaims } from "@raceson/db";
import { createWorkflowHostControllerV3, startWorkflowIpcV3 } from "../../../apps/api/dist/rewards-demo.js";
import { createWorkflowPolicyAuthorityV3, createWorkflowSessionVaultV3, parseWorkflowHostPolicyV3 } from "../../../apps/api/dist/features/rewards/workflow-v3-authority.js";
import { root, workdir, assertLocalStack, localCredentials, localAppEnvironment } from "./local-demo.mjs";
import { privyProgrammeSourceDigest } from "./privy-testnet-programme.mjs";
import { privyTrialReader } from "./privy-testnet-round-one.mjs";
import { loadTestnetOperatorAccount } from "./testnet-wallets.mjs";

export const workflowLocalTarget = Object.freeze({ mode: "local-testnet", chainId: 10143,
  origin: "http://127.0.0.1:3102", supabaseUrl: "http://127.0.0.1:55321" });
export const workflowLocalDirectory = join(workdir, ".artifacts/workflow-v3-10143");
const operatorUserId = "d6907f24-a783-47b9-be66-285ca877422f";
const draftId = "9a000000-0000-4000-8000-000000000052";
const wallets = Object.freeze({ operator: "0x4c5616771ffce5fc41bcb4a30dd2b55aac8ebe31", relayer: "0x6c215b3052588f4b3bcb957bf4a1b0aaf38771ec" });
const readMethods = new Set(["service_read_reward_programme_lifecycle_v3", "service_read_reward_programme_lifecycle_job_v3",
  "service_read_reward_athlete_payment_v3", "service_read_reward_club_payment_v3", "service_read_reward_claim_v3", "service_read_reward_club_claim_v3"]);
const writeMethods = new Set(["service_record_reward_programme_lifecycle_attempt_v3", "service_step_reward_programme_lifecycle_job_v3",
  "service_change_reward_athlete_payment_v3", "service_change_reward_club_payment_v3",
  "service_record_reward_claim_proof_v3", "service_record_reward_club_claim_proof_v3"]);

export function workflowHostSourceDigestV3() {
  const digest = createHash("sha256").update(privyProgrammeSourceDigest());
  // The broader digest already binds source + compiled API/domain/SQL/chain
  // artifacts and scripts. Also bind the actual Next transport and native
  // custody helper; hashing the helper does NOT read any Keychain item.
  for (const name of ["demo/rewards/web/server/workflow-host.ts", "demo/rewards/web/pages/api/[...path].ts",
    "demo/rewards/scripts/testnet-keychain.swift", "demo/rewards/local/.artifacts/operator-keychain"]) {
    const path = join(root, name);
    assert.equal(realpathSync(path), path); assert.ok(lstatSync(path).isFile());
    digest.update(name).update("\0").update(readFileSync(path)).update("\0");
  }
  return digest.digest("hex");
}

export function readWorkflowHostPolicyV3(path) {
  assert.equal(resolve(path), path); assert.ok(path.startsWith(workflowLocalDirectory + "/"));
  assert.equal(realpathSync(path), path);
  const stat = lstatSync(path);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 65536 && (stat.mode & 0o077) === 0);
  assert.equal(stat.uid, process.getuid());
  const bytes = readFileSync(path), policy = parseWorkflowHostPolicyV3(JSON.parse(bytes.toString("utf8")));
  assert.equal(policy.operatorUserId, operatorUserId); assert.equal(policy.draftId, draftId);
  return { policy, digest: createHash("sha256").update(bytes).digest("hex") };
}

/** Explicit private process only: no login, refresh, token persistence, web
 * autostart, generic RPC, queue preparation, new wallets or recipient keys. */
export async function serveWorkflowHostV3({ policyPath, sourceDigest, policyDigest, signal }) {
  assert.match(sourceDigest, /^[0-9a-f]{64}$/); assert.match(policyDigest, /^[0-9a-f]{64}$/);
  const selected = readWorkflowHostPolicyV3(policyPath), { policy } = selected;
  const deadline = Date.now() + policy.durationSeconds * 1000;
  const assertSource = () => {
    assert.ok(!signal.aborted && Date.now() < deadline, "reward_workflow_authority_required");
    assert.equal(workflowHostSourceDigestV3(), sourceDigest, "reward_workflow_authority_required");
    assert.equal(readWorkflowHostPolicyV3(policyPath).digest, policyDigest, "reward_workflow_authority_required");
  };
  assertSource(); assertLocalStack(); // before accessing isolated credentials
  const env = loadServerEnv(localAppEnvironment(localCredentials(), "local-testnet"));
  assert.equal(env.supabaseUrl, workflowLocalTarget.supabaseUrl); assert.equal(env.appBaseUrl, workflowLocalTarget.origin);
  const auth = createServerAuthSupabaseClient(env), admin = createAdminSupabaseClient(env), reader = privyTrialReader();
  const vault = createWorkflowSessionVaultV3(async token => {
    assertSource();
    const { data, error } = await auth.auth.getClaims(token);
    const identity = data && verifiedRequestIdentityFromClaims(data.claims, env);
    assert.ok(!error && identity && data.claims.is_anonymous === false, "reward_account_session_required");
    assert.equal(identity.userId, operatorUserId, "reward_workflow_authority_required");
    assertSource(); return { identity, expiresAtMs: data.claims.exp * 1000 };
  }, signal);
  const rpc = async (method, args) => {
    assertSource();
    assert.ok(readMethods.has(method) || (policy.permits.length > 0 && writeMethods.has(method)), "reward_workflow_authority_required");
    assert.equal(args.p_chain_id, 10143); assert.equal(args.p_actor_user_id, operatorUserId);
    if (args.p_draft_id !== undefined) assert.equal(args.p_draft_id, draftId);
    if (args.p_role !== undefined) assert.equal(args.p_role, "operator");
    if (args.p_action !== undefined) assert.ok(["attempt", "lease", "arm", "submitted", "confirm"].includes(args.p_action));
    const grant = await vault.verify({ userId: args.p_actor_user_id, sessionId: args.p_actor_session_id });
    assertSource(); grant.assertActive();
    // Each allowlisted SQL function checks CURRENT auth.sessions and sporting/
    // organizer scope. Verified JWT lifetime alone is not authorization.
    return admin.rpc(method, args);
  };
  const authorize = createWorkflowPolicyAuthorityV3({ target: workflowLocalTarget, reader, rpc, policy, assertSource, sessions: vault });
  const signer = async role => {
    assertSource(); assertLocalStack(); assert.ok(Object.hasOwn(wallets, role));
    assert.ok(policy.permits.some(p => p.signPlanHash || (role === "operator" && p.approvalPlanHash)), "reward_workflow_authority_required");
    const account = loadTestnetOperatorAccount(role);
    assert.equal(account.address.toLowerCase(), wallets[role]); assertSource(); return account;
  };
  const controller = createWorkflowHostControllerV3({ target: workflowLocalTarget, reader, rpc, authorize,
    directory: workflowLocalDirectory, durationMs: policy.durationSeconds * 1000, signal,
    loadSigner: signer, loadApprovalSigner: () => signer("operator"),
    broadcast: bytes => { assertSource(); assertLocalStack(); return reader.sendRawTransaction({ serializedTransaction: bytes }); } });
  let ipc;
  try {
    assertSource();
    ipc = await startWorkflowIpcV3({ socketPath: join(workflowLocalDirectory, "host.sock"), host: controller.host, signal,
      authenticate: async (actor, token) => { assertSource(); assert.equal(actor.userId, operatorUserId, "reward_workflow_authority_required");
        await vault.admit(actor, token); assertSource(); } });
    controller.start();
    return { close: () => { controller.close(); vault.clear(); ipc.stop(); }, closed: ipc.closed,
      observation: { schema: "raceson-workflow-private-host-v1", chainId: 10143, origin: workflowLocalTarget.origin,
        draftId, sourceDigest, policyDigest, permittedActions: policy.permits.length,
        maxGasCostWei: policy.maxGasCostWei, maxRewardWei: policy.maxRewardWei, expiresAt: new Date(deadline).toISOString() } };
  } catch (e) { controller.close(); vault.clear(); ipc?.stop(); throw e; }
}

async function main() {
  const [action, ...args] = process.argv.slice(2);
  if (action === "digest") { assert.equal(args.length, 0); console.log(workflowHostSourceDigestV3()); return; }
  assert.equal(action, "serve"); assert.equal(args.length, 6);
  assert.equal(args[0], "--policy"); assert.equal(args[2], "--confirm-source"); assert.equal(args[4], "--confirm-policy");
  const stop = new AbortController();
  const abort = () => stop.abort(); process.once("SIGINT", abort); process.once("SIGTERM", abort);
  let running, timer;
  try {
    const { policy } = readWorkflowHostPolicyV3(args[1]);
    timer = setTimeout(abort, policy.durationSeconds * 1000);
    running = await serveWorkflowHostV3({ policyPath: args[1], sourceDigest: args[3], policyDigest: args[5], signal: stop.signal });
    console.log(JSON.stringify(running.observation)); await running.closed;
  } finally { abort(); running?.close(); clearTimeout(timer); process.off("SIGINT", abort); process.off("SIGTERM", abort); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(() => {
  console.error("Private rewards worker stopped or failed validation. No credential, signing material or provider error was logged."); process.exitCode = 1;
});
