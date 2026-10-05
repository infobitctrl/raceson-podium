// Bounded canary, not a programme publisher or a generic wallet transfer API.
// The CLI supplies the fixed public plan. Tests inject only an owned local chain.
import assert from "node:assert/strict";
import { encodeFunctionData, getAddress, getContractAddress, keccak256, parseEther, parseTransaction, recoverTransactionAddress, stringToHex, zeroAddress } from "viem";
import { rewardAllocationCommitment } from "@raceson/rewards-chain";
import { rewardCampaignV2Abi as abi, requireRewardReviewClockV2 } from "@raceson/rewards-chain/campaign-v2";
import { encodeRewardDeploymentV2, requireRewardCreationBytecodeV2, verifyRewardRuntimeV2 } from "@raceson/rewards-chain/deployment-v2";
import { readVerifiedRewardDeploymentV2 } from "@raceson/rewards-chain/deployment-reader-v2";
import { contractCanaryPlan as plan, prepareContractCanaryDeployment } from "./contract-canary-plan.mjs";
import { canaryJson, openCanaryJournal } from "./canary-journal.mjs";
import { canarySourcePackageHash, canarySourceVerifier } from "./contract-canary-source.mjs";

const hash = value => keccak256(stringToHex(value));
const same = (a, b) => typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();
const budget = parseEther(plan.budgetMON), maxFeePerGas = BigInt(plan.feeCeilingPerGasWei);
const roleFeeCaps = { funder: parseEther(plan.funderTopUpFeeCeilingMON), operator: parseEther(plan.operatorTotalFeeCeilingMON) };
const orderedSteps = ["operator-topup", "relayer-topup", "deploy", "fund", "upload", "stage", "activate"];
const zeroHash = `0x${"0".repeat(64)}`;

export function publicCanaryExecution(artifact) {
  const deployment = prepareContractCanaryDeployment(artifact);
  return { spec: deployment.spec, creationCode: artifact.bytecode.object,
    roles: { funder: plan.funder, operator: plan.operator, relayer: plan.relayer }, funderNonce: 1 };
}
function normalizeExecution(input) {
  const e = structuredClone(input);
  assert.deepEqual(Object.keys(e).sort(), ["creationCode", "funderNonce", "roles", "spec"]);
  assert.deepEqual(Object.keys(e.roles).sort(), ["funder", "operator", "relayer"]);
  for (const key of Object.keys(e.roles)) e.roles[key] = getAddress(e.roles[key]);
  assert.equal(new Set(Object.values(e.roles)).size, 3); assert.equal(e.funderNonce, 1);
  const code = requireRewardCreationBytecodeV2(e.creationCode);
  const data = encodeRewardDeploymentV2(e.spec, code);
  assert.equal(e.spec.context.verifyingContract, getContractAddress({ from: e.roles.operator, nonce: 0n }));
  assert.equal(e.spec.operatorAddress, e.roles.operator); assert.equal(e.spec.treasuryAddress, e.roles.funder);
  assert.equal(e.spec.enabledPot, 0);
  assert.equal(e.spec.programmeManifestHash, hash(JSON.stringify(plan)));
  // Public execution may not use locally overridden identities or constructors.
  if (e.spec.context.chainId === 10143) {
    assert.equal(e.spec.context.environment, "monad-testnet");
    assert.deepEqual(e.roles, { funder: plan.funder, operator: plan.operator, relayer: plan.relayer });
    assert.equal(keccak256(data), "0x6c96a4e8ccc2d08f74901b43f5ba2e47345f1db218ae913e5fb86b4d8971b898");
  } else { assert.equal(e.spec.context.chainId, 31337); assert.equal(e.spec.context.environment, "local-simulation"); }
  return { ...e, data, executionHash: hash(canaryJson(e)), manifestHash: e.spec.programmeManifestHash };
}
function allocation(e, anchor) {
  assert.deepEqual(Object.keys(anchor).sort(), ["blockHash", "blockNumber", "publishedAt"]);
  assert.match(anchor.blockHash, /^0x[0-9a-f]{64}$/); assert.match(anchor.blockNumber, /^(0|[1-9][0-9]*)$/);
  assert.match(anchor.publishedAt, /^[1-9][0-9]*$/);
  const awards = [
    { entitlementId: hash("RacesOn synthetic canary 2026-09-09 consented claim"), beneficiaryId: hash("canary external-wallet beneficiary"),
      pot: 0, amount: parseEther(plan.singleClaimMON), explanationHash: hash("Synthetic protocol test: 0.1 MON, not a sporting result"), beneficiaryKind: 0 },
    { entitlementId: hash("RacesOn synthetic canary 2026-09-09 walletless reserve"), beneficiaryId: hash("canary walletless beneficiary"),
      pot: 0, amount: parseEther(plan.walletlessReserveMON), explanationHash: hash("Synthetic protocol test: 0.4 MON reserved, no wallet or recipient"), beneficiaryKind: 0 },
  ].sort((a, b) => a.entitlementId < b.entitlementId ? -1 : a.entitlementId > b.entitlementId ? 1 : 0);
  return rewardAllocationCommitment({ ...e.spec, budget, awards, latestPublicationAt: BigInt(anchor.publishedAt),
    snapshotDigest: hash(canaryJson({ kind: "synthetic-contract-canary-only", executionHash: e.executionHash, anchor, awards })) });
}
function stepDefinition(e, upload, id) {
  const base = { id, chainId: e.spec.context.chainId, value: 0n, data: "0x", to: e.spec.context.verifyingContract,
    role: "operator", from: e.roles.operator, maxGas: 500000n };
  if (id === "operator-topup" || id === "relayer-topup") return { ...base, role: "funder", from: e.roles.funder,
    nonce: e.funderNonce + (id === "relayer-topup" ? 1 : 0), to: id === "operator-topup" ? e.roles.operator : e.roles.relayer,
    value: parseEther(id === "operator-topup" ? plan.operatorTopUpMON : plan.relayerTopUpMON), maxGas: 50000n };
  if (id === "deploy") return { ...base, nonce: 0, to: null, data: e.data, maxGas: BigInt(plan.deploymentGasLimitCeiling) };
  const call = {
    fund: ["completeFunding", [0n, budget], 1], upload: ["uploadAwards", [upload.awards], 2],
    stage: ["stageAllocation", [upload.snapshotDigest, upload.uploadDigest, upload.entitlementCount, upload.latestPublicationAt], 3],
    activate: ["activate", [upload.allocationDigest, upload.snapshotDigest], 4],
  }[id];
  assert.ok(call);
  return { ...base, nonce: call[2], value: id === "fund" ? budget : 0n,
    data: encodeFunctionData({ abi, functionName: call[0], args: call[1] }) };
}
export async function verifyContractCanaryAttempt(input, execution, anchor, id) {
  const e = normalizeExecution(execution), step = stepDefinition(e, allocation(e, anchor), id);
  assert.deepEqual(Object.keys(input).sort(), ["executionHash", "id", "signedTransaction", "transactionHash"]);
  assert.equal(input.executionHash, e.executionHash); assert.equal(input.id, id);
  assert.match(input.signedTransaction, /^0x[0-9a-f]+$/); assert.ok(input.signedTransaction.length <= 65536);
  assert.equal(keccak256(input.signedTransaction), input.transactionHash);
  const tx = parseTransaction(input.signedTransaction);
  assert.equal(tx.type, "eip1559"); assert.equal(tx.chainId, step.chainId); assert.equal(tx.nonce, step.nonce);
  assert.ok(step.to === null ? tx.to === undefined : same(tx.to, step.to));
  assert.equal(tx.value ?? 0n, step.value); assert.equal(tx.data ?? "0x", step.data);
  assert.ok(!tx.accessList || tx.accessList.length === 0);
  assert.ok(tx.gas >= 21000n && tx.gas <= step.maxGas);
  assert.ok(tx.maxFeePerGas > 0n && tx.maxFeePerGas <= maxFeePerGas);
  assert.ok(tx.maxPriorityFeePerGas >= 0n && tx.maxPriorityFeePerGas <= tx.maxFeePerGas);
  const cap = step.role === "funder" ? roleFeeCaps.funder / 2n : roleFeeCaps.operator;
  assert.ok(tx.gas * tx.maxFeePerGas <= cap);
  assert.ok(same(await recoverTransactionAddress({ serializedTransaction: input.signedTransaction }), step.from));
  return { tx, step, feeReserve: tx.gas * tx.maxFeePerGas };
}
async function receiptOrMissing(client, transactionHash) {
  try { return await client.getTransactionReceipt({ hash: transactionHash }); }
  catch (error) { if (error?.name === "TransactionReceiptNotFoundError") return null; throw error; }
}
async function checkpoint(client, e) {
  assert.equal(await client.getChainId(), e.spec.context.chainId);
  const block = await client.getBlock({ blockTag: "finalized" }); assert.ok(block.hash && block.number !== null && block.timestamp > 0n);
  return block;
}
const read = (client, e, blockNumber, functionName, args = []) => client.readContract({ address: e.spec.context.verifyingContract, abi, functionName, args, blockNumber });
async function assertState(client, e, upload, blockNumber, state) {
  const address = e.spec.context.verifyingContract;
  verifyRewardRuntimeV2(e.spec, await client.getCode({ address, blockNumber }));
  assert.equal(await read(client, e, blockNumber, "state"), state);
  assert.equal(await read(client, e, blockNumber, "paused"), false);
  const funded = state >= 1, uploaded = state >= 2;
  assert.equal(await read(client, e, blockNumber, "accountedFunding"), funded ? budget : 0n);
  assert.equal(await read(client, e, blockNumber, "budgets", [0n]), funded ? budget : 0n);
  assert.equal(await read(client, e, blockNumber, "budgets", [1n]), 0n);
  assert.equal(await read(client, e, blockNumber, "paid", [0n]), 0n);
  assert.equal(await read(client, e, blockNumber, "paid", [1n]), 0n);
  assert.equal(await read(client, e, blockNumber, "treasuryReturned"), 0n);
  // State.Review is shared by pre/post-upload. Its precise digest is checked separately.
  if (uploaded) {
    assert.equal(await read(client, e, blockNumber, "allocated", [0n]), parseEther("0.5"));
    assert.equal(await read(client, e, blockNumber, "uploadDigest"), upload.uploadDigest);
    assert.equal(await read(client, e, blockNumber, "entitlementCount"), 2n);
    assert.equal(await read(client, e, blockNumber, "allocationDigest"), upload.allocationDigest);
    assert.equal(await read(client, e, blockNumber, "snapshotDigest"), upload.snapshotDigest);
    for (const row of upload.awards) {
      const award = await read(client, e, blockNumber, "entitlements", [row.entitlementId]);
      assert.deepEqual(award, [row.beneficiaryId, row.amount, row.explanationHash, 0n, zeroAddress, 0, false, 0]);
    }
  }
}
async function assertUpload(client, e, upload, blockNumber, uploaded) {
  assert.equal(await read(client, e, blockNumber, "uploadDigest"), uploaded ? upload.uploadDigest : zeroHash);
  assert.equal(await read(client, e, blockNumber, "entitlementCount"), uploaded ? 2n : 0n);
  assert.equal(await read(client, e, blockNumber, "allocated", [0n]), uploaded ? parseEther("0.5") : 0n);
}
async function verifyFinalizedStep(client, e, upload, step, attempt, tx, receipt) {
  const final = await checkpoint(client, e);
  assert.equal(receipt.status, "success"); assert.equal(receipt.transactionHash, attempt.transactionHash);
  assert.ok(final.number >= receipt.blockNumber, "Transaction not finalized; reconcile this exact attempt later");
  const [block, observed] = await Promise.all([client.getBlock({ blockNumber: receipt.blockNumber }), client.getTransaction({ hash: attempt.transactionHash })]);
  assert.equal(block.hash, receipt.blockHash); assert.equal(observed.blockHash, block.hash);
  assert.equal(observed.hash, attempt.transactionHash); assert.equal(observed.type, "eip1559");
  assert.equal(observed.chainId, step.chainId); assert.equal(observed.nonce, step.nonce);
  assert.ok(same(observed.from, step.from) && same(receipt.from, step.from));
  assert.ok(step.to === null ? observed.to === null && receipt.to === null : same(observed.to, step.to) && same(receipt.to, step.to));
  assert.equal(observed.value, step.value); assert.equal(observed.input, step.data);
  assert.equal(observed.gas, tx.gas); assert.equal(observed.maxFeePerGas, tx.maxFeePerGas); assert.equal(observed.maxPriorityFeePerGas, tx.maxPriorityFeePerGas);
  assert.ok(receipt.gasUsed > 0n && receipt.gasUsed <= tx.gas && receipt.effectiveGasPrice <= tx.maxFeePerGas);
  if (step.id === "deploy") {
    assert.ok(same(receipt.contractAddress, e.spec.context.verifyingContract));
    await readVerifiedRewardDeploymentV2(client, { ...e.spec, deploymentNonce: 0n, deploymentTransactionHash: attempt.transactionHash }, e.creationCode);
    await assertState(client, e, upload, block.number, 0);
  } else if (["fund", "upload"].includes(step.id)) {
    await assertState(client, e, upload, block.number, 1); await assertUpload(client, e, upload, block.number, step.id === "upload");
  } else if (["stage", "activate"].includes(step.id)) {
    await assertState(client, e, upload, block.number, step.id === "stage" ? 2 : 3);
    if (step.id === "stage") requireRewardReviewClockV2({ protocolVersion: await read(client, e, block.number, "PROTOCOL_VERSION"),
      period: await read(client, e, block.number, "REVIEW_PERIOD"), reviewStartedAt: await read(client, e, block.number, "reviewStartedAt"),
      stageBlockTimestamp: block.timestamp, activationNotBefore: await read(client, e, block.number, "activationNotBefore"), latestPublicationAt: upload.latestPublicationAt });
    else assert.equal(await read(client, e, block.number, "claimDeadline"), block.timestamp + 31536000n);
  }
  const again = await client.getBlock({ blockNumber: block.number });
  const anchor = await client.getBlock({ blockNumber: final.number });
  assert.equal(again.hash, block.hash); assert.equal(anchor.hash, final.hash);
  assert.equal(await client.getChainId(), step.chainId);
  return { id: step.id, executionHash: e.executionHash, transactionHash: attempt.transactionHash,
    blockNumber: String(block.number), blockHash: block.hash, blockTimestamp: String(block.timestamp),
    gasFeeWei: String(receipt.gasUsed * receipt.effectiveGasPrice) };
}

function requireSourceObservation(e, deployment, source) {
  assert.deepEqual(Object.keys(source).sort(), ["address", "chainId", "deploymentBlockHash", "deploymentBlockNumber",
    "deploymentTransactionHash", "packageHash", "runtimeCodeHash", "status", "verifier"]);
  assert.equal(source.status, "exact-source-observed");
  assert.equal(source.chainId, e.spec.context.chainId); assert.equal(source.address, e.spec.context.verifyingContract);
  assert.equal(source.packageHash, canarySourcePackageHash); assert.equal(source.verifier, canarySourceVerifier);
  assert.equal(source.deploymentTransactionHash, deployment.transactionHash);
  assert.equal(source.deploymentBlockNumber, deployment.blockNumber); assert.equal(source.deploymentBlockHash, deployment.blockHash);
  assert.match(source.runtimeCodeHash, /^0x[0-9a-f]{64}$/);
}

export async function executeContractCanary({ execution, client, journalDirectory, action, approvedManifestHash, signerForRole,
  verifySource, onProgress = () => {} }) {
  assert.ok(["deploy", "stage", "activate", "inspect"].includes(action));
  const e = normalizeExecution(execution), readOnly = action === "inspect";
  const capturedExecution = { spec: e.spec, creationCode: e.creationCode, roles: e.roles, funderNonce: e.funderNonce };
  // This explicit bound acknowledgement is a guard, not proof of human authority.
  // The operator must obtain actual owner approval before invoking a write action.
  if (!readOnly) assert.equal(approvedManifestHash, e.manifestHash, "Exact owner-approved manifest acknowledgement required");
  // Like client/signerForRole, verifySource is an operator-owned dependency, not
  // browser JSON or a caller-provided "verified" boolean. The CLI binds it to the
  // pinned source package and actual documented read-only explorer observer.
  const publicFundedAction = e.spec.context.chainId === 10143 && ["stage", "activate"].includes(action);
  const sourceRequired = e.spec.context.chainId === 10143 || verifySource !== undefined;
  if (publicFundedAction) {
    assert.equal(typeof verifySource, "function", "Public source-verification gate requires the actual observer");
    // Public funded actions cannot implicitly perform top-ups/deployment. They
    // resume an already reconciled phase; activation also requires staged review.
    const prior = openCanaryJournal(journalDirectory, { readOnly: true });
    assert.ok(prior, "Public source-verification gate requires the completed deployment phase");
    try {
      assert.ok(prior.read("deploy-confirmed.json"), "Complete deployment reconciliation before funding");
      if (action === "activate") assert.ok(prior.read("stage-confirmed.json"), "Complete staging before activation");
    } finally { prior.close(); }
  }
  const journal = openCanaryJournal(journalDirectory, { readOnly });
  if (!journal) return { status: "no-local-execution-record", chainId: e.spec.context.chainId, manifestHash: e.manifestHash };
  try {
    let record = journal.read("execution.json");
    if (!record) {
      assert.ok(!readOnly, "Incomplete execution journal");
      const block = await checkpoint(client, e);
      record = { executionHash: e.executionHash, manifestHash: e.manifestHash,
        anchor: { blockHash: block.hash, blockNumber: String(block.number), publishedAt: String(block.timestamp) } };
      journal.write("execution.json", record);
    }
    assert.deepEqual(Object.keys(record).sort(), ["anchor", "executionHash", "manifestHash"]);
    assert.equal(record.executionHash, e.executionHash); assert.equal(record.manifestHash, e.manifestHash);
    const upload = allocation(e, record.anchor);
    const sourceBlock = await client.getBlock({ blockNumber: BigInt(record.anchor.blockNumber) });
    assert.equal(sourceBlock.hash, record.anchor.blockHash); assert.equal(sourceBlock.timestamp, upload.latestPublicationAt);
    const saved = new Map(), feeReserves = { funder: 0n, operator: 0n }, receipts = [];
    let gap = false;
    for (const id of orderedSteps) {
      const attempt = journal.read(`${id}-attempt.json`), confirmation = journal.read(`${id}-confirmed.json`);
      if (!attempt) { assert.equal(confirmation, null); gap = true; continue; }
      assert.ok(!gap, "Journal has missing earlier steps; do not regenerate them");
      const checked = await verifyContractCanaryAttempt(attempt, capturedExecution, record.anchor, id);
      feeReserves[checked.step.role] += checked.feeReserve;
      assert.ok(feeReserves[checked.step.role] <= roleFeeCaps[checked.step.role]);
      saved.set(id, { attempt, confirmation, ...checked });
    }
    for (const id of orderedSteps) {
      let entry = saved.get(id);
      const maySend = !readOnly && orderedSteps.indexOf(id) <= orderedSteps.indexOf(action);
      if (!entry && !maySend) break;
      const step = stepDefinition(e, upload, id);
      const gated = sourceRequired && ["fund", "upload", "stage", "activate"].includes(id);
      const observeSource = async () => {
        assert.equal(typeof verifySource, "function", "Source verification is required before signing or broadcasting");
        const deployment = receipts.find(receipt => receipt.id === "deploy"); assert.ok(deployment);
        const expected = { ...e.spec, deploymentNonce: 0n, deploymentTransactionHash: deployment.transactionHash };
        const source = structuredClone(await verifySource(structuredClone(expected)));
        requireSourceObservation(e, deployment, source);
        const block = await checkpoint(client, e);
        assert.equal(verifyRewardRuntimeV2(e.spec, await client.getCode({ address: e.spec.context.verifyingContract,
          blockNumber: block.number })), source.runtimeCodeHash);
        assert.equal((await client.getBlock({ blockNumber: block.number })).hash, block.hash);
        assert.equal(await client.getChainId(), e.spec.context.chainId);
        const evidence = { executionHash: e.executionHash, id, source };
        const old = journal.read(`${id}-source.json`);
        if (old) assert.deepEqual(old, evidence);
        else journal.write(`${id}-source.json`, evidence);
      };
      // Persisted evidence binds the original attempt. It is not a reusable send
      // approval: observeSource runs afresh before each new sign and broadcast.
      if (entry && gated) {
        const evidence = journal.read(`${id}-source.json`); assert.ok(evidence);
        assert.equal(evidence.executionHash, e.executionHash); assert.equal(evidence.id, id);
        requireSourceObservation(e, receipts.find(receipt => receipt.id === "deploy"), evidence.source);
      }
      if (!entry) {
        const block = await checkpoint(client, e);
        assert.equal(await client.getTransactionCount({ address: step.from, blockTag: "latest" }), step.nonce);
        assert.equal(await client.getTransactionCount({ address: step.from, blockTag: "pending" }), step.nonce);
        assert.ok(!(await client.getCode({ address: step.from }))?.replace(/^0x$/, ""), "Signer must remain an undelegated EOA");
        if (id === "operator-topup") {
          assert.ok(await client.getBalance({ address: e.roles.funder, blockNumber: block.number }) >= parseEther("2.12"));
          assert.ok(await client.getBalance({ address: e.roles.funder, blockTag: "latest" }) >= parseEther("2.12"));
          for (const role of ["operator", "relayer"]) {
            assert.equal(await client.getTransactionCount({ address: e.roles[role], blockTag: "latest" }), 0);
            assert.equal(await client.getTransactionCount({ address: e.roles[role], blockTag: "pending" }), 0);
            const roleCode = await client.getCode({ address: e.roles[role] }); assert.ok(!roleCode || roleCode === "0x");
          }
          const predictedCode = await client.getCode({ address: e.spec.context.verifyingContract });
          assert.ok(!predictedCode || predictedCode === "0x");
        }
        if (id.endsWith("topup") || id === "deploy") {
          const code = await client.getCode({ address: step.to ?? e.spec.context.verifyingContract });
          assert.ok(!code || code === "0x");
        } else {
          await assertState(client, e, upload, block.number, id === "fund" ? 0 : id === "activate" ? 2 : 1);
          if (["upload", "stage"].includes(id)) await assertUpload(client, e, upload, block.number, id === "stage");
          if (id === "activate") {
            const deadline = await read(client, e, block.number, "activationNotBefore");
            if (block.timestamp < deadline) return { status: "review-open", chainId: step.chainId, address: e.spec.context.verifyingContract,
              reviewDeadline: String(deadline), allocationDigest: upload.allocationDigest, receipts };
          }
        }
        const request = { account: step.from, ...(step.to ? { to: step.to } : {}), value: step.value, data: step.data };
        const [estimate, fees, balance, latestBalance] = await Promise.all([client.estimateGas(request), client.estimateFeesPerGas(),
          client.getBalance({ address: step.from, blockNumber: block.number }), client.getBalance({ address: step.from, blockTag: "latest" })]);
        const gas = (estimate * 120n + 99n) / 100n;
        assert.ok(gas >= 21000n && gas <= step.maxGas);
        assert.ok(fees.maxFeePerGas > 0n && fees.maxFeePerGas <= maxFeePerGas && fees.maxPriorityFeePerGas >= 0n && fees.maxPriorityFeePerGas <= fees.maxFeePerGas);
        const reserved = gas * fees.maxFeePerGas;
        assert.ok(feeReserves[step.role] + reserved <= roleFeeCaps[step.role]);
        if (step.role === "funder") assert.ok(reserved <= roleFeeCaps.funder / 2n);
        assert.ok(balance >= step.value + reserved && latestBalance >= step.value + reserved);
        assert.equal((await client.getBlock({ blockNumber: block.number })).hash, block.hash);
        assert.equal(await client.getChainId(), step.chainId);
        if (gated) {
          await observeSource();
          // Explorer IO can take seconds. Do not sign using a nonce/balance
          // snapshot taken before that asynchronous boundary.
          assert.equal(await client.getTransactionCount({ address: step.from, blockTag: "latest" }), step.nonce);
          assert.equal(await client.getTransactionCount({ address: step.from, blockTag: "pending" }), step.nonce);
          assert.ok(await client.getBalance({ address: step.from, blockTag: "latest" }) >= step.value + reserved);
        }
        const account = await signerForRole(step.role); assert.ok(same(account.address, step.from));
        const signedTransaction = await account.signTransaction({ type: "eip1559", chainId: step.chainId, nonce: step.nonce,
          ...(step.to ? { to: step.to } : {}), value: step.value, data: step.data, gas,
          maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas });
        const attempt = { id, executionHash: e.executionHash, signedTransaction, transactionHash: keccak256(signedTransaction) };
        const checked = await verifyContractCanaryAttempt(attempt, capturedExecution, record.anchor, id);
        journal.write(`${id}-attempt.json`, attempt);
        entry = { attempt, confirmation: null, ...checked }; saved.set(id, entry); feeReserves[step.role] += checked.feeReserve;
      }
      // Public transaction identity only. A later timeout must not hide the hash
      // the operator should reconcile; never log signed bytes or signer errors.
      onProgress({ status: "attempt-persisted", chainId: step.chainId, step: id, transactionHash: entry.attempt.transactionHash });
      let receipt = await receiptOrMissing(client, entry.attempt.transactionHash);
      if (!receipt) {
        assert.equal(entry.confirmation, null, "Finalized receipt disappeared; stop for reconciliation");
        if (!maySend) return { status: "unconfirmed-attempt", chainId: step.chainId, step: id, transactionHash: entry.attempt.transactionHash, receipts };
        if (gated) await observeSource();
        assert.equal(await client.getChainId(), step.chainId);
        // Re-broadcast only identical bytes. Never fee-bump, replace nonce or sign again.
        const returned = await client.sendRawTransaction({ serializedTransaction: entry.attempt.signedTransaction });
        assert.equal(returned, entry.attempt.transactionHash);
        receipt = await client.waitForTransactionReceipt({ hash: returned, timeout: 30000, pollingInterval: 1000, retryCount: 0 });
      }
      const confirmation = await verifyFinalizedStep(client, e, upload, step, entry.attempt, entry.tx, receipt);
      if (entry.confirmation) assert.deepEqual(confirmation, entry.confirmation);
      else if (maySend) journal.write(`${id}-confirmed.json`, confirmation);
      receipts.push(confirmation);
    }
    const final = await checkpoint(client, e);
    const stageReceipt = receipts.find(r => r.id === "stage"), active = receipts.some(r => r.id === "activate");
    if (stageReceipt) await assertState(client, e, upload, final.number, active ? 3 : 2);
    return { status: active ? "active-awaiting-recipient-consent" : stageReceipt ? "staged-review"
      : receipts.some(r => r.id === "upload") ? "uploaded-awaiting-review"
      : receipts.some(r => r.id === "fund") ? "funded-awaiting-allocation"
      : receipts.some(r => r.id === "deploy") ? "deployed-awaiting-source-verification" : "partial",
      chainId: e.spec.context.chainId, address: receipts.some(r => r.id === "deploy") ? e.spec.context.verifyingContract : null,
      allocationDigest: stageReceipt ? upload.allocationDigest : null,
      reviewDeadline: stageReceipt ? String(BigInt(stageReceipt.blockTimestamp) + 86400n) : null,
      plannedBudgetMON: "1", fundedMON: receipts.some(r => r.id === "fund") ? "1" : "0",
      allocatedMON: receipts.some(r => r.id === "upload") ? "0.5" : "0", walletlessReserveMON: stageReceipt ? "0.4" : null,
      unallocatedMON: stageReceipt ? "0.5" : null, paidMON: "0", receipts };
  } finally { journal.close(); }
}
