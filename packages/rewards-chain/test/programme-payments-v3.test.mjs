import assert from "node:assert/strict";
import test from "node:test";
import { getContractAddress, keccak256, parseTransaction, serializeTransaction, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { rewardProgrammeChildV3 } from "../dist/programme-v3.js";
import { rewardAllocationCommitmentV3, rewardClaimMessagesV3 } from "../dist/campaign-v3.js";
import { normalizeRewardProgrammeAthletePaymentV3, verifyRewardProgrammeAthletePaymentV3, encodeRewardProgrammeAthletePaymentV3,
  verifySignedRewardProgrammeAthletePaymentV3, readRewardProgrammeAthletePaymentPreflightV3 } from "../dist/programme-payments-v3.js";

// Deterministic synthetic signers only; no public-network keys or calls.
const [operator, recipient, relayer, funder] = [0xA11CE, 9903, 0xFEED, 777].map(n => privateKeyToAccount(toHex(BigInt(n), { size: 32 })));
const h = n => toHex(BigInt(n), { size: 32 });
async function fixture(slot = 0) {
  const programme = { context: { environment: "local-simulation", chainId: 31337,
    verifyingContract: getContractAddress({ from: operator.address, nonce: 3n }) }, operatorAddress: operator.address, funderAddress: funder.address,
    programmeId: h(10), programmeManifestHash: h(11), budgetWei: 100n * 10n ** 18n,
    campaignIds: Array.from({ length: 6 }, (_, i) => h(20 + i)), reviewPeriods: [86400n, 0n, 0n, 0n, 0n, 0n],
    deploymentTransactionHash: h(30), deploymentNonce: 3n };
  const child = rewardProgrammeChildV3(programme, slot);
  const upload = rewardAllocationCommitmentV3({ ...child, budget: child.budgetWei, snapshotDigest: h(31),
    reviewStartedAt: 100n, officialPublishedAt: 100n + child.reviewPeriod, publicationEvidenceHash: h(32),
    awards: [{ entitlementId: h(40), beneficiaryId: h(41), amount: 1n, explanationHash: h(42), pot: child.enabledPot, beneficiaryKind: 0 }] });
  const claim = { entitlementId: h(40), recipient: recipient.address, amount: 1n, pot: slot === 5 ? "league" : "race", nonce: 7n,
    issuedAt: 1801000000n, expiresAt: 1801086400n, allocationDigest: upload.allocationDigest };
  const messages = rewardClaimMessagesV3(child.context, claim);
  return { protocolVersion: 3, expectation: { protocolVersion: 3, programme, slot, upload, stageTransactionHash: h(33),
    entitlementId: h(40), recipient: recipient.address }, claim, relayerAddress: relayer.address, nonce: 0n,
    proofs: { operator: await operator.signTypedData(messages.authorization), recipient: await recipient.signTypedData(messages.consent) } };
}
const tx = p => ({ ...encodeRewardProgrammeAthletePaymentV3(p), type: "eip1559", gas: 500000n, maxFeePerGas: 20000000000n, maxPriorityFeePerGas: 100000000n });

test("V3 athlete payments preserve six factory slots, v4 proofs and separate transaction/authorization nonces", async () => {
  for (let slot = 0; slot < 6; slot++) {
    const p = await fixture(slot), valid = await verifyRewardProgrammeAthletePaymentV3(p);
    assert.equal(valid.expectation.slot, slot); assert.equal(valid.claim.nonce, 7n); assert.equal(valid.nonce, 0n);
    const signed = await relayer.signTransaction(tx(p)), attempt = await verifySignedRewardProgrammeAthletePaymentV3(p, signed);
    assert.equal(attempt.protocolVersion, 3); assert.equal(attempt.schemaVersion, 3);
    assert.equal(attempt.transactionHash, keccak256(signed)); assert.equal(attempt.amount, 1n);
    assert.equal(attempt.pot, slot === 5 ? "league" : "race"); assert.equal(attempt.value, 0n);
    assert.equal(attempt.provenance.slot, slot); assert.equal(attempt.authorizationNonce, 7n);
    assert.equal(attempt.contractAddress, rewardProgrammeChildV3(p.expectation.programme, slot).context.verifyingContract.toLowerCase());
  }
});
test("V3 payment normalization rejects stale packages, changed award, wrong chain/slot and reused role keys", async () => {
  const p = await fixture();
  for (const mutate of [x => x.protocolVersion = 1, x => x.expectation.protocolVersion = 2, x => x.expectation.slot = 5,
    x => x.claim.amount++, x => x.claim.pot = "league", x => x.claim.allocationDigest = h(99), x => x.claim.recipient = funder.address,
    x => x.claim.entitlementId = h(99), x => x.expectation.upload.awards[0].amount++, x => x.expectation.programme.context.chainId = 143,
    x => x.expectation.programme.reviewPeriods[0] = 0n, x => x.claim.nonce = (1n << 256n) - 1n,
    x => x.nonce = -1n, x => x.nonce = BigInt(Number.MAX_SAFE_INTEGER) + 1n,
    x => x.relayerAddress = operator.address, x => x.relayerAddress = recipient.address, x => x.relayerAddress = funder.address,
    x => x.relayerAddress = x.expectation.programme.context.verifyingContract, x => x.proofs.recipient = "0x"])
    assert.throws(() => { const altered = structuredClone(p); mutate(altered); normalizeRewardProgrammeAthletePaymentV3(altered); });
});
test("v2/v3-domain, swapped and changed-message proofs cannot authorize a V3 programme payment", async () => {
  const p = await fixture(), context = rewardProgrammeChildV3(p.expectation.programme, 0).context;
  for (const version of ["2", "3"]) {
    const m = rewardClaimMessagesV3(context, p.claim), signature = await recipient.signTypedData({ ...m.consent, domain: { ...m.consent.domain, version } });
    await assert.rejects(verifyRewardProgrammeAthletePaymentV3({ ...p, proofs: { ...p.proofs, recipient: signature } }), { code: "reward_claim_signature_mismatch" });
  }
  for (const mutate of [x => x.proofs.recipient = x.proofs.operator, x => x.proofs.operator = x.proofs.recipient,
    x => x.claim.nonce++, x => x.claim.expiresAt--, x => x.proofs.recipient = `0x${"ff".repeat(65)}`]) {
    const altered = structuredClone(p); mutate(altered); await assert.rejects(verifyRewardProgrammeAthletePaymentV3(altered));
  }
});
test("V3 signed envelope rejects substitute sender, nonce, chain, calldata, value, access list and fees", async () => {
  const p = await fixture(), encoded = tx(p);
  await assert.rejects(verifySignedRewardProgrammeAthletePaymentV3(p, await operator.signTransaction(encoded)), { code: "reward_payment_sender_mismatch" });
  for (const patch of [{ chainId: 143 }, { nonce: 1 }, { to: funder.address }, { value: 1n }, { data: `${encoded.data}00` },
    { accessList: [{ address: funder.address, storageKeys: [] }] }, { gas: 0n }, { maxFeePerGas: 0n, maxPriorityFeePerGas: 0n }])
    await assert.rejects(verifySignedRewardProgrammeAthletePaymentV3(p, await relayer.signTransaction({ ...encoded, ...patch })));
  const signed = await relayer.signTransaction(encoded), parsed = parseTransaction(signed), order = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
  const highS = serializeTransaction({ ...parsed, s: toHex(order - BigInt(parsed.s), { size: 32 }), yParity: 1 - parsed.yParity });
  for (const bytes of [null, "0x", "0x02", `${signed}00`, `0x02${"aa".repeat(2049)}`, serializeTransaction(encoded), highS])
    await assert.rejects(verifySignedRewardProgrammeAthletePaymentV3(p, bytes));
});
test("canonical zero-tip transactions preserve a zero priority fee, never a zero max fee or gas limit", async () => {
  const p = await fixture(), encoded = { ...tx(p), maxPriorityFeePerGas: 0n };
  const bytes = await relayer.signTransaction(encoded), attempt = await verifySignedRewardProgrammeAthletePaymentV3(p, bytes);
  assert.equal(attempt.maxPriorityFeePerGas, 0n); assert.equal(attempt.signedTransaction, bytes);
  assert.equal(attempt.maxFeePerGas, encoded.maxFeePerGas); assert.equal(attempt.gasLimit, encoded.gas);
});
test("V3 verification captures all values before async recovery and refuses bad proofs before chain IO", async () => {
  const p = await fixture(), signed = await relayer.signTransaction(tx(p)), pending = verifySignedRewardProgrammeAthletePaymentV3(p, signed);
  p.claim.amount++; p.nonce = 9n; p.relayerAddress = funder.address; p.proofs.recipient = "0x";
  p.expectation.programme.context.chainId = 143; p.expectation.upload.awards[0].amount++;
  const result = await pending; assert.equal(result.chainId, 31337); assert.equal(result.nonce, 0n); assert.equal(result.amount, 1n);
  let calls = 0; const reader = { getChainId: async () => { calls++; throw Error("private-rpc-credential"); } }, bad = await fixture();
  bad.proofs.recipient = bad.proofs.operator;
  await assert.rejects(readRewardProgrammeAthletePaymentPreflightV3(reader, bad), { code: "reward_claim_signature_mismatch" }); assert.equal(calls, 0);
  await assert.rejects(readRewardProgrammeAthletePaymentPreflightV3(reader, await fixture()), e =>
    e.code === "reward_programme_observation_unavailable" && !JSON.stringify(e).includes("private-rpc-credential")); assert.equal(calls, 1);
});
