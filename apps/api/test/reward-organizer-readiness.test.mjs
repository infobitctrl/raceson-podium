import assert from "node:assert/strict";
import test from "node:test";
import { readinessFixture as fixture, readinessId as id } from "./fixtures/reward-readiness.mjs";
import { dispatchOrganizerRewardRoutes } from "../dist/routes/rewards/organizer.js";
import { getOrganizerAthleteReadiness, recordOrganizerAthleteReadiness, revokeOrganizerAthleteReadiness } from "../dist/features/rewards/organizer-readiness-service.js";

const path = `/api/v1/organizer/rewards/programmes/${id(9)}/destinations/${id(7)}/readiness`;
const body = f => { const { programmeId, requestId, ...input } = f.input; return input; };
function assertPrivate(reply) {
  assert.doesNotMatch(JSON.stringify(reply), /signature|proofId|sessionId|SessionId|userId|UserId|idempotencyKey|EvidenceRef|nonce|privateKey|signedTransaction/);
}
async function request(f, { method = "GET", url = path, input, config = f.config, identity = async () => f.identity, rpc = f.rpc } = {}) {
  const res = { headers: {}, status: 200, value: null }; let bodyReads = 0;
  const handled = await dispatchOrganizerRewardRoutes({ method }, res, new URL(url, f.config.origin), {
    config: () => config, requireIdentity: identity, rpc,
    readJsonBody: async () => { bodyReads++; return input; },
    applyPrivateSessionHeaders: target => { target.headers["cache-control"] = "private, no-store"; },
    sendSuccess: (target, value) => { target.value = value; },
    sendError: (target, status, code, message) => { target.status = status; target.value = { error: { code, message } }; },
  });
  return { ...res, handled, bodyReads };
}

test("operator readiness read whitelists minimum profile review data, never wallet proofs or private session/audit context", async () => {
  const f = await fixture(); f.context.latestReview = f.review; f.context.reviewState = "reviewed";
  const reply = await request(f); assert.equal(reply.status, 200); assert.equal(reply.bodyReads, 0); assertPrivate(reply.value);
  assert.equal(reply.headers["cache-control"], "private, no-store");
  assert.deepEqual(Object.keys(reply.value).sort(), ["programmeId", "requestId", "chainId", "athleteProfileId", "address", "requestedAt",
    "destinationStatus", "profileFingerprintSha256", "dateOfBirth", "birthYear", "reviewState", "latestReview"].sort());
  assert.equal(reply.value.latestReview.reviewId, id(14)); assert.equal(reply.value.dateOfBirth, "1990-01-01");
  assert.equal(reply.value.reviewState, "reviewed"); assert.equal(reply.value.address, f.context.destination.address);
  f.context.latestReview.attestation.identityEvidenceRef = id(90);
  assertPrivate(reply.value); assert.equal(f.calls.length, 1);
});
test("strict explicit review preserves the operator's original expected revision and fingerprint and returns historical summary", async () => {
  const f = await fixture(); f.context.profileFingerprintSha256 = "b".repeat(64);
  const reply = await request(f, { method: "POST", input: body(f) });
  assert.equal(reply.status, 200); assertPrivate(reply.value);
  assert.deepEqual(f.calls.map(c => c.name), ["service_read_reward_athlete_review_context", "service_record_reward_athlete_review"]);
  assert.equal(f.calls[1].args.p_expected_profile_fingerprint, "a".repeat(64));
  assert.equal(f.calls[1].args.p_expected_revision, 0); assert.equal(reply.value.review.revision, 1);
  f.review.revokedAt = "2026-09-08T09:00:02Z"; f.review.revocationReason = "operator_correction";
  const retry = await request(f, { method: "POST", input: body(f) });
  assert.equal(retry.value.review.revokedAt, f.review.revokedAt); assertPrivate(retry.value);
});
test("revocation requires the exact selected latest review and configured network before mutation", async () => {
  const f = await fixture(); f.context.latestReview = f.review; f.context.reviewState = "reviewed";
  const url = `${path}/${id(14)}/revoke`, input = { reason: "wallet_security_changed" };
  const reply = await request(f, { method: "POST", url, input });
  assert.equal(reply.status, 200); assert.equal(reply.value.review.revocationReason, input.reason); assertPrivate(reply.value);
  assert.deepEqual(f.calls.map(c => c.name), ["service_read_reward_athlete_review_context", "service_revoke_reward_athlete_review"]);
  f.calls.length = 0;
  const stale = await request(f, { method: "POST", url: `${path}/${id(99)}/revoke`, input });
  assert.equal(stale.status, 409); assert.equal(f.calls.length, 1);
  f.calls.length = 0;
  const foreign = await request(f, { method: "POST", url, input, config: { ...f.config, chainId: 10143 } });
  assert.equal(foreign.status, 404); assert.equal(f.calls.length, 1);
});
test("all readiness routes deny missing sessions, undesignated operators and foreign programme scope without revealing private errors", async () => {
  for (const options of [{}, { method: "POST" }, { method: "POST", url: `${path}/${id(14)}/revoke`, input: { reason: "operator_correction" } }]) {
    const f = await fixture(); f.context.latestReview = f.review;
    const base = { input: body(f), ...options };
    const unauth = await request(f, { ...base, identity: async () => { throw new Error("Unauthorized"); } });
    assert.equal(unauth.status, 401); assert.equal(unauth.bodyReads, 0); assert.equal(f.calls.length, 0);
    for (const [code, status] of [["reward_account_session_required", 401], ["reward_operator_permission_required", 403],
      ["reward_readiness_scope_required", 404], ["private SQL proof session secret", 503]]) {
      const reply = await request(f, { ...base, rpc: async () => ({ data: null, error: { message: code } }) });
      assert.equal(reply.status, status); assertPrivate(reply.value);
      assert.doesNotMatch(JSON.stringify(reply.value), /private SQL/);
    }
  }
});
test("disabled, unsupported, queried and malformed browser requests cannot reach private persistence", async () => {
  const f = await fixture();
  assert.equal((await request(f, { config: null })).handled, false);
  for (const method of ["PUT", "DELETE", "PATCH"]) assert.equal((await request(f, { method })).handled, false);
  assert.equal((await request(f, { url: `${path}/${id(14)}/revoke` })).handled, false);
  for (const url of [`${path}?after=${id(1)}`, `${path}?chainId=143`, path.replace(id(9), "bad"), path.replace(id(7), "00000000-0000-0000-0000-000000000000")])
    assert.equal((await request(f, { url })).status, 400);
  for (const input of [null, {}, { ...body(f), approved: true }, { ...body(f), actorUserId: id(90) }, { ...body(f), amount: "1" },
    { ...body(f), chainId: 143 }, { ...body(f), expectedRevision: "0" }, { ...body(f), expectedRevision: 2147483646 },
    { ...body(f), attestation: { approved: true } }, { ...body(f), attestation: { ...f.input.attestation, verifiedDateOfBirth: "2001-02-29" } },
    { ...body(f), attestation: { ...f.input.attestation, walletRecoveryEvidenceRef: "00000000-0000-0000-0000-000000000000" } }])
    assert.equal((await request(f, { method: "POST", input })).status, 400);
  for (const input of [{ reason: "other" }, { reason: "operator_correction", requestId: id(99) }])
    assert.equal((await request(f, { method: "POST", url: `${path}/${id(14)}/revoke`, input })).status, 400);
  assert.equal(f.calls.length, 0);
});
test("held/stale/retry-conflict writes return safe conflict status; corrupted contexts or proof failures never become successful reviews", async () => {
  const f = await fixture();
  for (const code of ["reward_readiness_hold", "reward_readiness_profile_changed", "reward_readiness_revision_changed", "reward_ledger_idempotency_conflict"]) {
    const reply = await request(f, { method: "POST", input: body(f), rpc: async (name, args) => name === "service_read_reward_athlete_review_context"
      ? f.rpc(name, args) : { data: null, error: { message: code } } });
    assert.equal(reply.status, 409); assert.equal(reply.value.error.code, code);
  }
  f.calls.length = 0; f.context.challenge.proof.signature = `0x${"ff".repeat(65)}`;
  assert.equal((await request(f, { method: "POST", input: body(f) })).status, 503); assert.equal(f.calls.length, 1);
  f.context.extra = "private"; assert.equal((await request(f)).status, 503);
});
test("operator services freeze identity, route scope and configuration across awaits", async () => {
  for (const operation of ["read", "review", "revoke"]) {
    const f = await fixture(), options = { ...f.config, rpc: f.rpc }, input = { ...f.input, reviewId: id(14), reason: "operator_correction" };
    if (operation === "revoke") { f.context.latestReview = structuredClone(f.review); f.context.reviewState = "reviewed"; }
    options.rpc = async (name, args) => { const result = await f.rpc(name, args);
      f.identity.userId = id(90); input.programmeId = id(90); input.requestId = id(90); input.reviewId = id(90); options.chainId = 10143;
      return result; };
    const result = operation === "read" ? await getOrganizerAthleteReadiness(f.identity, input, options)
      : operation === "review" ? await recordOrganizerAthleteReadiness(f.identity, input, options)
      : await revokeOrganizerAthleteReadiness(f.identity, input, options);
    assert.equal(result.programmeId, id(9)); assert.equal(result.requestId, id(7)); assert.equal(result.chainId, 31337); assertPrivate(result);
  }
});
