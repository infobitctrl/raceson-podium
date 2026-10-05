import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getContractAddress, keccak256, parseEther, parseTransaction } from "viem";
import { startOwnedRewardChain, fixtureSigner } from "./owned-chain.mjs";
import { executeContractCanary, publicCanaryExecution, verifyContractCanaryAttempt } from "../../../demo/rewards/scripts/final-results-canary-executor.mjs";
import { openCanaryJournal } from "../../../demo/rewards/scripts/canary-journal.mjs";

// These tests never import the Mac Keychain loader or a public RPC client.
const artifact = JSON.parse(readFileSync(new URL("../../../contracts/out/RacesOnRewardCampaignV3.sol/RacesOnRewardCampaignV3.json", import.meta.url), "utf8"));
let chain, execution, directory, parent, client, staged, active;
const funder = fixtureSigner(0x777), signed = [], sent = [];
const signers = {}, failIfSigning = async () => { throw Error("Unexpected signing"); };
let dropUploadResponse = true, stopBeforeFirstBroadcast = true;
before(async () => {
  parent = realpathSync(mkdtempSync(join(tmpdir(), "raceson-v3-contract-canary-")));
  directory = join(parent, "journal"); chain = await startOwnedRewardChain();
  Object.assign(signers, { funder, operator: chain.operator });
  await chain.testClient.setBalance({ address: funder.address, value: parseEther("1000") });
  await chain.testClient.setNonce({ address: funder.address, nonce: 1 });
  await chain.testClient.setBalance({ address: chain.operator.address, value: parseEther("1") });
  await chain.testClient.setNonce({ address: chain.operator.address, nonce: 4 });
  await chain.testClient.setBalance({ address: chain.relayer.address, value: parseEther("0.001") });
  await chain.testClient.mine({ blocks: 96, interval: 1 });
  const source = publicCanaryExecution(artifact);
  execution = { ...source, spec: { ...source.spec, context: { environment: "local-simulation", chainId: 31337,
    verifyingContract: getContractAddress({ from: chain.operator.address, nonce: 4n }) }, operatorAddress: chain.operator.address, treasuryAddress: funder.address },
    roles: { funder: funder.address, operator: chain.operator.address, relayer: chain.relayer.address } };
  client = { ...chain.publicClient, sendRawTransaction: async args => {
    const tx = parseTransaction(args.serializedTransaction), hash = keccak256(args.serializedTransaction);
    const expected = tx.to?.toLowerCase() === execution.spec.context.verifyingContract.toLowerCase()
      ? ({ 5: "fund", 6: "upload", 7: "stage", 8: "activate" })[tx.nonce]
      : !tx.to ? "deploy" : "unsupported";
    const saved = JSON.parse(readFileSync(join(directory, expected + "-attempt.json"), "utf8"));
    assert.equal(saved.transactionHash, hash, "Exact signed attempt is durable BEFORE broadcast");
    assert.equal(lstatSync(join(directory, expected + "-attempt.json")).mode & 0o777, 0o600);
    if (expected === "deploy" && stopBeforeFirstBroadcast) { stopBeforeFirstBroadcast = false; throw Error("Simulated interruption before first broadcast"); }
    sent.push({ expected, hash });
    const result = await chain.publicClient.sendRawTransaction(args);
    await chain.testClient.mine({ blocks: 96, interval: 1 });
    if (expected === "upload" && dropUploadResponse) { dropUploadResponse = false; throw Error("Simulated lost response after actual mining"); }
    return result;
  } };
}, { timeout: 20000 });
after(async () => { await chain?.stop(); if (parent) rmSync(parent, { recursive: true, force: true }); });
const run = (action, overrides = {}) => executeContractCanary({ execution, client, journalDirectory: directory, action,
  approvedManifestHash: execution.spec.programmeManifestHash, signerForRole: async role => {
    signed.push(role); return signers[role];
  }, ...overrides });

test("missing/mismatched approval fails before RPC, journal creation or signer access; public constructors cannot be replaced", async () => {
  const fresh = join(parent, "not-approved"); let reads = 0;
  for (const approvedManifestHash of [undefined, `0x${"00".repeat(32)}`]) await assert.rejects(run("stage", {
    journalDirectory: fresh, approvedManifestHash, client: { getChainId: async () => { reads++; return 31337; } }, signerForRole: failIfSigning,
  }));
  assert.equal(reads, 0); assert.equal(existsSync(fresh), false);
  const publicExecution = publicCanaryExecution(artifact);
  for (const action of ["stage", "activate"]) await assert.rejects(run(action, { execution: publicExecution,
    journalDirectory: fresh, signerForRole: failIfSigning }), /source-verification gate/);
  assert.equal(existsSync(fresh), false);
  for (const altered of [
    { ...publicExecution, roles: { ...publicExecution.roles, funder: funder.address } },
    { ...publicExecution, spec: { ...publicExecution.spec, context: { ...publicExecution.spec.context, chainId: 143 } } },
    { ...publicExecution, creationCode: "0x00" }, { ...publicExecution, funderNonce: 2 },
  ]) await assert.rejects(run("stage", { execution: altered, signerForRole: failIfSigning, journalDirectory: fresh }));
  assert.deepEqual(await run("inspect", { journalDirectory: fresh, signerForRole: failIfSigning }),
    { status: "no-local-execution-record", chainId: 31337, manifestHash: execution.spec.programmeManifestHash });
});

test("fee/gas caps, consumed operator nonce, missing funding and wrong network fail before the first transfer", async () => {
  const cases = [
    { patch: { estimateFeesPerGas: async () => ({ maxFeePerGas: 200000000001n, maxPriorityFeePerGas: 1n }) } },
    { patch: { estimateFeesPerGas: async () => ({ maxFeePerGas: 1n, maxPriorityFeePerGas: 2n }) } },
    { patch: { estimateGas: async () => 4000000n } }, // 20% headroom would exceed 4M.
    { patch: { getChainId: async () => 143 } },
    { setup: () => chain.testClient.setNonce({ address: chain.operator.address, nonce: 1 }) },
    { setup: () => chain.testClient.setBalance({ address: chain.operator.address, value: parseEther("0.01") }) },
    { setup: () => chain.testClient.setCode({ address: chain.operator.address, bytecode: "0x00" }) },
  ];
  for (const [i, c] of cases.entries()) {
    const snapshot = await chain.testClient.snapshot();
    let signingRequests = 0;
    try {
      await c.setup?.();
      await assert.rejects(run("stage", { journalDirectory: join(parent, "rejected-" + i),
        client: { ...client, ...c.patch }, signerForRole: async () => { signingRequests++; throw Error("Signing reached unexpectedly"); } }));
      assert.equal(signingRequests, 0, `Rejection case ${i} must fail before signing`);
    } finally { await chain.testClient.revert({ id: snapshot }); }
  }
  assert.deepEqual(sent, []); assert.deepEqual(signed, []);
});

test("real local canary persists before every send and survives a lost upload response with no duplicate funding or deployment", async () => {
  await assert.rejects(run("stage"), /Simulated interruption before first broadcast/);
  assert.equal(signed.length, 1); assert.equal(sent.length, 0);
  const pending = await run("inspect", { signerForRole: failIfSigning });
  assert.equal(pending.status, "unconfirmed-attempt"); assert.deepEqual(pending.receipts, []);
  assert.equal(pending.transactionHash, JSON.parse(readFileSync(join(directory, "deploy-attempt.json"), "utf8")).transactionHash);
  const deployment = await run("deploy");
  assert.equal(deployment.status, "deployed-awaiting-source-verification");
  assert.equal(deployment.receipts.length, 1); assert.equal(deployment.fundedMON, "0");
  assert.equal(deployment.allocatedMON, "0"); assert.equal(await chain.publicClient.getBalance({ address: deployment.address }), 0n);
  assert.deepEqual(await run("deploy", { signerForRole: failIfSigning }), deployment);
  await assert.rejects(run("stage"), /Simulated lost response/);
  assert.equal(existsSync(join(directory, "upload-attempt.json")), true);
  assert.equal(existsSync(join(directory, "upload-confirmed.json")), false);
  assert.equal(existsSync(join(directory, "running.lock")), false);
  assert.equal(sent.length, 3); assert.equal(signed.length, 3);
  // New executor invocation: all state is reconstructed from disk and chain.
  staged = await run("stage");
  assert.equal(staged.status, "approved-awaiting-activation"); assert.equal(staged.receipts.length, 4);
  assert.equal(sent.length, 4); assert.equal(signed.length, 4);
  assert.equal(new Set(sent.map(t => t.hash)).size, 4);
  assert.equal(staged.fundedMON, "0.1"); assert.equal(staged.allocatedMON, "0.05");
  assert.equal(staged.walletlessReserveMON, "0.04"); assert.equal(staged.unallocatedMON, "0.05"); assert.equal(staged.paidMON, "0");
  assert.equal(await chain.publicClient.getBalance({ address: staged.address }), parseEther("0.1"));
  assert.equal(await chain.publicClient.getBalance({ address: chain.relayer.address }), parseEther("0.001"));
  assert.equal(await chain.publicClient.getTransactionCount({ address: funder.address }), 1);
  assert.equal(await chain.publicClient.getTransactionCount({ address: chain.operator.address }), 8);
  const stage = staged.receipts.find(r => r.id === "stage");
  assert.equal(BigInt(staged.reviewDeadline), BigInt(stage.blockTimestamp));
  assert.ok(parseEther("1000") - await chain.publicClient.getBalance({ address: funder.address }) <= parseEther("2.12"));
  assert.equal(lstatSync(directory).mode & 0o777, 0o700);
  assert.deepEqual(await run("inspect", { signerForRole: failIfSigning }), staged);
  assert.deepEqual(await run("stage", { signerForRole: failIfSigning }), staged);
  assert.equal(sent.length, 4);
}, { timeout: 30000 });

test("journal retries refuse mutated transaction, nonce, destination, signature and approval binding", async () => {
  const anchor = JSON.parse(readFileSync(join(directory, "execution.json"), "utf8")).anchor;
  const attempt = JSON.parse(readFileSync(join(directory, "fund-attempt.json"), "utf8"));
  await verifyContractCanaryAttempt(attempt, execution, anchor, "fund");
  for (const patch of [{ id: "upload" }, { executionHash: `0x${"00".repeat(32)}` },
    { transactionHash: `0x${"00".repeat(32)}` }, { signedTransaction: "0x02" }, { extra: true }])
    await assert.rejects(verifyContractCanaryAttempt({ ...attempt, ...patch }, execution, anchor, "fund"));
  const decoded = parseTransaction(attempt.signedTransaction);
  const request = { type: "eip1559", chainId: decoded.chainId, nonce: decoded.nonce, to: decoded.to,
    value: decoded.value, data: decoded.data, gas: decoded.gas, maxFeePerGas: decoded.maxFeePerGas, maxPriorityFeePerGas: decoded.maxPriorityFeePerGas };
  for (const patch of [{ chainId: 143 }, { nonce: 7 }, { to: funder.address }, { value: parseEther("2") },
    { data: "0x" }, { gas: 500001n }, { maxFeePerGas: 200000000001n }, { accessList: [{ address: funder.address, storageKeys: [] }] }]) {
    const signedTransaction = await chain.operator.signTransaction({ ...request, ...patch });
    await assert.rejects(verifyContractCanaryAttempt({ ...attempt, signedTransaction, transactionHash: keccak256(signedTransaction) }, execution, anchor, "fund"));
  }
  const signedTransaction = await funder.signTransaction(request);
  await assert.rejects(verifyContractCanaryAttempt({ ...attempt, signedTransaction, transactionHash: keccak256(signedTransaction) }, execution, anchor, "fund"));
});

test("missing, reverted, noncanonical and unfinalized receipts cannot become success or authorize another attempt", async () => {
  const receipt = await chain.publicClient.getTransactionReceipt({ hash: staged.receipts[0].transactionHash });
  const patches = [
    { getTransactionReceipt: async () => { const error = Error("missing"); error.name = "TransactionReceiptNotFoundError"; throw error; } },
    { getTransactionReceipt: async () => ({ ...receipt, status: "reverted" }) },
    { getBlock: async args => args.blockTag === "finalized" ? { ...(await chain.publicClient.getBlock(args)), number: 0n } : chain.publicClient.getBlock(args) },
    { getTransaction: async args => ({ ...(await chain.publicClient.getTransaction(args)), input: "0x12" }) },
    { getChainId: async () => 143 },
  ];
  for (const patch of patches) await assert.rejects(run("stage", { client: { ...client, ...patch }, signerForRole: failIfSigning }));
  const before = sent.length;
  const record = JSON.parse(readFileSync(join(directory, "execution.json"), "utf8"));
  await assert.rejects(run("inspect", { client: { ...client, getBlock: async args => {
    const b = await chain.publicClient.getBlock(args); return args.blockNumber === BigInt(record.anchor.blockNumber) ? { ...b, hash: `0x${"ff".repeat(32)}` } : b;
  } }, signerForRole: failIfSigning }));
  assert.equal(sent.length, before); assert.equal(signed.length, 4);
});

test("explicit activation follows final approval without time travel; retry cannot activate twice or pay", async () => {
  active = await run("activate"); assert.equal(active.status, "active-awaiting-recipient-consent");
  assert.equal(active.receipts.length, 5); assert.equal(sent.length, 5); assert.equal(signed.length, 5);
  assert.deepEqual(await run("activate", { signerForRole: failIfSigning }), active);
  assert.deepEqual(await run("inspect", { signerForRole: failIfSigning }), active);
  assert.equal(await chain.publicClient.getBalance({ address: staged.address }), parseEther("0.1"));
  assert.equal(active.paidMON, "0");
}, { timeout: 30000 });

test("private journal refuses concurrent runs, broad permissions, symlinks and overwrites", () => {
  const path = join(parent, "journal-security"), journal = openCanaryJournal(path);
  assert.throws(() => openCanaryJournal(path)); assert.throws(() => openCanaryJournal(path, { readOnly: true }));
  journal.write("sample.json", { safe: true }); assert.deepEqual(journal.read("sample.json"), { safe: true });
  assert.throws(() => journal.write("sample.json", { safe: false }));
  assert.throws(() => journal.read("../escape.json")); journal.close();
  chmodSync(join(path, "sample.json"), 0o644);
  const readOnly = openCanaryJournal(path, { readOnly: true }); assert.throws(() => readOnly.read("sample.json")); readOnly.close();
  const link = join(parent, "symlinked"); symlinkSync(path, link); assert.throws(() => openCanaryJournal(link));
  const malformed = join(parent, "malformed"); mkdirSync(malformed, { mode: 0o700 });
  writeFileSync(join(malformed, "execution.json"), "partial", { mode: 0o600 });
  const broken = openCanaryJournal(malformed); assert.throws(() => broken.read("execution.json")); broken.close();
});

test("valid individual signed attempts cannot exceed the aggregate operator gas allowance on restart", async () => {
  const target = join(parent, "over-budget"), journal = openCanaryJournal(target);
  try {
    journal.write("execution.json", JSON.parse(readFileSync(join(directory, "execution.json"), "utf8")));
    for (const id of ["deploy", "fund", "upload", "stage", "activate"]) {
      let attempt = JSON.parse(readFileSync(join(directory, id + "-attempt.json"), "utf8"));
      if (true) {
        const tx = parseTransaction(attempt.signedTransaction);
        const signedTransaction = await chain.operator.signTransaction({ type: "eip1559", chainId: tx.chainId, nonce: tx.nonce,
          ...(tx.to ? { to: tx.to } : {}), data: tx.data, value: tx.value ?? 0n,
          gas: id === "deploy" ? 1500000n : 500000n, maxFeePerGas: 200000000000n, maxPriorityFeePerGas: 2000000000n });
        attempt = { ...attempt, signedTransaction, transactionHash: keccak256(signedTransaction) };
        const anchor = JSON.parse(readFileSync(join(directory, "execution.json"), "utf8")).anchor;
        await verifyContractCanaryAttempt(attempt, execution, anchor, id); // Each alone is within its envelope.
      }
      journal.write(id + "-attempt.json", attempt);
    }
  } finally { journal.close(); }
  let receiptsRead = 0;
  await assert.rejects(run("stage", { journalDirectory: target, signerForRole: failIfSigning,
    client: { ...client, getTransactionReceipt: async () => { receiptsRead++; throw Error("Reached receipt lookup"); } } }));
  assert.equal(receiptsRead, 0); assert.equal(sent.length, 5); assert.equal(signed.length, 5);
});
