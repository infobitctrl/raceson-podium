import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, lstatSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { createPublicClient, http, keccak256 } from "viem";
import { monadTestnet } from "viem/chains";
import { createPrivyTestnetPilotV3, privyPilotIdV3 as id } from "@raceson/domain/rewards/privy-testnet-pilot-v3";
import { rewardFinaleBindingV3, readRewardSourceMappingV2, saveRewardSourceMappingV2, readRewardPublishedPreviewV2,
  rewardProgrammeApprovalV3, rewardResultReviewV3, readProgrammeAttemptV3 } from "@raceson/db/rewards";
import { encodeRewardProgrammeDeploymentV3, rewardProgrammeV3Build } from "@raceson/rewards-chain/programme-v3";
import { prepareProgrammeDeploymentV3 } from "../../../apps/api/dist/features/rewards/programme-deployment-v3-service.js";
import { recordSignedProgrammeDeploymentV3 } from "../../../apps/api/dist/features/rewards/programme-attempt-v3-service.js";
import { queueVerifiedProgrammeDeploymentV3, runProgrammeDeploymentJobV3 } from "../../../apps/api/dist/features/rewards/programme-worker-v3.js";
import { root, assertLocalStack } from "./local-demo.mjs";
import { localOrganizer } from "./programme-local-rehearsal.mjs";
import { loadTestnetOperatorAccount } from "./testnet-wallets.mjs";
import { openCanaryJournal } from "./canary-journal.mjs";
import { fundPrivyProgrammeStep } from "./privy-testnet-funding.mjs";
import { pacePrivyTestnetReads, requirePrivyProgrammeSource } from "./privy-testnet-rpc.mjs";

export const privyTestnetProgramme = Object.freeze({ chainId: 10143, draftId: id(52),
  operatorAddress: "0x4c5616771ffce5fc41bcb4a30dd2b55aac8ebe31",
  funderAddress: "0xa768ad0500ee7536c2583c1953377eff561ec98b", budgetMon: "100",
  maximumDeploymentGasWei: 3n * 10n ** 18n,
  // Upfront zero-hour policy for this NEW synthetic test, not a changed clock.
  reviewSeconds: 0,
});

/** Digest actual source AND loaded-build files. Do not relax the independent
 * remote release executors. This local-only entry still refuses source drift,
 * foreign Docker/DB targets, environment URLs, other drafts or wallet overrides. */
export function privyProgrammeSourceDigest() {
  const files = ["package.json", "package-lock.json", "contracts/foundry.toml"];
  const walk = directory => {
    for (const entry of readdirSync(join(root, directory), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name);
      assert.ok(!entry.isSymbolicLink(), "Source symlinks are forbidden");
      if (entry.isDirectory()) walk(path);
      else if (/\.(ts|js|mjs|json|sql|sol)$/.test(path)) files.push(path);
    }
  };
  for (const directory of ["apps/api/src", "apps/api/dist", "packages/domain/src", "packages/domain/dist", "packages/db/src", "packages/db/dist",
    "packages/rewards-chain/src", "packages/rewards-chain/dist", "demo/rewards/scripts", "demo/rewards/supabase/migrations", "contracts/src"]) walk(directory);
  const digest = createHash("sha256");
  for (const file of files.sort()) { assert.ok(lstatSync(join(root, file)).isFile()); digest.update(relative(root, join(root, file))); digest.update("\0"); digest.update(readFileSync(join(root, file))); digest.update("\0"); }
  return digest.digest("hex");
}

export function parsePrivyProgrammeCommand(args) {
  assert.ok(Array.isArray(args));
  if (args.length === 1 && args[0] === "prepare") return { command: "prepare" };
  assert.ok(args.length === 3 && ["deploy", "fund", "gas"].includes(args[0]) && args[1] === "--confirm-source" && /^[0-9a-f]{64}$/.test(args[2]),
    "Use prepare, or deploy/fund/gas --confirm-source <reviewed SHA-256>; no network/key/budget overrides");
  return { command: args[0], sourceDigest: args[2] };
}

export async function preparePrivyProgramme(session, reader, active = () => {}) {
  active(); assert.equal(await reader.getChainId(), 10143);
  const { identity, rpc } = session, scope = privyTestnetProgramme;
  const source = await readRewardPublishedPreviewV2(identity, 10143, scope.draftId, rpc);
  const fixture = createPrivyTestnetPilotV3(source.snapshot.capturedAt);
  assert.deepEqual(source.snapshot, fixture.snapshot); assert.deepEqual(source.record.rules, fixture.rules);
  assert.equal(source.record.chainId, 10143); assert.equal(source.record.draftId, scope.draftId);
  const pairs = [{ competitionId: id(60), raceId: id(55) }, { competitionId: id(61), raceId: id(56) }];
  let finale = await rewardFinaleBindingV3(identity, 10143, scope.draftId, undefined, rpc);
  active();
  if (!finale.binding) finale = await rewardFinaleBindingV3(identity, 10143, scope.draftId,
    { requestId: id(800001), expectedBindingId: null, contextHash: finale.contextHash, editionId: id(54), races: pairs }, rpc);
  assert.equal(finale.binding.id, id(800001)); assert.deepEqual(finale.binding.races, pairs);
  const mapping = structuredClone(fixture.mapping); mapping.rounds[4].roundId = finale.binding.id;
  let workspace = await readRewardSourceMappingV2(identity, 10143, scope.draftId, rpc);
  if (workspace.mapping.rounds[4].roundId === null) {
    assert.deepEqual(workspace.mapping, fixture.mapping); active();
    workspace = await saveRewardSourceMappingV2(identity, 10143, workspace, workspace.revision, workspace.rulesRevision, workspace.catalogueHash, mapping, rpc);
  }
  assert.deepEqual(workspace.mapping, mapping); assert.equal(workspace.catalogueHash, workspace.boundCatalogueHash);
  const policies = [];
  for (const { raceId } of pairs) {
    let policy = await rewardResultReviewV3(identity, raceId, undefined, rpc); active();
    if (policy.policyId === null) policy = await rewardResultReviewV3(identity, raceId, { expectedRevision: 0, reviewSeconds: scope.reviewSeconds }, rpc);
    assert.equal(policy.reviewSeconds, scope.reviewSeconds); assert.equal(policy.held, false);
    policies.push({ raceId, id: policy.policyId, revision: policy.revision });
  }
  const terms = { operatorAddress: scope.operatorAddress, funderAddress: scope.funderAddress, reviewPeriods: Array(6).fill(scope.reviewSeconds) };
  let view = await rewardProgrammeApprovalV3(identity, 10143, scope.draftId, undefined, rpc); active();
  if (!view.approval) view = await rewardProgrammeApprovalV3(identity, 10143, scope.draftId,
    { requestId: id(800002), expectedApprovalId: null, contextHash: view.contextHash, terms }, rpc);
  assert.equal(view.approval?.id, id(800002)); assert.equal(view.approval.current, true); assert.deepEqual(view.approval.terms, terms);
  async function current() {
    active(); assert.equal(await reader.getChainId(), 10143);
    const next = await rewardProgrammeApprovalV3(identity, 10143, scope.draftId, undefined, rpc);
    assert.equal(next.approval?.id, view.approval.id); assert.equal(next.approval.current, true); assert.equal(next.contextHash, view.contextHash);
    assert.deepEqual(next.record.rules, fixture.rules); assert.deepEqual(next.approval.terms, terms);
    for (const previous of policies) {
      const actual = await rewardResultReviewV3(identity, previous.raceId, undefined, rpc);
      assert.equal(actual.policyId, previous.id); assert.equal(actual.revision, previous.revision);
      assert.equal(actual.reviewSeconds, scope.reviewSeconds); assert.equal(actual.held, false);
    }
    active(); return next;
  }
  await current();
  const prepared = await prepareProgrammeDeploymentV3(identity, { chainId: 10143, draftId: scope.draftId, requestId: id(800003),
    approvalId: view.approval.id, contextHash: view.contextHash, maximumGasCostWei: scope.maximumDeploymentGasWei }, { reader, rpc });
  assert.equal(prepared.status, "reserved"); await current();
  return { prepared, current };
}

export async function main(args = process.argv.slice(2)) {
  const command = parsePrivyProgrammeCommand(args);
  assertLocalStack(); const sourceDigest = privyProgrammeSourceDigest();
  if (command.command !== "prepare") assert.equal(command.sourceDigest, sourceDigest, "Reviewed source changed; prepare/review again");
  const end = Date.now() + 10 * 60 * 1000;
  const active = () => { assert.ok(Date.now() < end, "Bounded execution expired"); assertLocalStack(); assert.equal(privyProgrammeSourceDigest(), sourceDigest, "Source drift"); };
  const reader = pacePrivyTestnetReads(createPublicClient({ chain: monadTestnet, cacheTime: 0,
    transport: http("https://testnet-rpc.monad.xyz", { timeout: 10000, retryCount: 0 }) }));
  let session, journal;
  try {
    session = await localOrganizer(privyTestnetProgramme.draftId);
    const { prepared, current } = await preparePrivyProgramme(session, reader, active);
    const artifact = JSON.parse(readFileSync(join(root, "contracts/out/RacesOnRewardProgrammeV3.sol/RacesOnRewardProgrammeV3.json"), "utf8"));
    assert.equal(keccak256(artifact.bytecode.object), rewardProgrammeV3Build.creationCodeHash);
    const data = encodeRewardProgrammeDeploymentV3(prepared.plan, artifact.bytecode.object);
    const base = { chainId: 10143, draftId: privyTestnetProgramme.draftId, intentId: id(800003) };
    const observed = await readProgrammeAttemptV3(session.identity, base, session.rpc);
    const summary = { draftId: base.draftId, chainId: 10143, sourceDigest, budgetMon: "100", reviewSeconds: 0,
      predictedAddress: prepared.plan.context.verifyingContract, existingAttempt: observed.attempt !== null, maximumDeploymentGasMon: "3" };
    if (command.command === "prepare") return { ...summary, status: "prepared_not_deployed" };
    journal = openCanaryJournal(join(root, "demo/rewards/local/.artifacts/privy-testnet-programme-v3"));
    requirePrivyProgrammeSource(journal, sourceDigest, base.draftId);
    if (command.command === "gas") {
      const result = await fundPrivyProgrammeStep({ reader, expected: prepared.plan, journal, current, active,
        loadSigner: role => loadTestnetOperatorAccount(role) }, "operator-gas");
      return { ...summary, ...result, operatorGasTopupMon: "2", paidMon: "0" };
    }
    if (command.command === "fund") {
      assert.ok(observed.attempt, "Deploy and reconcile the programme first");
      const expected = { ...prepared.plan, deploymentTransactionHash: observed.attempt.body.transactionHash };
      for (const action of ["deposit", "route-0", "route-1", "route-2", "route-3", "route-4", "route-5"]) {
        const result = await fundPrivyProgrammeStep({ reader, expected, journal, current, active,
          loadSigner: role => loadTestnetOperatorAccount(role) }, action);
        if (result.status !== "confirmed") return { ...summary, ...result, paidMon: "0" };
      }
      return { ...summary, status: "funded_and_routed", depositedMon: "100", routedMon: "100", paidMon: "0" };
    }
    if (!observed.attempt) {
      await current();
      const nonce = await reader.getTransactionCount({ address: privyTestnetProgramme.operatorAddress, blockTag: "pending" });
      assert.equal(BigInt(nonce), prepared.plan.deploymentNonce);
      const gas = (await reader.estimateGas({ account: privyTestnetProgramme.operatorAddress, data })) * 12n / 10n;
      const fees = await reader.estimateFeesPerGas();
      assert.ok(gas > 0n && gas * fees.maxFeePerGas <= privyTestnetProgramme.maximumDeploymentGasWei);
      assert.ok(await reader.getBalance({ address: privyTestnetProgramme.operatorAddress }) >= gas * fees.maxFeePerGas, "Operator needs an explicitly bounded test-MON top-up");
      await current(); const signer = loadTestnetOperatorAccount("operator");
      assert.equal(signer.address.toLowerCase(), privyTestnetProgramme.operatorAddress); await current();
      const signedTransaction = await signer.signTransaction({ chainId: 10143, type: "eip1559", nonce, data, value: 0n, gas, ...fees });
      await current();
      await recordSignedProgrammeDeploymentV3(session.identity, { ...base, attemptId: id(800004), signedTransaction }, session.rpc);
    }
    const job = await queueVerifiedProgrammeDeploymentV3(session.identity, { ...base, attemptId: id(800004), jobId: id(800005) }, session.rpc);
    await current();
    const result = await runProgrammeDeploymentJobV3(session.identity, { ...base, jobId: job.jobId, workerId: id(800006) }, {
      // No disk/Docker work after the worker's final send-lease fence. Source
      // was checked before entering this already-loaded execution boundary.
      reader, rpc: session.rpc, broadcast: signedTransaction => {
        assert.ok(Date.now() < end, "Bounded execution expired");
        return reader.sendRawTransaction({ serializedTransaction: signedTransaction });
      },
    });
    return { ...summary, transactionHash: job.transactionHash, outcome: result.outcome,
      status: result.outcome === "confirmed" ? "deployed_unfunded" : "original_attempt_pending_reconcile_only", paidMon: "0" };
  } finally { journal?.close(); await session?.signOut(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(await main())); }
  catch { console.error("Privy programme stopped. Inspect the original plan/attempt; no automatic retry, replacement or private diagnostics."); process.exitCode = 1; }
}
