import assert from "node:assert/strict";
import test from "node:test";
import { programmeDeploymentFixtureV3, programmeTestId as id } from "./fixtures/programme-deployment-v3.mjs";
import { readProgrammeAttemptV3, storeProgrammeAttemptV3, decodeProgrammeAttemptBodyV3 } from "../../../packages/db/dist/rewards/index.js";
import { recordSignedProgrammeDeploymentV3, loadVerifiedProgrammeAttemptV3 } from "../dist/features/rewards/programme-attempt-v3-service.js";

const identity = () => ({ userId: id(4), sessionId: id(5) });
const scope = () => ({ chainId: 31337, draftId: id(1), intentId: id(81) });
// SQL/transport witness only, NOT a valid transaction or signature.
const body = () => ({ schemaVersion: 3, chainId: 31337, operatorAddress: `0x${"b".repeat(40)}`, nonce: "4",
  contractAddress: `0x${"a".repeat(40)}`, transactionHash: `0x${"c".repeat(64)}`, signedTransaction: "0x02aa",
  creationCodeHash: programmeDeploymentFixtureV3().intent.creationCodeHash, calldataHash: `0x${"d".repeat(64)}`,
  gasLimit: "10000000", maxFeePerGas: "100000000000", maxPriorityFeePerGas: "0", maximumGasCostWei: "3000000000000000000" });
const response = (attempt = true) => ({ schema: "raceson-programme-attempt-v3", context: programmeDeploymentFixtureV3(),
  attempt: attempt ? { id: id(90), intentId: id(81), body: body(), recordedByUserId: id(4), recordedAt: "2026-09-10T00:03:00Z" } : null });

test("programme attempt transport validates canonical numeric strings, exact keys and bounded fees", () => {
  assert.equal(decodeProgrammeAttemptBodyV3(body()).maxPriorityFeePerGas, 0n);
  for (const patch of [{ chainId: 1 }, { nonce: "9007199254740992" }, { gasLimit: "30000001" }, { maxFeePerGas: "0" },
    { maxPriorityFeePerGas: "100000000001" }, { maximumGasCostWei: "1" }, { signedTransaction: "0x01aa" }, { privateKey: "unwanted" },
    { nonce: 4 }, { nonce: "04" }, { creationCodeHash: `0x${"e".repeat(64)}` }]) assert.throws(() => decodeProgrammeAttemptBodyV3({ ...body(), ...patch }));
});
test("private storage captures the original request and returns only an acknowledgement", async () => {
  const a = identity(), input = { ...scope(), attemptId: id(90), body: body() };
  const result = await storeProgrammeAttemptV3(a, input, async (name, args) => {
    assert.equal(name, "service_record_reward_programme_attempt_v3");
    a.userId = id(99); input.intentId = id(99); input.body.transactionHash = `0x${"f".repeat(64)}`;
    assert.equal(args.p_actor_user_id, id(4)); assert.equal(args.p_intent_id, id(81)); assert.equal(args.p_body.transactionHash, body().transactionHash);
    return { data: { attemptId: id(90), intentId: id(81), transactionHash: body().transactionHash, recordedByUserId: id(4), recordedAt: "2026-09-10T00:03:00Z" }, error: null };
  });
  assert.doesNotMatch(JSON.stringify(result), /signedTransaction|0x02aa|privateKey/);
});
test("private read rejects cross-scope actor/chain/nonce/ceiling substitutions and unexpected properties", async () => {
  for (const mutate of [r => r.context.approvalView.record.draftId = id(99), r => r.attempt.recordedByUserId = id(99),
    r => r.attempt.body.nonce = "5", r => r.attempt.body.chainId = 10143, r => r.attempt.body.maximumGasCostWei = "4000000000000000000",
    r => r.extra = "unwanted", r => r.attempt.body.contractAddress = `0x${"0".repeat(40)}`]) {
    const r = response(); mutate(r); await assert.rejects(readProgrammeAttemptV3(identity(), scope(), async () => ({ data: r, error: null })));
  }
});
test("stale history remains distinguishable from absent attempts and is never fresh signing authority", async () => {
  const r = response(false); r.context.intent.current = false; r.context.approvalView.contextHash = "d".repeat(64); r.context.approvalView.approval.current = false;
  const rpc = async name => { assert.equal(name, "service_read_reward_programme_attempt_v3"); return { data: r, error: null }; };
  assert.equal((await readProgrammeAttemptV3(identity(), scope(), rpc)).attempt, null);
  await assert.rejects(recordSignedProgrammeDeploymentV3(identity(), { ...scope(), attemptId: id(90), signedTransaction: "0x02aa" }, rpc), { code: "reward_programme_approval_required" });
});
test("service refuses structurally plausible unsigned/fake bytes on both recording and recovery", async () => {
  const rpc = async name => { assert.equal(name, "service_read_reward_programme_attempt_v3"); return { data: response(), error: null }; };
  await assert.rejects(recordSignedProgrammeDeploymentV3(identity(), { ...scope(), attemptId: id(90), signedTransaction: "0x02aa" }, rpc), { code: "invalid_programme_signed_deployment" });
  await assert.rejects(loadVerifiedProgrammeAttemptV3(identity(), { ...scope(), attemptId: id(90) }, rpc), { code: "invalid_programme_signed_deployment" });
});
test("attempt errors redact private transport detail and validate returned recording identity", async () => {
  for (const rpc of [async () => { throw Error("private signed bytes"); }, async () => ({ data: null, error: { message: "private signed bytes" } })])
    await assert.rejects(readProgrammeAttemptV3(identity(), scope(), rpc), { code: "reward_ledger_unavailable" });
  await assert.rejects(storeProgrammeAttemptV3(identity(), { ...scope(), attemptId: id(90), body: body() }, async () => ({ data: {
    attemptId: id(91), intentId: id(81), transactionHash: body().transactionHash, recordedByUserId: id(4), recordedAt: "2026-09-10T00:03:00Z" }, error: null })), { code: "invalid_reward_programme_attempt" });
});
