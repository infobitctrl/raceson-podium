import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { recoverMessageAddress } from "viem";
import { createClient } from "@supabase/supabase-js";
import { rewardProgrammeApprovalV3, rewardResultReviewV3, readProgrammeAttemptV3, readProgrammeRegistryV3 } from "@raceson/db/rewards";
import { encodeRewardProgrammeDeploymentV3, readVerifiedRewardProgrammeV3, rewardProgrammeV3Abi } from "@raceson/rewards-chain/programme-v3";
import { prepareProgrammeDeploymentV3, programmeDeploymentPlanV3 } from "../../../apps/api/dist/features/rewards/programme-deployment-v3-service.js";
import { prepareProgrammeDepositQuoteV3 } from "../../../apps/api/dist/features/rewards/programme-deposit-v3-service.js";
import { recordSignedProgrammeDeploymentV3 } from "../../../apps/api/dist/features/rewards/programme-attempt-v3-service.js";
import { queueVerifiedProgrammeDeploymentV3, runProgrammeDeploymentJobV3 } from "../../../apps/api/dist/features/rewards/programme-worker-v3.js";
import { readRegisteredProgrammeFundingV3 } from "../../../apps/api/dist/features/rewards/programme-registry-v3-service.js";
import { localCredentials, root, database, cleanEnvironment, assertLocalStack } from "./local-demo.mjs";
import { seedSyntheticFundingDemo } from "./seed-funding-approval-demo.mjs";
import { startProgrammeLocalChain } from "./programme-local-chain.mjs";

const id = n => `88000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const programmeLocalDraft = id(5);
const budget = 100000n * 10n ** 18n;
let phase = "startup";

/** The local fixture is deliberately incapable of targeting real league data.
 * It never edits existing approval-demo 870... or historical imported scopes. */
export function assertSyntheticProgrammeContext(view) {
  assert.equal(view.record.chainId, 31337); assert.equal(view.record.draftId, programmeLocalDraft);
  assert.equal(view.record.seasonId, id(4)); assert.equal(view.record.organizationId, "82000000-0000-4000-8000-000000000002");
  assert.equal(view.record.rules.budgetMon, "100000");
  assert.equal(view.workspace.catalogue.rounds.length, 5);
  for (const [index, round] of view.workspace.catalogue.rounds.entries()) {
    assert.equal(round.slot, index + 1); assert.equal(round.id, id(1011 + index * 10));
    assert.equal(round.status, "draft"); assert.equal(round.races.length, 2);
    for (const race of round.races) { assert.ok(race.id.startsWith("88000000-")); assert.equal(race.publicationId, null); assert.equal(race.resultCount, 0); }
  }
  assert.equal(view.workspace.catalogue.categories.length, 8);
  for (const category of view.workspace.catalogue.categories) assert.ok(category.id.startsWith("88000000-") && category.eligibility.demoOnly === true);
}

export async function localOrganizer(draftId = programmeLocalDraft) {
  assert.match(draftId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assertLocalStack();
  const c = localCredentials(), options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
  const admin = createClient(database, c.SERVICE_ROLE_KEY, options), auth = createClient(database, c.ANON_KEY, options);
  const { data: account, error } = await admin.from("account_login_identifiers").select("user_id").eq("username", "demo.organizer").single();
  assert.ok(account && !error, "local_demo_organizer_required");
  const user = await admin.auth.admin.getUserById(account.user_id); assert.ok(user.data.user?.email && !user.error);
  let password;
  try { password = execFileSync("security", ["find-generic-password", "-s", "RacesOn Rewards Local Demo", "-a", "demo.organizer", "-w"],
    { env: cleanEnvironment(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30000 }).trim(); }
  catch { throw Error("local_demo_login_required"); }
  const signed = await auth.auth.signInWithPassword({ email: user.data.user.email, password }); password = undefined;
  assert.ok(!signed.error && signed.data.session && signed.data.user?.id === account.user_id, "local_demo_login_failed");
  const sessionId = JSON.parse(Buffer.from(signed.data.session.access_token.split(".")[1], "base64url").toString()).session_id;
  assert.match(sessionId, /^[0-9a-f-]{36}$/);
  return { identity: { userId: account.user_id, sessionId }, rpc: (name, args) => admin.rpc(name, args), signOut: () => auth.auth.signOut({ scope: "local" }),
    // Use the real SDK login without exposing its bearer or resetting the test
    // account. The fixed local workflow endpoint still owns all authorization.
    fetchWorkflow: (operation, body) => {
      assert.ok(["status", "inspect", "inspect-approval", "schedule", "approve", "sign"].includes(operation));
      return fetch(`http://127.0.0.1:3102/api/v1/organizer/rewards/workflow-v3/${operation}`, {
        method: "POST", headers: { authorization: `Bearer ${signed.data.session.access_token}`, "content-type": "application/json", origin: "http://127.0.0.1:3102" },
        body: JSON.stringify(body), redirect: "error", signal: AbortSignal.timeout(365000) });
    },
    fetchFunding: () => fetch(`http://127.0.0.1:3101/api/v1/organizer/rewards/drafts/${draftId}/funding`, {
      headers: { authorization: `Bearer ${signed.data.session.access_token}` }, redirect: "error", signal: AbortSignal.timeout(30000) }),
    reviewDeposit: () => fetch(`http://127.0.0.1:3101/api/v1/organizer/rewards/drafts/${draftId}/deposit-review`, {
      method: "POST", headers: { authorization: `Bearer ${signed.data.session.access_token}`, "content-type": "application/json", origin: "http://127.0.0.1:3101" },
      body: JSON.stringify({ amountMon: "1" }), redirect: "error", signal: AbortSignal.timeout(30000) }) };
}

export async function rehearseLocalProgramme(runtime, session) {
  const { identity, rpc } = session;
  phase = "synthetic_scope";
  assertLocalStack(); assert.equal(await runtime.reader.getChainId(), 31337);
  seedSyntheticFundingDemo(true);
  let view = await rewardProgrammeApprovalV3(identity, 31337, programmeLocalDraft, undefined, rpc);
  assertSyntheticProgrammeContext(view);
  // Announce the synthetic races' unchanged 24-hour policy before funding.
  const policies = [];
  phase = "review_policies";
  for (const round of view.workspace.catalogue.rounds) for (const race of round.races) {
    let p = await rewardResultReviewV3(identity, race.id, undefined, rpc);
    if (p.policyId === null) p = await rewardResultReviewV3(identity, race.id, { expectedRevision: 0, reviewSeconds: 86400 }, rpc);
    assert.equal(p.reviewSeconds, 86400); assert.equal(p.held, false); assert.equal(p.locked, false);
    policies.push({ categoryId: race.id, policyId: p.policyId, revision: p.revision });
  }
  phase = "funding_approval";
  if (!view.approval) view = await rewardProgrammeApprovalV3(identity, 31337, programmeLocalDraft,
    { requestId: id(2000), expectedApprovalId: null, contextHash: view.contextHash, terms: {
      operatorAddress: runtime.operator.address, funderAddress: runtime.funder.address, reviewPeriods: Array(6).fill(86400) } }, rpc);
  const approval = view.approval; assert.ok(approval?.current);
  assert.equal(approval.terms.operatorAddress, runtime.operator.address.toLowerCase());
  assert.equal(approval.terms.funderAddress, runtime.funder.address.toLowerCase());
  assert.deepEqual(approval.terms.reviewPeriods, Array(6).fill(86400));
  // In-memory synthetic custody proof, scoped to this approval/network/budget.
  // This is not persisted real-user wallet authority or an athlete signature.
  const message = `RacesOn LOCAL ONLY funding rehearsal:31337:${programmeLocalDraft}:${approval.id}:${view.contextHash}:100000MON`;
  for (const signer of [runtime.operator, runtime.funder]) assert.equal((await recoverMessageAddress({ message, signature: await signer.signMessage({ message }) })).toLowerCase(), signer.address.toLowerCase());
  async function freshAuthority() {
    assertLocalStack(); assert.equal(await runtime.reader.getChainId(), 31337);
    const next = await rewardProgrammeApprovalV3(identity, 31337, programmeLocalDraft, undefined, rpc);
    assertSyntheticProgrammeContext(next); assert.ok(next.approval?.current);
    assert.equal(next.approval.id, approval.id); assert.equal(next.contextHash, view.contextHash);
    for (const expected of policies) {
      const actual = await rewardResultReviewV3(identity, expected.categoryId, undefined, rpc);
      assert.equal(actual.policyId, expected.policyId); assert.equal(actual.revision, expected.revision);
      assert.equal(actual.reviewSeconds, 86400); assert.equal(actual.held, false); assert.equal(actual.locked, false);
    }
    return next;
  }
  if (runtime.fresh) {
    await runtime.test.setBalance({ address: runtime.operator.address, value: 500n * 10n ** 18n });
    await runtime.test.setBalance({ address: runtime.funder.address, value: budget + 3n * 10n ** 18n });
  }
  await freshAuthority();
  phase = "deployment_attempt";
  const scope = { chainId: 31337, draftId: programmeLocalDraft, intentId: id(2001) };
  const prepared = await prepareProgrammeDeploymentV3(identity, { ...scope, requestId: scope.intentId,
    approvalId: approval.id, contextHash: view.contextHash, maximumGasCostWei: 3n * 10n ** 18n }, { reader: runtime.reader, rpc });
  assert.equal(prepared.status, "reserved");
  const previous = await readProgrammeAttemptV3(identity, scope, rpc);
  if (!previous.attempt) {
    const artifact = JSON.parse(readFileSync(join(root, "contracts/out/RacesOnRewardProgrammeV3.sol/RacesOnRewardProgrammeV3.json"), "utf8"));
    const data = encodeRewardProgrammeDeploymentV3(prepared.plan, artifact.bytecode.object);
    const gas = (await runtime.reader.estimateGas({ account: runtime.operator.address, data })) * 12n / 10n;
    await freshAuthority();
    const signedTransaction = await runtime.operator.signTransaction({ chainId: 31337, type: "eip1559", nonce: Number(prepared.plan.deploymentNonce),
      data, gas, maxFeePerGas: 100000000000n, maxPriorityFeePerGas: 0n, value: 0n });
    await recordSignedProgrammeDeploymentV3(identity, { ...scope, attemptId: id(2002), signedTransaction }, rpc);
  }
  const job = await queueVerifiedProgrammeDeploymentV3(identity, { ...scope, attemptId: id(2002), jobId: id(2003) }, rpc);
  phase = "deployment_worker";
  const executionRpc = async (name, args) => {
    // Policy I/O precedes the worker's locked arm and synchronous final fence.
    // Never insert an await between that fence and actual byte release.
    if (name === "service_step_reward_programme_job_v3" && args.p_action === "arm") await freshAuthority();
    return rpc(name, args);
  };
  for (let step = 0; step < 4; step++) {
    const result = await runProgrammeDeploymentJobV3(identity, { ...scope, jobId: job.jobId, workerId: id(2004) },
      { rpc: executionRpc, reader: runtime.reader, broadcast: serializedTransaction => runtime.reader.sendRawTransaction({ serializedTransaction }) });
    if (result.outcome === "confirmed") break;
    assert.ok(["submitted", "pending", "broadcast_unknown"].includes(result.outcome), `local_programme_${result.outcome}`);
    await runtime.test.mine({ blocks: 96, interval: 1 });
    assert.ok(step < 3, "local_programme_confirmation_required");
  }
  const expected = { ...prepared.plan, deploymentTransactionHash: job.transactionHash };
  // A preceding local run may have lost a deposit/routing response before its
  // finality mine. Settle that existing history BEFORE deciding to send again.
  await runtime.test.mine({ blocks: 96, interval: 1 });
  let observed = await readVerifiedRewardProgrammeV3(runtime.reader, expected);
  phase = "programme_deposit";
  if (observed.depositedWei === 0n) {
    await freshAuthority();
    const hash = await runtime.funderWallet.writeContract({ address: prepared.plan.context.verifyingContract, abi: rewardProgrammeV3Abi,
      functionName: "deposit", args: [0n], value: budget });
    assert.equal((await runtime.reader.waitForTransactionReceipt({ hash })).status, "success");
    await runtime.test.mine({ blocks: 96, interval: 1 });
  } else assert.equal(observed.depositedWei, budget, "local_partial_funding_requires_review");
  for (let slot = 0; slot < 6; slot++) {
    phase = `route_pot_${slot}`;
    observed = await readVerifiedRewardProgrammeV3(runtime.reader, expected);
    if (observed.pots[slot].routed) continue;
    await freshAuthority();
    const hash = await runtime.operatorWallet.writeContract({ address: prepared.plan.context.verifyingContract, abi: rewardProgrammeV3Abi,
      functionName: "routePot", args: [slot] });
    assert.equal((await runtime.reader.waitForTransactionReceipt({ hash })).status, "success");
    await runtime.test.mine({ blocks: 96, interval: 1 });
  }
  const latest = await freshAuthority();
  phase = "funding_readback";
  const funding = await readRegisteredProgrammeFundingV3(identity, latest.record, { reader: runtime.reader, rpc });
  assert.equal(funding.observation?.depositedWei, budget.toString());
  assert.equal(funding.observation?.totalRoutedWei, budget.toString());
  console.log(JSON.stringify({ environment: "persistent-local-simulation", chainId: 31337, draftId: programmeLocalDraft,
    contract: prepared.plan.context.verifyingContract, deploymentTransactionHash: job.transactionHash, depositedMon: "100000", paidMon: "0",
    url: `http://127.0.0.1:3101/rewards/manage?draft=${programmeLocalDraft}` }));
}

export function localProgrammeCommand(args) {
  if (args.length === 1 && ["rehearse", "serve", "inspect"].includes(args[0])) return { mode: args[0], draftId: null };
  assert.ok(args.length === 3 && args[0] === "serve-wallet" && args[1] === "--draft"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(args[2])
    && args[2] !== "00000000-0000-0000-0000-000000000000", "Use serve-wallet --draft UUID; no network/key/URL arguments accepted");
  return { mode: "serve-wallet", draftId: args[2] };
}
async function main() {
  const command = localProgrammeCommand(process.argv.slice(2));
  assertLocalStack();
  if (command.mode === "inspect") {
    phase = "funding_http_inspection";
    const session = await localOrganizer();
    try {
      const response = await session.fetchFunding();
      assert.equal(response.status, 200, "local_funding_http_unavailable"); assert.match(response.headers.get("cache-control") ?? "", /no-store/);
      const body = await response.json(), funding = body.data;
      assert.equal(funding.draftId, programmeLocalDraft); assert.equal(funding.status, "verified");
      assert.equal(funding.observation.depositedWei, budget.toString()); assert.equal(funding.observation.totalRoutedWei, budget.toString());
      assert.equal(funding.observation.pots.length, 6); assert.ok(funding.observation.pots.every(p => p.paidWei === "0" && p.routed));
      // Authenticated read-only review must refuse another deposit into this
      // already funded synthetic programme. No wallet or execution endpoint.
      phase = "deposit_review_http_inspection";
      const reviewResponse = await session.reviewDeposit();
      assert.equal(reviewResponse.status, 200, "local_deposit_review_http_unavailable");
      assert.match(reviewResponse.headers.get("cache-control") ?? "", /no-store/);
      const review = (await reviewResponse.json()).data;
      assert.deepEqual(review, { status: "blocked", reason: "fully_funded" });
      console.log(JSON.stringify({ environment: "persistent-local-simulation", httpStatus: 200, draftId: programmeLocalDraft,
        address: funding.observation.address, deploymentTransactionHash: funding.observation.deploymentTransactionHash,
        depositedMon: "100000", routedMon: "100000", paidMon: "0", block: funding.observation.blockNumber, depositReview: review.reason }));
    } finally { await session.signOut(); }
    return;
  }
  const runtime = await startProgrammeLocalChain();
  let session, walletTimer;
  let finish;
  const ended = new Promise(resolve => { finish = resolve; });
  const stop = () => finish();
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  try {
    if (command.mode === "rehearse") {
      phase = "local_organizer_login";
      session = await localOrganizer();
      await rehearseLocalProgramme(runtime, session); await session.signOut(); session = undefined;
    } else assert.equal(runtime.fresh, false, "Run the explicit synthetic rehearsal first");
    if (command.mode === "serve-wallet") {
      phase = "local_wallet_rpc_setup";
      session = await localOrganizer();
      const walletSession = session, expiresAt = Date.now() + 15 * 60 * 1000;
      const scope = { chainId: 31337, draftId: command.draftId }, alive = () => Date.now() < expiresAt;
      const access = async () => {
        assert.ok(alive()); assertLocalStack();
        const r = await readProgrammeRegistryV3(walletSession.identity, scope, walletSession.rpc);
        assert.ok(r.registry && r.context.intent, "local_registered_programme_required");
        const plan = programmeDeploymentPlanV3(r.context);
        return { chainId: 31337, draftId: command.draftId, address: plan.context.verifyingContract.toLowerCase(),
          funderAddress: plan.funderAddress.toLowerCase(), budgetWei: plan.budgetWei.toString() };
      };
      const r = await readProgrammeRegistryV3(walletSession.identity, scope, walletSession.rpc);
      assert.ok(r.registry); await readRegisteredProgrammeFundingV3(walletSession.identity, r.context.approvalView.record, { reader: runtime.reader, rpc: walletSession.rpc });
      const connection = await runtime.openWalletRpc({ binding: await access(), access, alive,
        review: amountMon => prepareProgrammeDepositQuoteV3(walletSession.identity, scope, amountMon, { reader: runtime.reader, rpc: walletSession.rpc }) });
      console.log(JSON.stringify({ environment: "local-simulation-only", walletRpc: connection.url, chainId: 31337, currency: "MON",
        draftId: command.draftId, funderAddress: connection.binding.funderAddress, contract: connection.binding.address,
        expiresAt: new Date(expiresAt).toISOString(), blockIntervalSeconds: connection.blockIntervalSeconds, keysStored: false, automaticFunding: false }));
      walletTimer = setTimeout(() => {
        connection.stop(); console.log("Local wallet connection expired. Read-only programme runtime remains available; no automatic renewal.");
        void walletSession.signOut().catch(() => {});
      }, Math.max(0, expiresAt - Date.now()));
    }
    console.log(`Local-only read gateway ready at ${runtime.readUrl}. Chain state is preserved on clean shutdown. No public-chain writes.`);
    await ended;
  } finally {
    clearTimeout(walletTimer);
    try { await session?.signOut(); }
    finally { await runtime.stop(); process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop); }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => {
  const code = typeof error?.code === "string" && /^reward_[a-z_]+$/.test(error.code) ? error.code : "details_redacted";
  console.error(`Local programme rehearsal stopped at ${phase} (${code}). Existing state is preserved; no credentials, keys or signed bytes logged.`); process.exitCode = 1;
});
