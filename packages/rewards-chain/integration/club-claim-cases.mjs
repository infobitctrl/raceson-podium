import assert from "node:assert/strict";
import { encodeFunctionData, zeroAddress } from "viem";
import { readVerifiedRewardAthleteClaim, readVerifiedRewardClubClaim, readVerifiedRewardClubSafeDeployment } from "../dist/index.js";
import { h } from "../test/fixtures.mjs";

// Composes actual campaign and original Safe reads on the caller's owned chain.
// All identities/signatures here are explicitly synthetic, not a private review.
export async function clubClaimCases({ t, chain, campaign, created, claim }) {
  const { publicClient: reader, testClient, artifact } = chain;
  const provenance = await readVerifiedRewardClubSafeDeployment(reader, created.provenance);
  const input = { deployment: campaign.deployment, upload: campaign.proposal, entitlementId: claim.entitlementId,
    recipient: claim.recipient, treasury: created.provenance,
    review: { reviewedBlock: provenance.safe.finalizedBlock, deploymentBlock: provenance.deploymentBlock, initializerHash: provenance.initializerHash } };
  await testClient.mine({ blocks: 96, interval: 1 });
  const read = (expected = input, client = reader) => readVerifiedRewardClubClaim(client, expected, artifact.bytecode.object);
  await t.test("same-block unpaid club award, complete package and exact reviewed Safe; no transaction", async () => {
    const before = await reader.getTransactionCount({ address: chain.operator.address });
    const witness = await read();
    assert.equal(witness.award.beneficiaryKind, 1); assert.equal(witness.award.amount, claim.amount);
    assert.equal(witness.award.nonce, claim.nonce); assert.equal(witness.award.paid, false);
    assert.deepEqual(witness.treasury.finalizedBlock, witness.observation.finalizedBlock);
    assert.deepEqual(witness.treasury.reviewedBlock, input.review.reviewedBlock);
    assert.equal(witness.treasury.executionNonce, 0n);
    assert.equal(witness.treasury.executionHistoryReviewRequired, true);
    assert.equal(await reader.getTransactionCount({ address: chain.operator.address }), before);
    await assert.rejects(readVerifiedRewardAthleteClaim(reader, input, artifact.bytecode.object), { code: "reward_athlete_claim_required" });
  });
  await t.test("copied club expectations survive caller edits; athlete recipients still require EOAs", async () => {
    const mutable = structuredClone(input), pending = read(mutable);
    mutable.review.reviewedBlock.hash = h("caller edit"); mutable.treasury.safe.owners[0] = chain.treasury;
    mutable.recipient = chain.treasury; mutable.upload.awards[0].amount++;
    assert.equal((await pending).recipient, input.recipient.toLowerCase());
    const binding = campaign.bindings.find(row => row.beneficiaryId === "private-athlete-b");
    const athleteInput = { ...input, entitlementId: binding.entitlementId, recipient: chain.treasury };
    const observed = await readVerifiedRewardAthleteClaim(reader, athleteInput, artifact.bytecode.object);
    assert.equal(observed.award.beneficiaryKind, 0); assert.equal(observed.award.paid, false);
    await assert.rejects(readVerifiedRewardAthleteClaim(reader, { ...athleteInput, recipient: input.recipient }, artifact.bytecode.object),
      { code: "reward_claim_eoa_recipient_required" });
  });
  await t.test("rejects a different original setup or review block and unavailable private provider evidence", async () => {
    const changed = structuredClone(input); changed.review.initializerHash = h("not reviewed setup");
    await assert.rejects(read(changed), { code: "reward_club_review_chain_evidence_mismatch" });
    changed.review = structuredClone(input.review); changed.review.reviewedBlock.hash = h("wrong review fork");
    await assert.rejects(read(changed));
    const broken = { ...reader, readContract: async args => {
      if (args.functionName === "nonce") throw new Error("private RPC diagnostic");
      return reader.readContract(args);
    } };
    await assert.rejects(read(input, broken), e => e.code === "reward_club_claim_observation_unavailable" && !String(e).includes("diagnostic"));
  });
  await t.test("rejects wrong award kind, paid marker, operator code and final review-block drift", async () => {
    for (const [index, value, code] of [[7, 0, "reward_claim_award_mismatch"], [6, true, "reward_claim_already_paid"]]) {
      const client = { ...reader, readContract: async args => { const row = await reader.readContract(args);
        if (args.functionName === "entitlements") { const changed = [...row]; changed[index] = value; return changed; } return row; } };
      await assert.rejects(read(input, client), { code });
    }
    await assert.rejects(read(input, { ...reader, getCode: args => args.address.toLowerCase() === chain.operator.address.toLowerCase()
      ? Promise.resolve("0x01") : reader.getCode(args) }), { code: "reward_claim_eoa_operator_required" });
    let reviewedReads = 0;
    const drift = { ...reader, getBlock: async args => { const b = await reader.getBlock(args);
      return args.blockNumber === input.review.reviewedBlock.number && ++reviewedReads === 2 ? { ...b, hash: h("late review fork") } : b; } };
    await assert.rejects(read(input, drift), { code: "reward_chain_changed_during_observation" });
    assert.equal(reviewedReads, 2, "drift occurs at the composed reader's final review-anchor recheck");
  });
  await t.test("an actual quorum execution preserving 2-of-3 still requires a fresh history review", async () => {
    const snapshot = await testClient.snapshot();
    try {
      const address = input.recipient, abi = created.artifacts.singleton.abi;
      const data = encodeFunctionData({ abi, functionName: "changeThreshold", args: [2n] });
      const message = { to: address, value: 0n, data, operation: 0, safeTxGas: 0n, baseGas: 0n, gasPrice: 0n,
        gasToken: zeroAddress, refundReceiver: zeroAddress, nonce: 0n };
      const typed = { domain: { chainId: 31337, verifyingContract: address }, primaryType: "SafeTx", message, types: { SafeTx: [
        { name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "data", type: "bytes" }, { name: "operation", type: "uint8" },
        { name: "safeTxGas", type: "uint256" }, { name: "baseGas", type: "uint256" }, { name: "gasPrice", type: "uint256" },
        { name: "gasToken", type: "address" }, { name: "refundReceiver", type: "address" }, { name: "nonce", type: "uint256" },
      ] } };
      const owners = chain.clubOwners.slice(0, 2).sort((a, b) => a.address.toLowerCase().localeCompare(b.address.toLowerCase()));
      const signature = `0x${(await Promise.all(owners.map(o => o.signTypedData(typed)))).map(s => s.slice(2)).join("")}`;
      const hash = await chain.operatorClient.writeContract({ address, abi, functionName: "execTransaction",
        args: [address, 0n, data, 0, 0n, 0n, 0n, zeroAddress, zeroAddress, signature] });
      assert.equal((await reader.waitForTransactionReceipt({ hash, timeout: 10000 })).status, "success");
      await testClient.mine({ blocks: 96, interval: 1 });
      await assert.rejects(read(), { code: "reward_club_execution_changed_since_review" });
      const fresh = await readVerifiedRewardClubSafeDeployment(reader, created.provenance);
      const renewed = await read({ ...input, review: { ...input.review, reviewedBlock: fresh.safe.finalizedBlock } });
      assert.equal(renewed.treasury.executionNonce, 1n); assert.equal(renewed.treasury.executionHistoryReviewRequired, true);
    } finally { await testClient.revert({ id: snapshot }); }
    assert.equal((await read()).treasury.executionNonce, 0n);
  });
  return input;
}
