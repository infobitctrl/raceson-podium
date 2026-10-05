import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { encodeAbiParameters, hashTypedData, parseAbi } from "viem";
import { fixtureSigner, startOwnedRewardChain } from "./owned-chain.mjs";
import { encodeRewardClaim, requireLiveRewardClaim, rewardCampaignAbi, rewardClaimDigests, rewardClaimMessages, rewardPaymentFromReceipt, rewardUploadBatches, safeRewardConsentMessage } from "../dist/index.js";
import { bindingsFor, budgets, h, latestPublicationAt, leagueResult, proposalFor, roundIds, roundResult, totalBudget } from "../test/fixtures.mjs";
import { deploymentCases } from "./deployment-cases.mjs";
import { readVerifiedRewardDeployment, readVerifiedRewardCampaign, rewardCampaignFundingSummary } from "../dist/index.js";
import { campaignCheckpointCases } from "./campaign-checkpoint-cases.mjs";
import { deploymentWorkerCases } from "./deployment-worker-cases.mjs";
import { readVerifiedRewardClubSafeDeployment, verifyRewardClubSafeConsent } from "../dist/index.js";
import { deployOriginalClubSafeFixture } from "./safe-deployment-fixture.mjs";
import { clubClaimCases } from "./club-claim-cases.mjs";
import { readVerifiedRewardClubClaim } from "../dist/index.js";

const athlete = fixtureSigner(0xB0B);
let harness, artifact, operator, relayer, clubOwners, treasury, publicClient, testClient, operatorClient, relayerClient;
before(async () => {
  harness = await startOwnedRewardChain();
  ({ artifact, operator, relayer, clubOwners, treasury, publicClient, testClient, operatorClient, relayerClient } = harness);
}, { timeout: 20_000 });
after(async () => { await harness?.stop(); });

const contextFor = (address) => ({ environment: "local-simulation", chainId: 31337, verifyingContract: address });
async function receipt(hash) {
  const result = await publicClient.waitForTransactionReceipt({ hash, timeout: 10_000 });
  assert.equal(result.status, "success");
  return result;
}
async function read(address, functionName, args) {
  return publicClient.readContract({ address, abi: rewardCampaignAbi, functionName, args });
}
async function write(address, functionName, args, value) {
  return receipt(await operatorClient.writeContract({ address, abi: rewardCampaignAbi, functionName, args, value }));
}
async function deploy(abi, bytecode, args) {
  const tx = await receipt(await operatorClient.deployContract({ abi, bytecode, args }));
  assert(tx.contractAddress); return tx.contractAddress;
}
async function stage(campaign) {
  const { proposal, address } = campaign;
  for (const batch of rewardUploadBatches(proposal.awards, 2)) await write(address, "uploadAwards", [batch]);
  assert.equal(await read(address, "uploadDigest"), proposal.uploadDigest);
  await write(address, "stageAllocation", [proposal.snapshotDigest, proposal.uploadDigest, proposal.entitlementCount, latestPublicationAt]);
  assert.equal(await read(address, "allocationDigest"), proposal.allocationDigest);
}
async function activate(campaigns) {
  const times = await Promise.all(campaigns.map((campaign) => read(campaign.address, "activationNotBefore")));
  const ready = times.reduce((max, value) => value > max ? value : max, 0n);
  const current = await publicClient.getBlock();
  if (ready >= current.timestamp) await testClient.setNextBlockTimestamp({ timestamp: ready });
  await testClient.mine({ blocks: 1 });
  for (const campaign of campaigns) await write(campaign.address, "activate", [campaign.proposal.allocationDigest, campaign.proposal.snapshotDigest]);
}
async function claimFor(campaign, beneficiary, destination) {
  const binding = campaign.bindings.find((row) => row.beneficiaryId === beneficiary);
  assert(binding);
  const state = await read(campaign.address, "entitlements", [binding.entitlementId]);
  assert.equal(state[6], false);
  const now = (await publicClient.getBlock()).timestamp;
  return { entitlementId: binding.entitlementId, recipient: destination, amount: state[1], pot: state[5] === 0 ? "race" : "league",
    nonce: state[3], issuedAt: now, expiresAt: now + 3600n, allocationDigest: campaign.proposal.allocationDigest };
}
async function assertDigestsMatch(campaign, claim) {
  const generated = rewardClaimDigests(contextFor(campaign.address), claim);
  const contract = await read(campaign.address, "claimDigests", [claim.entitlementId, claim.recipient, claim.nonce, claim.issuedAt, claim.expiresAt]);
  assert.deepEqual(contract, [generated.authorization, generated.consent]);
}
async function relay(campaign, claim, recipientProof) {
  const context = contextFor(campaign.address);
  requireLiveRewardClaim(context, claim, (await publicClient.getBlock()).timestamp, await read(campaign.address, "claimDeadline"));
  const operatorProof = await operator.signTypedData(rewardClaimMessages(context, claim).authorization);
  const data = encodeRewardClaim(context, claim, { operator: operatorProof, recipient: recipientProof });
  const tx = await receipt(await relayerClient.sendTransaction({ to: campaign.address, data }));
  await testClient.mine({ blocks: 64, interval: 1 });
  const block = await publicClient.getBlock({ blockNumber: tx.blockNumber });
  const finalized = await publicClient.getBlock({ blockTag: "finalized" });
  return rewardPaymentFromReceipt(context, claim, tx.transactionHash, { receipt: tx, observedChainId: await publicClient.getChainId(),
    canonicalBlockHash: block.hash, finalizedBlockNumber: finalized.number });
}

test("TypeScript protocol ABI agrees with the compiled reward contract", () => {
  const parameter = ({ type, components, indexed }) => ({ type, ...(components ? { components: components.map(parameter) } : {}), indexed: indexed ?? false });
  const shape = (item) => ({ type: item.type, name: item.name, stateMutability: item.stateMutability,
    inputs: item.inputs?.map(parameter), outputs: item.outputs?.map(parameter), anonymous: item.anonymous ?? false });
  for (const item of rewardCampaignAbi) {
    const compiled = artifact.abi.find((candidate) => candidate.type === item.type && candidate.name === item.name);
    assert(compiled, `Missing ${item.type} ${item.name}`);
    assert.deepEqual(shape(item), shape(compiled));
  }
});

test("pinned deployment verification and finalized worker observations", { timeout: 60_000 }, async (t) => {
  await deploymentCases({ t, artifact, publicClient, testClient, operatorClient, operator, relayer, treasury, receipt });
});

test("six-campaign programme settles historical and later waves with late athlete/Safe destinations", { timeout: 90_000 }, async (t) => {
  const results = [...roundIds.map(roundResult), leagueResult()];
  const campaigns = [];
  await t.test("fund six isolated campaigns and freeze the 60/40 budgets", async () => {
    for (const result of results) {
      const proposal = proposalFor(result);
      const deploymentReceipt = await receipt(await operatorClient.deployContract({ abi: rewardCampaignAbi, bytecode: artifact.bytecode.object,
        args: [operator.address, treasury, proposal.programmeId, proposal.campaignId, proposal.programmeManifestHash, proposal.enabledPot] }));
      const address = deploymentReceipt.contractAddress;
      assert(address);
      const deploymentTx = await publicClient.getTransaction({ hash: deploymentReceipt.transactionHash });
      await testClient.mine({ blocks: 64, interval: 1 });
      const deployment = await readVerifiedRewardDeployment(publicClient, { context: contextFor(address), operatorAddress: operator.address, treasuryAddress: treasury,
        programmeId: proposal.programmeId, campaignId: proposal.campaignId, programmeManifestHash: proposal.programmeManifestHash, enabledPot: proposal.enabledPot,
        deploymentTransactionHash: deploymentReceipt.transactionHash, deploymentNonce: BigInt(deploymentTx.nonce) }, artifact.bytecode.object);
      assert.equal(deployment.context.verifyingContract.toLowerCase(), address.toLowerCase());
      await write(address, "completeFunding", [0n, result.budgetWei], result.budgetWei);
      campaigns.push({ address, proposal, result, bindings: bindingsFor(result), paid: 0n, deployment });
    }
    assert.equal(new Set(campaigns.map((row) => row.address)).size, 6);
    const funding = await Promise.all(campaigns.map((row) => read(row.address, "accountedFunding")));
    assert.equal(funding.reduce((sum, value) => sum + value, 0n), totalBudget);
    assert.equal(funding.slice(0, 4).reduce((sum, value) => sum + value, 0n), 48n * 10n ** 18n);
    assert.equal(funding[4], 12n * 10n ** 18n);
    assert.equal(funding[5], budgets.leagueBudget);
  });

  await t.test("four historical allocations activate while future-wave vaults remain reserved", async () => {
    assert.equal(campaigns.length, 6, "All six verified deployments must exist before the historical-wave checks");
    for (const campaign of campaigns.slice(0, 4)) await stage(campaign);
    await activate(campaigns.slice(0, 4));
    for (const campaign of campaigns.slice(0, 4)) assert.equal(await read(campaign.address, "state"), 3);
    for (const campaign of campaigns.slice(4)) {
      assert.equal(await read(campaign.address, "state"), 1);
      assert.equal(await publicClient.getBalance({ address: campaign.address }), campaign.result.budgetWei);
    }
  });

  await t.test("same late-claimed athlete receives only their fixed award from each historical round", async () => {
    let expected = 0n;
    assert.equal(await publicClient.getBalance({ address: athlete.address }), 0n);
    for (const campaign of campaigns.slice(0, 4)) {
      const claim = await claimFor(campaign, "private-athlete-a", athlete.address);
      await assertDigestsMatch(campaign, claim);
      const consent = await athlete.signTypedData(rewardClaimMessages(contextFor(campaign.address), claim).consent);
      const payment = await relay(campaign, claim, consent);
      assert.equal(payment.amount, claim.amount);
      assert.equal(payment.recipient, athlete.address);
      campaign.paid += payment.amount; expected += payment.amount;
      const state = await read(campaign.address, "entitlements", [claim.entitlementId]);
      assert.equal(state[3], 1n); assert.equal(state[4], athlete.address); assert.equal(state[6], true);
      const proof = await operator.signTypedData(rewardClaimMessages(contextFor(campaign.address), claim).authorization);
      await assert.rejects(publicClient.call({ account: relayer.address, to: campaign.address, data: encodeRewardClaim(contextFor(campaign.address), claim, { operator: proof, recipient: consent }) }));
    }
    assert.equal(await publicClient.getBalance({ address: athlete.address }), expected);
  });

  let clubSafe, clubSafeExpected, clubSafeProvenance, clubClaimInput;
  const safeReadAbi = parseAbi([
    "function getThreshold() view returns (uint256)", "function getOwners() view returns (address[])",
    "function getMessageHash(bytes message) view returns (bytes32)",
    "function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)",
  ]);
  await t.test("original 2-of-3 Safe receives a club award using TypeScript-generated SafeMessage consent", async clubTest => {
    const created = await deployOriginalClubSafeFixture(harness);
    clubSafeExpected = created.expected; clubSafeProvenance = created.provenance; clubSafe = created.expected.context.verifyingContract;
    assert.equal(await publicClient.readContract({ address: clubSafe, abi: safeReadAbi, functionName: "getThreshold" }), 2n);
    const campaign = campaigns[0];
    const claim = await claimFor(campaign, "private-club-one", clubSafe);
    const safeMessage = safeRewardConsentMessage(contextFor(campaign.address), claim);
    const wrapped = await publicClient.readContract({ address: clubSafe, abi: safeReadAbi, functionName: "getMessageHash", args: [safeMessage.message.message] });
    assert.equal(hashTypedData(safeMessage), wrapped);
    const signers = clubOwners.slice(0, 2).sort((a, b) => a.address.toLowerCase().localeCompare(b.address.toLowerCase()));
    const proofs = await Promise.all(signers.map((signer) => signer.signTypedData(safeMessage)));
    const signature = `0x${proofs.map((proof) => proof.slice(2)).join("")}`;
    await testClient.mine({ blocks: 96, interval: 1 });
    const deployment = await readVerifiedRewardClubSafeDeployment(publicClient, clubSafeProvenance), safeObserved = deployment.safe;
    // The local fixture supplies synthetic representatives. This is not a
    // persistent treasury approval or an execution-history review for real clubs.
    assert.equal(deployment.executionHistoryReviewRequired, true);
    clubClaimInput = await clubClaimCases({ t: clubTest, chain: harness, campaign, created, claim });
    const consent = await verifyRewardClubSafeConsent(publicClient, { safe: clubSafeExpected, campaignContext: contextFor(campaign.address), claim, signature, checkpoint: safeObserved.finalizedBlock });
    assert.equal(consent.signature, signature.toLowerCase());
    assert.equal(await publicClient.readContract({ address: clubSafe, abi: safeReadAbi, functionName: "isValidSignature", args: [rewardClaimDigests(contextFor(campaign.address), claim).consent, signature] }), "0x1626ba7e");
    campaign.paid += (await relay(campaign, claim, signature)).amount;
    assert.equal(await publicClient.getBalance({ address: clubSafe }), claim.amount);
    await assert.rejects(readVerifiedRewardClubClaim(publicClient, clubClaimInput, artifact.bytecode.object), { code: "reward_claim_already_paid" });
  });

  await t.test("later round-5/league allocations activate independently and pay a returning athlete and club", async () => {
    for (const campaign of campaigns.slice(4)) await stage(campaign);
    await activate(campaigns.slice(4));
    for (const campaign of campaigns.slice(4)) {
      const claim = await claimFor(campaign, "private-athlete-a", athlete.address);
      await assertDigestsMatch(campaign, claim);
      const consent = await athlete.signTypedData(rewardClaimMessages(contextFor(campaign.address), claim).consent);
      campaign.paid += (await relay(campaign, claim, consent)).amount;
    }
    const league = campaigns[5];
    const claim = await claimFor(league, "private-club-one", clubSafe);
    const safeMessage = safeRewardConsentMessage(contextFor(league.address), claim);
    const signers = clubOwners.slice(0, 2).sort((a, b) => a.address.toLowerCase().localeCompare(b.address.toLowerCase()));
    const proofs = await Promise.all(signers.map((signer) => signer.signTypedData(safeMessage)));
    const signature = `0x${proofs.map((proof) => proof.slice(2)).join("")}`;
    await testClient.mine({ blocks: 96, interval: 1 });
    const deployment = await readVerifiedRewardClubSafeDeployment(publicClient, clubSafeProvenance);
    assert.equal(deployment.executionHistoryReviewRequired, true);
    const leagueInput = { ...clubClaimInput, deployment: league.deployment, upload: league.proposal, entitlementId: claim.entitlementId };
    const clubAward = await readVerifiedRewardClubClaim(publicClient, leagueInput, artifact.bytecode.object);
    assert.equal(clubAward.award.beneficiaryKind, 1); assert.equal(clubAward.award.pot, 1);
    assert.equal(clubAward.award.amount, claim.amount); assert.equal(clubAward.treasury.executionNonce, 0n);
    const consent = await verifyRewardClubSafeConsent(publicClient, { safe: clubSafeExpected, campaignContext: contextFor(league.address), claim, signature,
      checkpoint: deployment.safe.finalizedBlock });
    assert.equal(consent.signature, signature.toLowerCase());
    league.paid += (await relay(league, claim, consent.signature)).amount;
    await assert.rejects(readVerifiedRewardClubClaim(publicClient, leagueInput, artifact.bytecode.object), { code: "reward_claim_already_paid" });
  });

  await t.test("all other unclaimed profiles and ownerless club shares remain covered in every vault", async () => {
    for (const campaign of campaigns) {
      const checkpoint=await readVerifiedRewardCampaign(publicClient,campaign.deployment,artifact.bytecode.object);
      const funding=rewardCampaignFundingSummary(checkpoint.observation.accounting,campaign.proposal.enabledPot,campaign.result.budgetWei);
      assert.equal(funding.fixedBudgetMatches,true); assert.equal(funding.remainingAccounted,campaign.result.budgetWei-campaign.paid);
      assert.equal(checkpoint.observation.accounting.paid[campaign.proposal.enabledPot],campaign.paid);
      assert.equal(await read(campaign.address, "paid", [campaign.proposal.enabledPot]), campaign.paid);
      assert.equal(await publicClient.getBalance({ address: campaign.address }), campaign.result.budgetWei - campaign.paid);
      for (const beneficiary of ["private-athlete-b", "private-athlete-c", "private-club-two"]) {
        const binding = campaign.bindings.find((row) => row.beneficiaryId === beneficiary);
        const state = await read(campaign.address, "entitlements", [binding.entitlementId]);
        assert(state[1] > 0n); assert.equal(state[4], "0x0000000000000000000000000000000000000000"); assert.equal(state[6], false);
      }
    }
  });
});

test("campaign deployment registry service and finalized funding accounting",{timeout:60000},async(t)=>{
  await campaignCheckpointCases({t,artifact,publicClient,testClient,operatorClient,operator,treasury,receipt});
});

test("durable deployment worker recovers uncertain broadcasts against the real local chain",{timeout:60000},async(t)=>{
  await deploymentWorkerCases({t,artifact,publicClient,testClient,operatorClient,operator,treasury});
});
