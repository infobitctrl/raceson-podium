import assert from "node:assert/strict";
import test from "node:test";
import { toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { rewardClaimMessagesV2, rewardClaimDigestsV2, verifyRewardClaimEoaProofV2 } from "../dist/campaign-v2.js";
import { rewardClaimMessages } from "../dist/claims.js";
import { verifyRewardClaimEoaProof } from "../dist/claim-reader.js";

// Public synthetic test identities only; never funded on a public network.
const operator = privateKeyToAccount(toHex(0xA11CEn, { size: 32 }));
const athlete = privateKeyToAccount(toHex(993n, { size: 32 }));
const other = privateKeyToAccount(toHex(994n, { size: 32 }));
function fixture() {
  return { context: { environment: "monad-testnet", chainId: 10143, verifyingContract: other.address },
    claim: { entitlementId: toHex(10n, { size: 32 }), recipient: athlete.address, amount: 100000000000000001n,
      pot: "race", nonce: 7n, issuedAt: 1801000000n, expiresAt: 1801003600n, allocationDigest: toHex(11n, { size: 32 }) } };
}
test("V2 verifies exact role-specific EOA proofs with an explicit protocol tag and no provider", async () => {
  const { context, claim } = fixture(), messages = rewardClaimMessagesV2(context, claim), digests = rewardClaimDigestsV2(context, claim);
  for (const [role, signer, message, digest] of [["operator", operator, messages.authorization, digests.authorization],
    ["recipient", athlete, messages.consent, digests.consent]]) {
    const signature = await signer.signTypedData(message);
    const result = await verifyRewardClaimEoaProofV2(context, claim, role, operator.address, signature);
    assert.deepEqual(result, { protocolVersion: 2, role, signer: signer.address.toLowerCase(), digest, signature });
  }
});
test("V1 and V2 proofs are rejected across protocols, even for the same signer, contract and claim", async () => {
  const { context, claim } = fixture(), old = rewardClaimMessages(context, claim), current = rewardClaimMessagesV2(context, claim);
  for (const [role, signer, key] of [["operator", operator, "authorization"], ["recipient", athlete, "consent"]]) {
    await assert.rejects(verifyRewardClaimEoaProofV2(context, claim, role, operator.address, await signer.signTypedData(old[key])),
      { code: "reward_claim_signature_mismatch" });
    await assert.rejects(verifyRewardClaimEoaProof(context, claim, role, operator.address, await signer.signTypedData(current[key])),
      { code: "reward_claim_signature_mismatch" });
  }
});
test("V2 cannot exchange recipient consent and operator approval or accept another signer", async () => {
  const { context, claim } = fixture(), messages = rewardClaimMessagesV2(context, claim);
  const consent = await athlete.signTypedData(messages.consent), approval = await operator.signTypedData(messages.authorization);
  for (const [role, signature] of [["operator", consent], ["recipient", approval],
    ["recipient", await athlete.signTypedData(messages.authorization)], ["operator", await operator.signTypedData(messages.consent)],
    ["recipient", await other.signTypedData(messages.consent)], ["operator", await other.signTypedData(messages.authorization)]])
    await assert.rejects(verifyRewardClaimEoaProofV2(context, claim, role, operator.address, signature), { code: "reward_claim_signature_mismatch" });
  await assert.rejects(verifyRewardClaimEoaProofV2(context, claim, "treasury", operator.address, approval), { code: "invalid_reward_claim_proof_role" });
});
test("V2 recipient proof binds every award, destination, amount, pool, lifetime and deployment field", async () => {
  const { context, claim } = fixture(), signature = await athlete.signTypedData(rewardClaimMessagesV2(context, claim).consent);
  for (const patch of [{ amount: claim.amount + 1n }, { pot: "league" }, { nonce: 8n }, { recipient: other.address },
    { issuedAt: claim.issuedAt + 1n }, { expiresAt: claim.expiresAt - 1n },
    { entitlementId: toHex(12n, { size: 32 }) }, { allocationDigest: toHex(12n, { size: 32 }) }])
    await assert.rejects(verifyRewardClaimEoaProofV2(context, { ...claim, ...patch }, "recipient", operator.address, signature),
      { code: "reward_claim_signature_mismatch" });
  for (const patch of [{ verifyingContract: operator.address }, { chainId: 31337, environment: "local-simulation" }])
    await assert.rejects(verifyRewardClaimEoaProofV2({ ...context, ...patch }, claim, "recipient", operator.address, signature),
      { code: "reward_claim_signature_mismatch" });
  await assert.rejects(verifyRewardClaimEoaProofV2({ ...context, chainId: 143 }, claim, "recipient", operator.address, signature));
  await assert.rejects(verifyRewardClaimEoaProofV2(context, { ...claim, amount: 0n }, "recipient", operator.address, signature));
});
test("V2 rejects malformed, compact, zero-S, high-S and wrong recovery IDs without leaking crypto errors", async () => {
  const { context, claim } = fixture(), signature = await athlete.signTypedData(rewardClaimMessagesV2(context, claim).consent);
  const order = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
  const highS = `${signature.slice(0, 66)}${(order - BigInt(`0x${signature.slice(66, 130)}`)).toString(16).padStart(64, "0")}${signature.endsWith("1b") ? "1c" : "1b"}`;
  for (const invalid of [null, "0x", `${signature}00`, signature.slice(0, -2), `${signature.slice(0, -2)}00`,
    `${signature.slice(0, 66)}${"0".repeat(64)}1b`, highS, `0x${"0".repeat(64)}${"0".repeat(63)}11b`])
    await assert.rejects(verifyRewardClaimEoaProofV2(context, claim, "recipient", operator.address, invalid),
      error => error.code === "invalid_reward_claim_signature" && error.cause === undefined);
});
test("V2 captures inputs before asynchronous recovery and normalizes signature hex without changing its digest", async () => {
  const { context, claim } = fixture(), messages = rewardClaimMessagesV2(context, claim);
  const signature = await athlete.signTypedData(messages.consent), digest = rewardClaimDigestsV2(context, claim).consent;
  const pending = verifyRewardClaimEoaProofV2(context, claim, "recipient", operator.address, `0x${signature.slice(2).toUpperCase()}`);
  context.chainId = 143; claim.recipient = other.address; claim.amount++;
  assert.deepEqual(await pending, { protocolVersion: 2, role: "recipient", signer: athlete.address.toLowerCase(), digest, signature });
});
