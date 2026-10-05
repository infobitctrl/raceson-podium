import assert from "node:assert/strict";
import { readRewardClubClaimProofs, storeRewardClubClaimProof, decodeRewardClubClaimProofContext, copyRewardLedgerDocument as copy,
  revokeRewardClubReview } from "../dist/rewards/index.js";
import { loadVerifiedClubRewardClaimProofs, submitClubRewardClaimProof } from "../../../apps/api/dist/features/rewards/club-claim-proof-service.js";
import { readVerifiedRewardClubClaim, verifyRewardClubSafeConsent, safeRewardConsentMessage } from "../../rewards-chain/dist/index.js";
import { literal } from "./reward-integration-fixture.mjs";
import { clubPaymentSystemScenarios } from "./reward-club-payment-system-scenarios.mjs";
import { clubClaimHttp } from "./reward-club-claim-http.mjs";
import { clubSigningSystemScenarios } from "./reward-club-signing-system-scenarios.mjs";

// Actual SQL and original Safe on the caller's owned local chain. These are
// synthetic signatures/identity attestations, not real club or release authority.
export async function clubProofSystemScenarios({ harness, scenario, chain, entries, programmeId, operator, owner, prepared, prepare, request, deps }) {
  const { rpc, query, scalar, rpcSql, lock, waiting } = harness;
  const owners = [...chain.clubOwners].sort((a, b) => a.address.toLowerCase().localeCompare(b.address.toLowerCase())).slice(0, 2);
  const consent = async (claim, members = owners, message = safeRewardConsentMessage(claim.context, claim.claim)) =>
    `0x${(await Promise.all(members.map(o => o.signTypedData(message)))).map(s => s.slice(2)).join("")}`;
  const recipient = { intentId: prepared.intentId, role: "recipient", idempotencyKey: "club-proof-recipient", signature: await consent(prepared) };
  const http = clubClaimHttp({ rpc, reader: chain.publicClient, programmeId });
  const approval = { intentId: prepared.intentId, role: "operator", idempotencyKey: "club-proof-operator", signature: await chain.operator.signTypedData(prepared.messages.authorization) };
  const submit = (actor, r, overrides = {}) => submitClubRewardClaimProof(actor, r, { ...deps, ...overrides });
  const read = (actor, r = recipient) => readRewardClubClaimProofs(actor, r, rpc);
  const loaded = (actor, r = recipient) => loadVerifiedClubRewardClaimProofs(actor, r, deps);
  const count = () => scalar("select count(*) from app_private.reward_club_claim_proofs");
  const expired = (actor, yes) => query(`update auth.sessions set not_after=clock_timestamp()+interval '${yes ? "-1 second" : "1 hour"}' where id=${literal(actor.sessionId)}`);
  const sqlArgs = (actor, r, proof, witness) => ({ p_actor_user_id: actor.userId, p_actor_session_id: actor.sessionId,
    p_intent_id: r.intentId, p_role: r.role, p_idempotency_key: r.idempotencyKey, p_proof: copy(proof), p_witness: copy(witness), p_observed_at: new Date().toISOString() });
  const material = async (claim, key) => {
    const r = { intentId: claim.intentId, role: "recipient", idempotencyKey: key, signature: await consent(claim) };
    const l = await loaded(owner, r), witness = await readVerifiedRewardClubClaim(chain.publicClient, l.expected, deps.creationCode);
    const p = await verifyRewardClubSafeConsent(chain.publicClient, { safe: l.expected.treasury.safe, campaignContext: l.expected.deployment.context,
      claim: l.claim, signature: r.signature, checkpoint: witness.observation.finalizedBlock });
    return { r, witness, proof: { role: p.role, signer: p.signer.toLowerCase(), digest: p.digest, wrappedDigest: p.wrappedDigest, signature: p.signature } };
  };
  await clubSigningSystemScenarios({ harness, scenario, chain, programmeId, owner, operator, prepared, deps, http });
  await scenario("club claim proof reads scope the actual nominee/operator without borrowing an operator session", async () => {
    const own = await loaded(owner); assert.equal(own.context.intent.clubId, own.context.claimContext.entitlement.clubId); assert.equal(own.context.proofs.length, 0);
    assert.equal((await loaded(operator, approval)).claim.amount, own.claim.amount);
    await assert.rejects(read(operator), { code: "reward_claim_proof_scope_required" });
    await assert.rejects(read(owner, approval), { code: "reward_claim_proof_scope_required" });
    await expired(operator, true);
    try { assert.equal((await read(owner)).actorUserId, owner.userId); await assert.rejects(read(operator, approval), { code: "reward_account_session_required" }); }
    finally { await expired(operator, false); }
    for (const role of ["anon", "authenticated"]) await assert.rejects(query(`begin; set local role ${role}; ${rpcSql("service_read_reward_club_claim_proofs",
      { p_actor_user_id: owner.userId, p_actor_session_id: owner.sessionId, p_intent_id: prepared.intentId, p_role: "recipient" })} rollback;`));
  });
  await scenario("actual Safe rejects one-owner, duplicate, unsorted, unwrapped and wrong-claim consent; approval requires recipient consent first", async () => {
    await assert.rejects(submit(operator, approval), { code: "reward_claim_recipient_consent_required" });
    for (const signature of [await consent(prepared, owners.slice(0, 1)), await consent(prepared, [owners[0], owners[0]]),
      await consent(prepared, [...owners].reverse()), await consent(prepared, owners, prepared.messages.consent),
      await consent({ ...prepared, claim: { ...prepared.claim, amount: prepared.claim.amount + 1n } })]) {
      await assert.rejects(submit(owner, { ...recipient, signature }), error => /^reward_club_consent_/.test(error.code));
    }
    assert.equal(await count(), 0);
  });
  await scenario("concurrent club consents retain one exact proof and recover a lost committed storage response", async () => {
    const unlock = await lock(`select id from app_private.reward_programmes where id=${literal(programmeId)} for update`);
    let lost = false;
    const rpcLost = async (method, args) => { const r = await rpc(method, args); if (method === "service_record_reward_club_claim_proof" && !r.error && !lost) {
      lost = true; throw Error("Synthetic lost committed consent response"); } return r; };
    const pending = Promise.allSettled([submit(owner, recipient, { rpc: rpcLost }), http.submit(owner, recipient)]); pending.catch(() => {});
    try { await waiting(2); } finally { await unlock(); }
    const results = await pending;
    assert.equal(results.filter(r => r.status === "fulfilled").length, 1,
      JSON.stringify(results.map(r => ({ status: r.status, code: r.reason?.code }))));
    assert.equal(results.find(r => r.status === "rejected").reason.code, "reward_ledger_unavailable");
    const retry = await submit(owner, recipient); assert.deepEqual(retry, results.find(r => r.status === "fulfilled").value);
    assert.equal(await count(), 1); assert.deepEqual(Object.keys(retry).sort(), ["expiresAt", "intentId", "proofId", "recordedAt", "role"]);
    assert.deepEqual(await http.submit(owner, recipient), retry);
    assert.equal((await http.review(owner, recipient)).state, "recorded");
    await assert.rejects(submit(owner, { ...recipient, idempotencyKey: "club-proof-other-key" }), { code: "reward_ledger_idempotency_conflict" });
  });
  await scenario("operator approval rechecks the same live Safe consent and stores distinct exact v2 proofs without paying", async () => {
    const wrong = await owners[0].signTypedData(prepared.messages.authorization);
    await assert.rejects(submit(operator, { ...approval, signature: wrong }), { code: "reward_claim_signature_mismatch" });
    const consentBlock = (await read(owner)).proofs[0].chainWitness.observation.finalizedBlock.number;
    await chain.testClient.mine({ blocks: 96, interval: 1 });
    // Inject a negative current ERC-1271 observation while the real historical
    // proof remains valid: operator approval must not reuse only the old check.
    let checkedCurrent = false;
    const rejectingReader = { ...chain.publicClient, readContract: async args => {
      if (args.functionName === "isValidSignature" && args.blockNumber > consentBlock) { checkedCurrent = true; return "0xffffffff"; }
      return chain.publicClient.readContract(args);
    } };
    await assert.rejects(submit(operator, approval, { reader: rejectingReader }), { code: "reward_club_consent_invalid" });
    assert.equal(checkedCurrent, true); assert.equal(await count(), 1);
    const review = await http.review(operator, approval); assert.equal(review.state, "awaiting_approval");
    assert.equal(review.signing.typedData.primaryType, "ClaimAuthorization");
    await assert.rejects(http.call(operator, "GET", `${http.root.replace(programmeId, "7c700000-0000-4000-8000-000000000001")}/${prepared.intentId}/approval`),
      { status: 404, code: "reward_club_claim_not_found" });
    const saved = await http.submit(operator, approval); assert.deepEqual(await submit(operator, approval), saved);
    assert.equal((await http.review(operator, approval)).signing, null);
    const l = await loaded(owner); assert.equal(l.context.proofs.length, 2); assert.equal(await count(), 2);
    assert.notEqual(l.context.proofs[0].digest, l.context.proofs[1].digest);
    assert.equal(l.context.proofs.find(p => p.role === "operator").wrappedDigest, null);
    assert.equal(await chain.publicClient.getBalance({ address: prepared.claim.recipient }), 0n);
    const raw = (await rpc("service_read_reward_club_claim_proofs", { p_actor_user_id: owner.userId, p_actor_session_id: owner.sessionId,
      p_intent_id: prepared.intentId, p_role: "recipient" })).data;
    assert.doesNotThrow(() => decodeRewardClubClaimProofContext(raw, owner, recipient));
    for (const mutate of [c => { c.proofs[0].signer = c.proofs[1].signer; }, c => { c.proofs[1].wrappedDigest = null; },
      c => { c.proofs[0].chainWitness.award.amount = "1"; }, c => { c.proofs[0].chainWitness.treasury.executionNonce = "1"; },
      c => { c.claimContext.intent.recipientUserId = operator.userId; }, c => { c.proofs.reverse(); c.proofs[0].role = "operator"; }]) {
      const c = structuredClone(raw); mutate(c); await assert.rejects(loadVerifiedClubRewardClaimProofs(owner, recipient, { ...deps, rpc: async () => ({ data: c, error: null }) }));
    }
    const corrupted = structuredClone(raw); corrupted.proofs.find(p => p.role === "recipient").wrappedDigest = `0x${"ab".repeat(32)}`;
    assert.doesNotThrow(() => decodeRewardClubClaimProofContext(corrupted, owner, recipient));
    await assert.rejects(loadVerifiedClubRewardClaimProofs(owner, recipient, { ...deps, rpc: async () => ({ data: corrupted, error: null }) }), { code: "invalid_reward_club_claim_proof_document" });
  });
  const pendingClaim = await prepare(await request(entries[1], "club-proof-pending")), m = await material(pendingClaim, "club-proof-pending-consent");
  const store = overrides => storeRewardClubClaimProof(owner, { ...m.r, proof: m.proof, witness: m.witness, observedAt: new Date().toISOString(), ...overrides }, rpc);
  await scenario("club proof writes enforce original witness, fresh sporting source, current identity and immutable private storage", async () => {
    const statement = rpcSql("service_record_reward_club_claim_proof", sqlArgs(owner, m.r, m.proof, m.witness));
    const mapping = await scalar(`select id from public.league_round_race_mappings where league_round_event_id=${literal(entries[1].campaign.scopeKey)} limit 1`);
    await assert.rejects(query(`begin; update public.league_round_race_mappings set current_result_publication_id=null where id=${literal(mapping)}; ${statement} rollback;`), { code: "reward_mapping_source_not_ready" });
    await assert.rejects(query(`begin; update public.user_profiles set locale=case when locale='hr' then 'en' else 'hr' end
      where user_id=${literal(owner.userId)}; ${statement} rollback;`), { code: "reward_claim_readiness_required" });
    await assert.rejects(store({ observedAt: "2020-01-01T00:00:00Z" }), { code: "reward_claim_observation_stale" });
    for (const mutate of [w => { w.treasury.executionNonce = "1"; }, w => { w.award.nonce = "2"; }, w => { w.recipient = `0x${"ab".repeat(20)}`; }]) {
      const w = copy(m.witness); mutate(w); await assert.rejects(query(rpcSql("service_record_reward_club_claim_proof", sqlArgs(owner, m.r, m.proof, w))));
    }
    const body = JSON.parse(await query(`begin; alter role service_role bypassrls; set local role service_role; ${statement} rollback;`));
    assert.equal(body.proofs.length, 1); assert.equal(await count(), 2);
    assert.equal(await scalar("select relrowsecurity from pg_class where oid='app_private.reward_club_claim_proofs'::regclass"), true);
    assert.equal(await scalar("select has_table_privilege('authenticated','app_private.reward_club_claim_proofs','select')"), false);
    assert.equal(await scalar("select has_table_privilege('service_role','app_private.reward_club_claim_proofs','update,delete')"), false);
    assert.equal(await scalar("select count(*) from pg_proc where proname in('service_read_reward_club_claim_proofs','service_record_reward_club_claim_proof','reward_club_claim_proof_document') and prosecdef"), 0);
    await assert.rejects(query("update app_private.reward_club_claim_proofs set idempotency_key='changed-key'"), { code: "reward_ledger_is_immutable" });
  });
  await scenario("club proof reads and insertion recheck recipient session expiry after real waits and roll back", async () => {
    let unlock = await lock("lock table app_private.reward_club_claim_proofs in access exclusive mode");
    let pending = assert.rejects(read(owner), { code: "reward_account_session_required" }); pending.catch(() => {});
    try { await waiting(1); await expired(owner, true); } finally { await unlock(); } await pending; await expired(owner, false);
    unlock = await lock("lock table app_private.reward_club_claim_proofs in share mode");
    pending = assert.rejects(store({}), { code: "reward_account_session_required" }); pending.catch(() => {});
    try { await waiting(1); await expired(owner, true); } finally { await unlock(); } await pending; await expired(owner, false);
    assert.equal(await count(), 2);
  });
  const paymentAfterRevocation = await clubPaymentSystemScenarios({ harness, scenario, chain, entries, programmeId, operator, owner, prepared, pendingClaim, deps });
  await scenario("club review revocation retains canonical historical proof retries while preventing new consent", async () => {
    const l = await read(owner), reviewId = l.intent.treasuryReviewId;
    await revokeRewardClubReview(operator, { programmeId, reviewId, reason: "operator_correction" }, rpc);
    assert.equal((await submit(owner, recipient)).intentId, prepared.intentId);
    assert.equal((await submit(operator, approval)).intentId, prepared.intentId);
    assert.equal((await http.submit(owner, recipient)).intentId, prepared.intentId);
    assert.equal((await http.submit(operator, approval)).intentId, prepared.intentId);
    assert.equal((await http.review(owner, recipient)).state, "recorded");
    assert.equal((await http.review(operator, approval)).signing, null);
    await assert.rejects(http.review(owner, m.r), { status: 409, code: "reward_claim_readiness_required" });
    await assert.rejects(submit(owner, m.r), { code: "reward_claim_readiness_required" });
    assert.equal(await count(), 2); assert.equal(await chain.publicClient.getBalance({ address: prepared.claim.recipient }), 0n);
    await paymentAfterRevocation();
  });
}
