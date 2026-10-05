import assert from "node:assert/strict";
import { encodeFunctionData, keccak256, parseTransaction, recoverTransactionAddress, serializeTransaction, TransactionNotFoundError } from "viem";
import { readVerifiedRewardProgrammeV3, rewardProgrammeV3Abi } from "@raceson/rewards-chain/programme-v3";

const draftId = "9a000000-0000-4000-8000-000000000052", budget = 100n * 10n ** 18n;
const operator = "0x4c5616771ffce5fc41bcb4a30dd2b55aac8ebe31", funder = "0xa768ad0500ee7536c2583c1953377eff561ec98b";
const maximumStepGasWei = 25n * 10n ** 16n; // Seven fixed steps: at most 1.75 test MON total gas.

export function privyFundingCall(action, expected) {
  assert.equal(expected.context.chainId, 10143); assert.equal(expected.budgetWei, budget);
  assert.equal(expected.operatorAddress.toLowerCase(), operator); assert.equal(expected.funderAddress.toLowerCase(), funder);
  assert.ok(action === "operator-gas" || action === "deposit" || /^route-[0-5]$/.test(action));
  if (action === "operator-gas") return { to: operator, value: 2n * 10n ** 18n, data: "0x" };
  return { to: expected.context.verifyingContract, value: action === "deposit" ? budget : 0n,
    data: encodeFunctionData({ abi: rewardProgrammeV3Abi, functionName: action === "deposit" ? "deposit" : "routePot",
      args: [action === "deposit" ? 0n : Number(action.slice(-1))] }) };
}

/** One bounded immutable attempt per fixed programme funding step. This is not
 * an athlete payout path. No test RPC, balance override, mainnet or new key. */
export async function fundPrivyProgrammeStep({ reader, expected, journal, current, active, loadSigner, observe = readVerifiedRewardProgrammeV3 }, action) {
  active(); const call = privyFundingCall(action, expected);
  assert.equal(await reader.getChainId(), 10143);
  const topup = action === "operator-gas", gasCeiling = topup ? 2n * 10n ** 16n : maximumStepGasWei;
  const role = action === "deposit" || topup ? "funder" : "operator", address = role === "funder" ? funder : operator;
  const file = `${action}.json`; let entry = journal.read(file);
  if (!entry) {
    if (topup) {
      assert.ok(await reader.getBalance({ address: operator }) < 2n * 10n ** 18n, "Operator already has sufficient trial gas; do not top up again");
    } else {
      const state = await observe(reader, expected);
      assert.equal(action === "deposit" ? state.depositedWei : state.pots[Number(action.slice(-1))].routed, action === "deposit" ? 0n : false,
        "An unjournaled transaction changed funding; reconcile manually");
      if (action !== "deposit") assert.equal(state.depositedWei, budget);
    }
    const nonce = await reader.getTransactionCount({ address, blockTag: "pending" });
    assert.equal(await reader.getTransactionCount({ address, blockTag: "latest" }), nonce, "Signer already has a pending transaction");
    const gas = await reader.estimateGas({ ...call, account: address }) * 12n / 10n;
    const fees = await reader.estimateFeesPerGas();
    assert.ok(gas > 0n && gas * fees.maxFeePerGas <= gasCeiling);
    assert.ok(await reader.getBalance({ address }) >= call.value + gas * fees.maxFeePerGas, "Insufficient test MON; no automatic top-up");
    await current(); active(); const signer = loadSigner(role); assert.equal(signer.address.toLowerCase(), address);
    await current(); active();
    const signedTransaction = await signer.signTransaction({ ...call, chainId: 10143, type: "eip1559", nonce, gas, ...fees });
    entry = { schemaVersion: 1, draftId, action, manifestHash: expected.programmeManifestHash,
      signedTransaction, transactionHash: keccak256(signedTransaction) };
    await current(); active(); journal.write(file, entry);
  }
  assert.deepEqual(Object.keys(entry).sort(), ["schemaVersion", "draftId", "action", "manifestHash", "signedTransaction", "transactionHash"].sort());
  assert.equal(entry.schemaVersion, 1); assert.equal(entry.draftId, draftId); assert.equal(entry.action, action);
  assert.equal(entry.manifestHash, expected.programmeManifestHash); assert.equal(keccak256(entry.signedTransaction), entry.transactionHash);
  const tx = parseTransaction(entry.signedTransaction);
  assert.equal(tx.type, "eip1559"); assert.equal(tx.chainId, 10143); assert.equal(tx.accessList?.length ?? 0, 0);
  assert.equal(serializeTransaction(tx), entry.signedTransaction); assert.equal(tx.to.toLowerCase(), call.to.toLowerCase());
  assert.equal(tx.value ?? 0n, call.value); assert.equal(tx.data ?? "0x", call.data);
  assert.ok(tx.gas > 0n && tx.maxFeePerGas > 0n && tx.gas * tx.maxFeePerGas <= gasCeiling);
  assert.ok(tx.maxPriorityFeePerGas >= 0n && tx.maxPriorityFeePerGas <= tx.maxFeePerGas);
  assert.equal((await recoverTransactionAddress({ serializedTransaction: entry.signedTransaction })).toLowerCase(), address);
  let known;
  try { known = await reader.getTransaction({ hash: entry.transactionHash }); }
  catch (error) { if (!(error instanceof TransactionNotFoundError)) throw error; }
  if (!known) {
    // A receipt journal with missing chain history must never trigger a resend.
    assert.equal(journal.read(`${action}-receipt.json`), null);
    assert.equal(await reader.getTransactionCount({ address, blockTag: "pending" }), tx.nonce);
    assert.equal(await reader.getTransactionCount({ address, blockTag: "latest" }), tx.nonce);
    assert.ok(await reader.getBalance({ address }) >= call.value + tx.gas * tx.maxFeePerGas);
    if (!topup) await observe(reader, expected);
    await current(); active();
    assert.equal(await reader.sendRawTransaction({ serializedTransaction: entry.signedTransaction }), entry.transactionHash);
    return { action, transactionHash: entry.transactionHash, status: "submitted_reconcile_original" };
  }
  assert.equal(known.hash, entry.transactionHash); assert.equal(known.chainId, 10143);
  assert.equal(known.from.toLowerCase(), address); assert.equal(known.to.toLowerCase(), call.to.toLowerCase());
  assert.equal(known.nonce, tx.nonce); assert.equal(known.input, call.data); assert.equal(known.value, call.value);
  if (known.blockNumber === null) return { action, transactionHash: entry.transactionHash, status: "pending" };
  const receipt = await reader.getTransactionReceipt({ hash: entry.transactionHash });
  const finalized = await reader.getBlock({ blockTag: "finalized" });
  if (finalized.number < receipt.blockNumber) return { action, transactionHash: entry.transactionHash, status: "awaiting_finality" };
  assert.equal(receipt.status, "success"); assert.equal(receipt.transactionHash, entry.transactionHash);
  assert.equal(receipt.blockHash, known.blockHash);
  assert.equal((await reader.getBlock({ blockNumber: receipt.blockNumber })).hash, receipt.blockHash);
  if (!topup) {
    const state = await observe(reader, expected);
    assert.equal(state.depositedWei, budget);
    if (action !== "deposit") assert.equal(state.pots[Number(action.slice(-1))].routed, true);
    assert.ok(state.pots.every(p => p.paidWei === 0n), "Funding phase must not contain recipient payouts");
  }
  const proof = { transactionHash: entry.transactionHash, blockNumber: receipt.blockNumber.toString(), blockHash: receipt.blockHash };
  const prior = journal.read(`${action}-receipt.json`);
  if (prior) assert.deepEqual(prior, proof); else { active(); journal.write(`${action}-receipt.json`, proof); }
  return { ...proof, action, status: "confirmed" };
}
