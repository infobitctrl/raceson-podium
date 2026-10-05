import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { encodeFunctionData, keccak256, parseTransaction, recoverTransactionAddress, serializeTransaction, TransactionNotFoundError } from "viem";
import { createSyntheticPilotV3, syntheticPilotIdV3 as id } from "@raceson/domain/rewards/synthetic-pilot-v3";
import { rewardFinaleBindingV3, readRewardSourceMappingV2, saveRewardSourceMappingV2, readRewardPublishedPreviewV2,
  rewardProgrammeApprovalV3, rewardResultReviewV3, readProgrammeAttemptV3 } from "@raceson/db/rewards";
import { encodeRewardProgrammeDeploymentV3, readVerifiedRewardProgrammeV3, rewardProgrammeV3Abi } from "@raceson/rewards-chain/programme-v3";
import { prepareProgrammeDeploymentV3 } from "../../../apps/api/dist/features/rewards/programme-deployment-v3-service.js";
import { recordSignedProgrammeDeploymentV3 } from "../../../apps/api/dist/features/rewards/programme-attempt-v3-service.js";
import { queueVerifiedProgrammeDeploymentV3, runProgrammeDeploymentJobV3 } from "../../../apps/api/dist/features/rewards/programme-worker-v3.js";
import { readRegisteredProgrammeFundingV3 } from "../../../apps/api/dist/features/rewards/programme-registry-v3-service.js";
import { root, assertLocalStack } from "./local-demo.mjs";
import { localOrganizer } from "./programme-local-rehearsal.mjs";
import { startProgrammeLocalChain } from "./programme-local-chain.mjs";
import { openCanaryJournal } from "./canary-journal.mjs";

export const compactPilotDraft = id(52);
const budget = 100n * 10n ** 18n, fee = 100000000000n;
const lower = value => value.toLowerCase();
const pairs = [{ competitionId: id(60), raceId: id(55) }, { competitionId: id(61), raceId: id(56) }];

/** Deliberate synthetic rehearsal setup, separate from the non-approving seed.
 * No real source, athlete account, consent, allocation or publication is created.
 * Changed saved rules/decisions are refused, never overwritten to make a run pass. */
export async function prepareCompactPilotFunding(session, addresses, active = () => {}) {
  active();
  const { identity, rpc } = session;
  const source = await readRewardPublishedPreviewV2(identity, 31337, compactPilotDraft, rpc);
  const fixture = createSyntheticPilotV3(source.snapshot.capturedAt);
  assert.deepEqual(source.snapshot, fixture.snapshot); assert.deepEqual(source.record.rules, fixture.rules);
  assert.equal(source.record.draftId, compactPilotDraft); assert.equal(source.record.seasonId, id(51));
  let finale = await rewardFinaleBindingV3(identity, 31337, compactPilotDraft, undefined, rpc);
  active();
  if (!finale.binding) finale = await rewardFinaleBindingV3(identity, 31337, compactPilotDraft, {
    requestId: id(800001), expectedBindingId: null, contextHash: finale.contextHash, editionId: id(54), races: pairs,
  }, rpc);
  assert.equal(finale.binding.id, id(800001)); assert.equal(finale.binding.editionId, id(54)); assert.deepEqual(finale.binding.races, pairs);
  let workspace = await readRewardSourceMappingV2(identity, 31337, compactPilotDraft, rpc);
  const mapping = structuredClone(fixture.mapping); mapping.rounds[4].roundId = finale.binding.id;
  if (workspace.mapping.rounds[4].roundId === null) {
    assert.deepEqual(workspace.mapping, fixture.mapping);
    active();
    workspace = await saveRewardSourceMappingV2(identity, 31337, workspace, workspace.revision, workspace.rulesRevision,
      workspace.catalogueHash, mapping, rpc);
  }
  assert.deepEqual(workspace.mapping, mapping); assert.equal(workspace.catalogueHash, workspace.boundCatalogueHash);
  const policies = [];
  for (const { raceId } of pairs) {
    let p = await rewardResultReviewV3(identity, raceId, undefined, rpc);
    active();
    if (p.policyId === null) p = await rewardResultReviewV3(identity, raceId, { expectedRevision: 0, reviewSeconds: 86400 }, rpc);
    assert.equal(p.reviewSeconds, 86400); assert.equal(p.held, false);
    policies.push({ raceId, id: p.policyId, revision: p.revision });
  }
  const terms = { operatorAddress: lower(addresses.operatorAddress), funderAddress: lower(addresses.funderAddress), reviewPeriods: Array(6).fill(86400) };
  let view = await rewardProgrammeApprovalV3(identity, 31337, compactPilotDraft, undefined, rpc);
  active();
  if (!view.approval) view = await rewardProgrammeApprovalV3(identity, 31337, compactPilotDraft, {
    requestId: id(800002), expectedApprovalId: null, contextHash: view.contextHash, terms,
  }, rpc);
  assert.equal(view.approval.id, id(800002)); assert.equal(view.approval.current, true); assert.deepEqual(view.approval.terms, terms);
  async function current() {
    active();
    const next = await rewardProgrammeApprovalV3(identity, 31337, compactPilotDraft, undefined, rpc);
    assert.equal(next.approval?.current, true); assert.equal(next.approval.id, view.approval.id);
    assert.equal(next.contextHash, view.contextHash); assert.deepEqual(next.approval.terms, terms);
    assert.deepEqual(next.record.rules, fixture.rules);
    for (const policy of policies) {
      const p = await rewardResultReviewV3(identity, policy.raceId, undefined, rpc);
      assert.equal(p.policyId, policy.id); assert.equal(p.revision, policy.revision);
      assert.equal(p.reviewSeconds, 86400); assert.equal(p.held, false);
    }
    active(); return next;
  }
  await current(); return { view, current };
}

function transactionCall(action, address) {
  assert.ok(action === "deposit" || /^route-[0-5]$/.test(action));
  return { to: address, value: action === "deposit" ? budget : 0n,
    data: encodeFunctionData({ abi: rewardProgrammeV3Abi, functionName: action === "deposit" ? "deposit" : "routePot",
      args: [action === "deposit" ? 0n : Number(action.slice(-1))] }) };
}

/** Exact locally signed transaction journal; no HTTP or public-chain entry.
 * Ambiguous sends stop. A rerun reuses stored bytes/hash and confirms the receipt
 * before any next nonce. Synthetic operator/funder signers are not athlete keys. */
export async function runCompactFundingStep(runtime, journal, expected, current, action, active = () => {}) {
  active();
  assert.equal(await runtime.reader.getChainId(), 31337); assert.equal(expected.context.chainId, 31337);
  const signer = action === "deposit" ? runtime.funder : runtime.operator;
  assert.equal(lower(signer.address), lower(action === "deposit" ? expected.funderAddress : expected.operatorAddress));
  const call = transactionCall(action, expected.context.verifyingContract);
  const cap = action === "deposit" ? 500000n : 10000000n;
  const file = `${action}.json`, old = journal.read(file);
  let entry = old;
  if (!entry) {
    const observed = await readVerifiedRewardProgrammeV3(runtime.reader, expected);
    assert.equal(action === "deposit" ? observed.depositedWei : observed.pots[Number(action.slice(-1))].routed, action === "deposit" ? 0n : false);
    const nonce = await runtime.reader.getTransactionCount({ address: signer.address, blockTag: "pending" });
    // Local simulation balance top-up only, never a faucet or real-wallet deposit.
    const required = call.value + cap * fee;
    await current(); active();
    if (await runtime.reader.getBalance({ address: signer.address }) < required) await runtime.test.setBalance({ address: signer.address, value: required });
    const gas = await runtime.reader.estimateGas({ ...call, account: signer.address }) * 12n / 10n;
    assert.ok(gas > 0n && gas <= cap); await current(); active();
    const raw = await signer.signTransaction({ ...call, type: "eip1559", chainId: 31337, nonce, gas, maxFeePerGas: fee, maxPriorityFeePerGas: 0n });
    entry = { version: 1, draftId: compactPilotDraft, action, programmeManifestHash: expected.programmeManifestHash,
      signedTransaction: raw, transactionHash: keccak256(raw) };
    await current(); active(); journal.write(file, entry);
  }
  assert.deepEqual(Object.keys(entry).sort(), ["version", "draftId", "action", "programmeManifestHash", "signedTransaction", "transactionHash"].sort());
  assert.equal(entry.version, 1); assert.equal(entry.draftId, compactPilotDraft); assert.equal(entry.action, action);
  assert.equal(entry.programmeManifestHash, expected.programmeManifestHash);
  assert.equal(keccak256(entry.signedTransaction), entry.transactionHash);
  const tx = parseTransaction(entry.signedTransaction);
  assert.equal(tx.type, "eip1559"); assert.equal(tx.chainId, 31337); assert.equal(tx.accessList?.length ?? 0, 0);
  assert.equal(serializeTransaction(tx), entry.signedTransaction); assert.equal(lower(tx.to), lower(call.to));
  assert.equal(tx.data, call.data); assert.equal(tx.value ?? 0n, call.value);
  assert.ok(tx.gas > 0n && tx.gas <= cap); assert.equal(tx.maxFeePerGas, fee); assert.equal(tx.maxPriorityFeePerGas ?? 0n, 0n);
  assert.equal(lower(await recoverTransactionAddress({ serializedTransaction: entry.signedTransaction })), lower(signer.address));
  let known;
  try { known = await runtime.reader.getTransaction({ hash: entry.transactionHash }); }
  catch (error) { if (!(error instanceof TransactionNotFoundError)) throw error; }
  if (!known) {
    assert.equal(await runtime.reader.getTransactionCount({ address: signer.address, blockTag: "pending" }), tx.nonce);
    assert.ok(await runtime.reader.getBalance({ address: signer.address }) >= call.value + tx.gas * fee);
    await readVerifiedRewardProgrammeV3(runtime.reader, expected); await current(); active();
    // No asynchronous work between the last authority check and byte release.
    assert.equal(await runtime.reader.sendRawTransaction({ serializedTransaction: entry.signedTransaction }), entry.transactionHash);
  } else {
    assert.equal(lower(known.from), lower(signer.address)); assert.equal(lower(known.to), lower(call.to));
    assert.equal(known.nonce, tx.nonce); assert.equal(known.input, call.data); assert.equal(known.value, call.value);
  }
  await runtime.test.mine({ blocks: 96, interval: 1 });
  const receipt = await runtime.reader.getTransactionReceipt({ hash: entry.transactionHash });
  assert.equal(receipt.status, "success"); assert.equal(receipt.transactionHash, entry.transactionHash);
  const proof = { transactionHash: receipt.transactionHash, blockNumber: receipt.blockNumber.toString(), blockHash: receipt.blockHash };
  const recorded = journal.read(`${action}-receipt.json`);
  if (recorded) assert.deepEqual(recorded, proof); else journal.write(`${action}-receipt.json`, proof);
  return proof;
}

export async function fundCompactPilot(runtime, session, journal, active = () => {}) {
  active();
  assert.equal(await runtime.reader.getChainId(), 31337);
  const { identity, rpc } = session;
  const { view, current } = await prepareCompactPilotFunding(session, { operatorAddress: runtime.operator.address, funderAddress: runtime.funder.address }, active);
  const scope = { chainId: 31337, draftId: compactPilotDraft, intentId: id(800003) };
  const prepared = await prepareProgrammeDeploymentV3(identity, { ...scope, requestId: scope.intentId,
    approvalId: view.approval.id, contextHash: view.contextHash, maximumGasCostWei: 3n * 10n ** 18n }, { reader: runtime.reader, rpc });
  assert.equal(prepared.status, "reserved");
  await current();
  if (!(await readProgrammeAttemptV3(identity, scope, rpc)).attempt) {
    const artifact = JSON.parse(readFileSync(join(root, "contracts/out/RacesOnRewardProgrammeV3.sol/RacesOnRewardProgrammeV3.json"), "utf8"));
    const data = encodeRewardProgrammeDeploymentV3(prepared.plan, artifact.bytecode.object);
    if (await runtime.reader.getBalance({ address: runtime.operator.address }) < 3n * 10n ** 18n)
      await runtime.test.setBalance({ address: runtime.operator.address, value: 3n * 10n ** 18n });
    const gas = await runtime.reader.estimateGas({ account: runtime.operator.address, data }) * 12n / 10n;
    assert.ok(gas * fee <= 3n * 10n ** 18n); await current(); active();
    const signedTransaction = await runtime.operator.signTransaction({ chainId: 31337, type: "eip1559", nonce: Number(prepared.plan.deploymentNonce),
      data, gas, maxFeePerGas: fee, maxPriorityFeePerGas: 0n, value: 0n });
    await recordSignedProgrammeDeploymentV3(identity, { ...scope, attemptId: id(800004), signedTransaction }, rpc);
  }
  const job = await queueVerifiedProgrammeDeploymentV3(identity, { ...scope, attemptId: id(800004), jobId: id(800005) }, rpc);
  const executionRpc = async (name, args) => {
    if (name === "service_step_reward_programme_job_v3" && args.p_action === "arm") await current();
    return rpc(name, args);
  };
  for (let pass = 0; pass < 4; pass++) {
    const result = await runProgrammeDeploymentJobV3(identity, { ...scope, jobId: job.jobId, workerId: id(800006) }, {
      rpc: executionRpc, reader: runtime.reader, broadcast: serializedTransaction => { active(); return runtime.reader.sendRawTransaction({ serializedTransaction }); },
    });
    if (result.outcome === "confirmed") break;
    assert.ok(["submitted", "pending", "broadcast_unknown"].includes(result.outcome));
    await runtime.test.mine({ blocks: 96, interval: 1 }); assert.ok(pass < 3, "compact_deployment_unresolved");
  }
  const expected = { ...prepared.plan, deploymentTransactionHash: job.transactionHash };
  const receipts = [];
  for (const action of ["deposit", ...Array.from({ length: 6 }, (_, slot) => `route-${slot}`)])
    receipts.push(await runCompactFundingStep(runtime, journal, expected, current, action, active));
  const funding = await readRegisteredProgrammeFundingV3(identity, (await current()).record, { reader: runtime.reader, rpc });
  assert.equal(funding.observation.depositedWei, budget.toString()); assert.equal(funding.observation.totalRoutedWei, budget.toString());
  assert.ok(funding.observation.pots.every(p => p.routed && p.paidWei === "0"));
  return { environment: "persistent-local-simulation", chainId: 31337, draftId: compactPilotDraft, address: expected.context.verifyingContract,
    deploymentTransactionHash: job.transactionHash, depositedMon: "100", routedMon: "100", paidMon: "0", receipts };
}

export function compactFundingCommand(args) {
  assert.ok(args.length === 1 && ["rehearse", "inspect"].includes(args[0]), "Use rehearse or inspect; no keys, networks, URLs or budget overrides");
  return args[0];
}
async function main() {
  const command = compactFundingCommand(process.argv.slice(2)); assertLocalStack();
  let runtime, journal, session, stopped = false, finish;
  const ended = new Promise(resolve => { finish = resolve; });
  const stop = () => { stopped = true; finish(); }, deadline = Date.now() + 10 * 60 * 1000;
  const active = () => assert.ok(!stopped && Date.now() < deadline, "compact_funding_stopped");
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  try {
    if (command === "rehearse") {
      runtime = await startProgrammeLocalChain();
      assert.equal(runtime.fresh, false, "The existing owned local chain must be restored; never replace it with a fresh chain");
      journal = openCanaryJournal(join(root, "demo/rewards/local/.artifacts/programme-chain-v3/compact-pilot-funding"));
    }
    session = await localOrganizer(compactPilotDraft);
    if (command === "inspect") {
      const response = await session.fetchFunding(); assert.equal(response.status, 200); assert.match(response.headers.get("cache-control"), /no-store/);
      const funding = (await response.json()).data;
      assert.equal(funding.draftId, compactPilotDraft); assert.equal(funding.chainId, 31337); assert.equal(funding.status, "verified");
      assert.equal(funding.observation.pots.length, 6); assert.equal(funding.observation.depositedWei, budget.toString());
      assert.equal(funding.observation.totalRoutedWei, budget.toString()); assert.ok(funding.observation.pots.every(p => p.routed && p.paidWei === "0"));
      console.log(JSON.stringify({ draftId: compactPilotDraft, address: funding.observation.address, depositedMon: "100", routedMon: "100", paidMon: "0" }));
    } else {
      console.log(JSON.stringify(await fundCompactPilot(runtime, session, journal, active)));
      journal.close(); journal = undefined; await session.signOut(); session = undefined;
      console.log(`Local-only read gateway ready at ${runtime.readUrl}. No public-chain funding, activation or payouts.`);
      await ended;
    }
  } finally {
    try { journal?.close(); await session?.signOut(); }
    finally { process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop); await runtime?.stop(); }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => {
  console.error("Compact pilot funding stopped. Inspect saved approvals and original transaction receipts before retrying. Private details suppressed.");
  process.exitCode = 1;
});
