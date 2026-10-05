import assert from "node:assert/strict";
import test from "node:test";
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, hashTypedData } from "viem";
import {
  RewardProtocolError, canonicalRewardJson, commitPrivateRewardDocument, encodeRewardClaim, hashPublicRewardRules,
  prepareRewardCampaignUpload, requireLiveRewardClaim, rewardAllocationCommitment, rewardCampaignAbi, rewardChainContext,
  rewardClaimDigests, rewardClaimMessages, rewardPaymentFromReceipt, rewardUploadBatches, rewardUploadDigest, safeRewardConsentMessage,
} from "../dist/index.js";
import { bindingsFor, commitmentInput, h, leagueResult, proposalFor, roundResult } from "./fixtures.mjs";

const zeroHash = `0x${"0".repeat(64)}`;
const address = "0x0000000000000000000000000000000000000123";
const recipient = "0x0000000000000000000000000000000000000456";
const context = { environment: "local-simulation", chainId: 31337, verifyingContract: address };
const claim = () => ({ entitlementId: h("entitlement"), recipient, amount: 15n, pot: "race", nonce: 0n,
  issuedAt: 1000n, expiresAt: 2000n, allocationDigest: h("allocation") });
const fails = (code, fn) => assert.throws(fn, (error) => error instanceof RewardProtocolError && error.code === code);

test("canonical reward JSON preserves exact amounts and deterministic object order", () => {
  const expected = '{"amount":"100000000000000000000000000001","nested":{"a":null,"b":true},"rank":1}';
  assert.equal(canonicalRewardJson({ rank: 1, nested: { b: true, a: null }, amount: 100000000000000000000000000001n }), expected);
  assert.equal(canonicalRewardJson(JSON.parse(expected)), expected);
  assert.notEqual(canonicalRewardJson([1, 2]), canonicalRewardJson([2, 1]));
});

test("canonical persistence rejects silent omissions, unsafe values and executable serializers", () => {
  for (const input of [undefined, () => {}, { value: undefined }]) fails("unsupported_reward_json_value", () => canonicalRewardJson(input));
  for (const input of [NaN, Infinity, 1.1, Number.MAX_SAFE_INTEGER + 1, -0]) fails("unsafe_reward_json_number", () => canonicalRewardJson(input));
  for (const input of [new Date(), new Map(), new Set()]) fails("unsupported_reward_json_object", () => canonicalRewardJson(input));
  let executed = false;
  const accessor = { get value() { executed = true; return 1; } };
  fails("unsupported_reward_json_property", () => canonicalRewardJson(accessor));
  assert.equal(executed, false);
  const cyclic = {}; cyclic.self = cyclic;
  fails("cyclic_reward_document", () => canonicalRewardJson(cyclic));
  fails("invalid_reward_json_array", () => canonicalRewardJson(new Array(2)));
  const extra = [1]; extra.extra = 2;
  fails("invalid_reward_json_array", () => canonicalRewardJson(extra));
});

test("private commitments are salted and purpose separated; rules have deterministic public hash", () => {
  const document = { athlete: "private-person", amount: 15n };
  assert.notEqual(commitPrivateRewardDocument("explanation", document, h("salt1")), commitPrivateRewardDocument("explanation", document, h("salt2")));
  assert.notEqual(commitPrivateRewardDocument("explanation", document, h("salt1")), commitPrivateRewardDocument("snapshot", document, h("salt1")));
  fails("zero_reward_identifier", () => commitPrivateRewardDocument("explanation", document, zeroHash));
  assert.equal(hashPublicRewardRules({ b: 2, a: 1 }), hashPublicRewardRules({ a: 1, b: 2 }));
});

test("chain modes reject mainnet and ambiguous local/testnet configurations", () => {
  assert.equal(rewardChainContext(context).chainId, 31337);
  assert.equal(rewardChainContext({ ...context, chainId: 10143, environment: "monad-testnet" }).chainId, 10143);
  for (const chainId of [143, 1, 10143, "31337"]) fails("unsupported_reward_chain", () => rewardChainContext({ ...context, chainId }));
  fails("zero_reward_address", () => rewardChainContext({ ...context, verifyingContract: `0x${"0".repeat(40)}` }));
});

test("reviewed domain results convert to public-only sorted uploads without wallets", () => {
  const result = roundResult();
  const bindings = bindingsFor(result);
  const proposal = prepareRewardCampaignUpload(result, commitmentInput(result), bindings);
  assert.deepEqual(proposal, prepareRewardCampaignUpload(result, commitmentInput(result), [...bindings].reverse()));
  assert.equal(proposal.allocated[0] + proposal.unallocated, result.budgetWei);
  assert.equal(proposal.allocated[1], 0n);
  const encoded = canonicalRewardJson(proposal);
  assert(!encoded.includes("private-"));
  assert(!encoded.includes("explanationSalt"));
  assert(!encoded.includes("recipient"));
  assert.equal(proposal.awards.filter((row) => row.beneficiaryKind === 1).length, 2);
  assert(proposal.awards.every((row, i) => i === 0 || row.entitlementId > proposal.awards[i - 1].entitlementId));
});

test("missing/extra/reused private identity assignments cannot silently change beneficiaries", () => {
  const result = roundResult(); const input = commitmentInput(result); const bindings = bindingsFor(result);
  fails("reward_binding_set_mismatch", () => prepareRewardCampaignUpload(result, input, bindings.slice(1)));
  const duplicate = structuredClone(bindings); duplicate[1] = duplicate[0];
  fails("duplicate_reward_private_binding", () => prepareRewardCampaignUpload(result, input, duplicate));
  const reused = structuredClone(bindings); reused[1].explanationSalt = reused[0].explanationSalt;
  fails("reused_reward_explanation_salt", () => prepareRewardCampaignUpload(result, input, reused));
  const collided = structuredClone(bindings); collided[1].opaqueBeneficiaryId = collided[0].opaqueBeneficiaryId;
  fails("duplicate_opaque_beneficiary", () => prepareRewardCampaignUpload(result, input, collided));
});

test("rolling uploads reject wrong order, duplicate IDs, mixed pots and excess budgets", () => {
  const proposal = proposalFor(); const { awards } = proposal;
  fails("reward_upload_order_or_duplicate", () => rewardUploadDigest([...awards].reverse(), 0, proposal.budgets[0]));
  fails("reward_upload_order_or_duplicate", () => rewardUploadDigest([awards[0], awards[0]], 0, proposal.budgets[0]));
  fails("mixed_reward_pots", () => rewardUploadDigest(awards, 1, proposal.budgets[0]));
  fails("reward_upload_over_budget", () => rewardUploadDigest(awards, 0, 0n));
  assert.deepEqual(rewardUploadBatches(awards, 2).flat(), awards);
  fails("invalid_reward_upload_batch_size", () => rewardUploadBatches(awards, 65));
  assert.equal(rewardUploadDigest([], 0, 12n).digest, zeroHash);
});

test("every approved allocation field changes the committed digest", () => {
  const result = roundResult(); const proposal = proposalFor(result);
  const input = { ...commitmentInput(result), awards: proposal.awards, enabledPot: 0, budget: result.budgetWei };
  for (const key of ["programmeId", "campaignId", "programmeManifestHash", "snapshotDigest"]) {
    assert.notEqual(rewardAllocationCommitment({ ...input, [key]: h("different") }).allocationDigest, proposal.allocationDigest);
  }
  assert.notEqual(rewardAllocationCommitment({ ...input, latestPublicationAt: input.latestPublicationAt + 1n }).allocationDigest, proposal.allocationDigest);
  assert.notEqual(rewardAllocationCommitment({ ...input, budget: input.budget + 1n }).allocationDigest, proposal.allocationDigest);
  const league = proposalFor(leagueResult()); assert.equal(league.enabledPot, 1); assert.equal(league.allocated[0], 0n);
});

test("claim message fields match v2 and the calldata cannot change the stored amount", () => {
  const input = claim(); const messages = rewardClaimMessages(context, input);
  assert.equal(messages.authorization.domain.version, "2");
  assert.equal(messages.consent.message.amount, input.amount);
  assert.equal(messages.consent.message.pot, 0);
  assert(!("amount" in messages.authorization.message));
  assert.notEqual(hashTypedData(messages.authorization), hashTypedData(messages.consent));
  const data = encodeRewardClaim(context, input, { operator: "0x1234", recipient: "0xabcd" });
  const decoded = decodeFunctionData({ abi: rewardCampaignAbi, data });
  assert.equal(decoded.functionName, "claim");
  assert.deepEqual(decoded.args, [input.entitlementId, recipient, 0n, 1000n, 2000n, "0x1234", "0xabcd"]);
});

test("claims reject unsafe numeric/time representations and enforce signed lifetime", () => {
  for (const [field, value] of [["amount", 1], ["amount", -1n], ["nonce", 2n ** 256n], ["issuedAt", 2n ** 64n]]) {
    fails("invalid_reward_uint", () => rewardClaimMessages(context, { ...claim(), [field]: value }));
  }
  fails("invalid_reward_claim_lifetime", () => rewardClaimMessages(context, { ...claim(), expiresAt: 1000n + 86401n }));
  fails("zero_reward_claim", () => rewardClaimMessages(context, { ...claim(), amount: 0n }));
  requireLiveRewardClaim(context, claim(), 1000n, 3000n);
  for (const now of [999n, 2000n]) fails("reward_claim_not_live", () => requireLiveRewardClaim(context, claim(), now, 3000n));
  fails("reward_claim_not_live", () => requireLiveRewardClaim(context, claim(), 1500n, 1500n));
});

test("every claim field, chain and contract is bound into its signatures", () => {
  const original = rewardClaimDigests(context, claim());
  for (const patch of [{ recipient: address }, { entitlementId: h("other") }, { nonce: 1n }, { issuedAt: 999n }, { expiresAt: 2001n }, { allocationDigest: h("other") }]) {
    const altered = rewardClaimDigests(context, { ...claim(), ...patch });
    assert.notEqual(altered.authorization, original.authorization); assert.notEqual(altered.consent, original.consent);
  }
  for (const patch of [{ amount: 16n }, { pot: "league" }]) {
    assert.notEqual(rewardClaimDigests(context, { ...claim(), ...patch }).consent, original.consent);
  }
  assert.notEqual(rewardClaimDigests({ ...context, verifyingContract: recipient }, claim()).consent, original.consent);
  assert.notEqual(rewardClaimDigests({ ...context, environment: "monad-testnet", chainId: 10143 }, claim()).consent, original.consent);
  assert.notEqual(hashTypedData(safeRewardConsentMessage(context, claim())), original.consent);
});

function observation() {
  const input = claim();
  const transactionHash = h("transaction"); const blockHash = h("block");
  const log = { address, data: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [input.amount, input.nonce]),
    topics: encodeEventTopics({ abi: rewardCampaignAbi, eventName: "RewardPaid", args: { entitlementId: input.entitlementId, recipient, pot: 0 } }),
    blockHash, blockNumber: 10n, transactionHash, transactionIndex: 0, logIndex: 0, removed: false };
  return { observedChainId: 31337, canonicalBlockHash: blockHash, finalizedBlockNumber: 10n,
    receipt: { status: "success", to: address, transactionHash, blockHash, blockNumber: 10n, logs: [log] } };
}
test("receipt projection requires a matching successful canonical finalized payment event", () => {
  const observed = observation();
  const result = rewardPaymentFromReceipt(context, claim(), h("transaction"), observed);
  assert.equal(result.amount, 15n); assert.equal(result.logIndex, 0); assert.equal(result.blockNumber, 10n);
});
test("wrong-chain, failed, mismatched, reorged and unfinalized receipts are rejected", () => {
  const cases = [
    ["reward_receipt_wrong_chain", (o) => { o.observedChainId = 143; }],
    ["reward_transaction_failed", (o) => { o.receipt.status = "reverted"; }],
    ["reward_receipt_wrong_transaction", (o) => { o.receipt.transactionHash = h("other"); }],
    ["reward_receipt_wrong_contract", (o) => { o.receipt.to = recipient; }],
    ["reward_receipt_noncanonical", (o) => { o.canonicalBlockHash = h("other"); }],
    ["reward_receipt_not_finalized", (o) => { o.finalizedBlockNumber = 9n; }],
    ["reward_payment_event_count_mismatch", (o) => { o.receipt.logs = []; }],
    ["reward_payment_event_count_mismatch", (o) => { o.receipt.logs.push(o.receipt.logs[0]); }],
    ["invalid_reward_payment_log", (o) => { o.receipt.logs[0].removed = true; }],
    ["invalid_reward_payment_log", (o) => { delete o.receipt.logs[0].removed; }],
    ["invalid_reward_payment_event", (o) => { o.receipt.logs.push({ ...o.receipt.logs[0], data: "0x12" }); }],
    ["reward_log_receipt_mismatch", (o) => { o.receipt.logs[0].blockNumber = 11n; }],
    ["reward_payment_intent_mismatch", (o) => { o.receipt.logs[0].data = encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [16n, 0n]); }],
  ];
  for (const [code, edit] of cases) { const observed = observation(); edit(observed); fails(code, () => rewardPaymentFromReceipt(context, claim(), h("transaction"), observed)); }
});

test("other contracts and unrelated event topics cannot impersonate a campaign payment", () => {
  const observed = observation();
  observed.receipt.logs.push({ ...observed.receipt.logs[0], address: recipient, data: "0x12" });
  observed.receipt.logs.push({ ...observed.receipt.logs[0], topics: [h("unrelated-event")], data: "0x12" });
  assert.equal(rewardPaymentFromReceipt(context, claim(), h("transaction"), observed).amount, 15n);
});
