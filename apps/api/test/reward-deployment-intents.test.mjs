import assert from "node:assert/strict";
import test from "node:test";
import { readRewardDeploymentContext, reserveRewardDeploymentIntent, storeRewardDeploymentAttempt, readRewardDeploymentAttempt } from "../../../packages/db/dist/rewards/index.js";
import { prepareRewardDeployment, recordSignedRewardDeployment } from "../dist/features/rewards/deployment-service.js";
import { rewardCampaignBuild, readRewardPendingNonce } from "../../../packages/rewards-chain/dist/index.js";
import { calculationFixture, rewardId as id, rewardWire } from "./fixtures/reward-calculation.mjs";

const h = (n) => `0x${n.toString(16).padStart(64, "0")}`;
const reject = (code, promise) => assert.rejects(promise, (error) => error.code === code);
function fixture() {
  const session = calculationFixture().session; const actorUserId = session.account.userId; const campaignId = id(81);
  const context = { schemaVersion: 1, programmeId: id(80), campaignId, chainId: 31337, environment: "local_simulation",
    operatorAddress: `0x${"1".repeat(40)}`, treasuryAddress: `0x${"2".repeat(40)}`, programmeOnChainId: h(1), campaignOnChainId: h(2),
    manifestHash: h(3), pot: "race", budgetWei: "12000000000000000001", intent: null };
  const intent = { id: id(82), nonce: "17", buildId: rewardCampaignBuild.id, creationCodeHash: rewardCampaignBuild.creationCodeHash,
    createdByUserId: actorUserId, createdAt: "2026-09-08T01:00:00Z", idempotencyKey: "deployment-test-01" };
  const calls = []; const reads = [];
  const reader = { async getChainId() { reads.push("chain"); return 31337; }, async getTransactionCount(args) { reads.push(args); return 12; } };
  const rpc = async (name, args) => {
    calls.push({ name, args: structuredClone(args) });
    if (name === "service_read_reward_deployment_context") return { data: structuredClone(context), error: null };
    if (name === "service_reserve_reward_deployment") { context.intent = structuredClone(intent); return { data: structuredClone(context), error: null }; }
    assert.fail(`Unexpected RPC ${name}`);
  };
  return { session, actorUserId, campaignId, context, intent, calls, reads, reader, rpc, input: { campaignId, idempotencyKey: intent.idempotencyKey } };
}

test("operator deployment preparation uses stored parameters, SQL-reserved nonce and historical replay", async () => {
  const f = fixture(); const first = await prepareRewardDeployment(f.session, f.input, f);
  assert.equal(first.nonce, 17n); assert.equal(first.deployment.operatorAddress.toLowerCase(), f.context.operatorAddress);
  assert.equal(first.deployment.programmeId, f.context.programmeOnChainId); assert.equal(first.intentId, f.intent.id);
  assert.deepEqual(f.reads, ["chain", { address: f.context.operatorAddress, blockTag: "pending" }, "chain"]);
  assert.equal(f.calls[1].args.p_pending_nonce, "12"); assert.equal(f.calls[1].args.p_actor_user_id, f.actorUserId);
  assert.deepEqual(await prepareRewardDeployment(f.session, f.input, { rpc: f.rpc, reader: {} }), first);
  assert.equal(f.calls.length, 3); assert.equal(f.reads.length, 3);
  assert.doesNotMatch(JSON.stringify(rewardWire(first)), /signedTransaction|privateKey|email|claim|funded/);
  await reject("reward_deployment_already_planned", prepareRewardDeployment(f.session, { ...f.input, idempotencyKey: "different-plan" }, f));
});

test("deployment preparation copies actor, request and dependencies before the first await", async () => {
  const f = fixture(); const dependencies = { reader: f.reader, rpc: async (name, args) => {
    const result = await f.rpc(name, args);
    if (name === "service_read_reward_deployment_context") {
      f.input.campaignId = id(998); f.input.idempotencyKey = "mutated-request"; f.session.account.userId = id(999);
      dependencies.reader = {}; dependencies.rpc = () => assert.fail("mutated transport used");
    }
    return result;
  } };
  const result = await prepareRewardDeployment(f.session, f.input, dependencies);
  assert.equal(result.campaignId, f.campaignId); assert.equal(f.calls[1].args.p_actor_user_id, f.actorUserId);
  assert.equal(f.calls[1].args.p_idempotency_key, "deployment-test-01");
});

test("legacy build identity stays readable but current preparation and signing fail closed", async () => {
  const f = fixture();
  f.context.intent = { ...f.intent, buildId: "raceson-reward-campaign-v2-solc-0.8.36-cancun-ir-200",
    creationCodeHash: "0x8195f9fe8d307325596d3610f12e8627c42748cc55d0755c0da9b4e47d0314b3" };
  const historical = await readRewardDeploymentContext({ campaignId:f.campaignId,actorUserId:f.actorUserId },f.rpc);
  assert.equal(historical.intent.buildId,f.context.intent.buildId);
  await reject("reward_deployment_build_mismatch",prepareRewardDeployment(f.session,f.input,f));
  await reject("reward_deployment_build_mismatch",recordSignedRewardDeployment(f.session,
    {...f.input,intentId:f.intent.id,signedTransaction:"0x02aa"},f.rpc));
  assert.equal(f.reads.length,0); assert(f.calls.every(call=>call.name==="service_read_reward_deployment_context"));
});

test("wrong network, drift, unsafe nonce and unavailable RPC never reserve a deployment", async () => {
  for (const mode of ["wrong", "drift", "unsafe", "failure"]) {
    const f = fixture(); let count = 0;
    const reader = { async getChainId() { count++; return mode === "wrong" || (mode === "drift" && count === 2) ? 143 : 31337; },
      async getTransactionCount() { if (mode === "failure") throw new Error("synthetic endpoint secret"); return mode === "unsafe" ? Number.MAX_SAFE_INTEGER + 1 : 0; } };
    await reject(mode === "unsafe" ? "invalid_reward_deployment_nonce" : mode === "failure" ? "reward_deployment_observation_unavailable" : "reward_observed_chain_mismatch",
      prepareRewardDeployment(f.session, f.input, { rpc: f.rpc, reader }));
    assert.equal(f.calls.length, 1);
  }
  await reject("unsupported_reward_chain", readRewardPendingNonce({}, { environment: "monad-testnet", chainId: 143 }, `0x${"1".repeat(40)}`));
});

test("frozen deployment context, scope, exact integer wire and build identity cannot be substituted", async () => {
  const f = fixture();
  await reject("reward_deployment_context_changed", prepareRewardDeployment(f.session, f.input, { reader: f.reader, rpc: async (name, args) => {
    const result = await f.rpc(name, args); if (name === "service_reserve_reward_deployment") result.data.manifestHash = h(99); return result;
  } }));
  f.context.intent.buildId = "different-build";
  await reject("reward_deployment_build_mismatch", prepareRewardDeployment(f.session, f.input, f));
  for (const change of [(c) => { c.campaignId = id(99); }, (c) => { c.budgetWei = 1.1; }, (c) => { c.intent.nonce = "9007199254740992"; },
    (c) => { c.environment = "testnet_pilot"; }, (c) => { c.intent.createdByUserId = id(99); }, (c) => { c.extra = true; }]) {
    const copy = structuredClone(f.context); change(copy);
    await assert.rejects(readRewardDeploymentContext({ campaignId: f.campaignId, actorUserId: f.actorUserId }, async () => ({ data: copy, error: null })));
  }
  await assert.rejects(reserveRewardDeploymentIntent({ campaignId: f.campaignId, actorUserId: f.actorUserId, idempotencyKey: "valid-test-key", observedChainId: 31337, pendingNonce: -1n }, () => assert.fail("must not write")));
});

test("bad signed payloads and revoked authority cannot reach attempt storage or leak raw errors", async () => {
  const f = fixture(); f.context.intent = f.intent;
  for (const signedTransaction of ["0x", "0x01aa", "0x02aa"]) {
    await reject("invalid_reward_signed_deployment", recordSignedRewardDeployment(f.session, { ...f.input, intentId: f.intent.id, signedTransaction }, f.rpc));
  }
  assert(f.calls.every((call) => call.name === "service_read_reward_deployment_context"));
  for (const fn of [readRewardDeploymentContext, readRewardDeploymentAttempt]) {
    const scope = { campaignId: f.campaignId, actorUserId: f.actorUserId, intentId: f.intent.id, attemptId: id(83) };
    await reject("reward_operator_permission_required", fn(scope, async () => ({ data: null, error: { message: "reward_operator_permission_required" } })));
    await reject("reward_ledger_store_failed", fn(scope, async () => ({ data: null, error: { message: "synthetic database secret" } })));
  }
  await assert.rejects(storeRewardDeploymentAttempt({ campaignId: f.campaignId, actorUserId: f.actorUserId, intentId: f.intent.id,
    idempotencyKey: "invalid-attempt", attempt: { get nonce() { assert.fail("getter executed"); } } }, () => assert.fail("must not write")));
});
