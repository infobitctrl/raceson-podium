import assert from "node:assert/strict";
import { hashTypedData } from "viem";
import { readRewardClubSigningContext, copyRewardLedgerDocument as copy } from "../dist/rewards/index.js";
import { safeRewardConsentMessage } from "../../rewards-chain/dist/index.js";
import { literal } from "./reward-integration-fixture.mjs";

export async function clubSigningSystemScenarios({ harness, scenario, chain, programmeId, owner, operator, prepared, http }) {
  const { query, scalar, rpc, rpcSql, lock, waiting } = harness;
  const input = { intentId: prepared.intentId, role: "recipient" };
  const args = { p_actor_user_id: owner.userId, p_actor_session_id: owner.sessionId, p_intent_id: prepared.intentId, p_role: "recipient" };
  await scenario("club HTTP review returns exact Safe-wrapped v2 consent without private proofs and refuses role/programme confusion", async () => {
    const review = await http.review(owner, input), expected = safeRewardConsentMessage(prepared.context, prepared.claim);
    assert.equal(review.state, "awaiting_consent"); assert.equal(review.amountWei, prepared.claim.amount.toString());
    assert.deepEqual(review.signing.typedData, copy(expected)); assert.equal(review.signing.digest, hashTypedData(expected));
    assert.deepEqual(review.signing.claimTypedData, copy(prepared.messages.consent)); assert.equal(review.signing.threshold, 2);
    assert.equal(review.signing.owners.length, 3); assert.equal(review.programmeId, programmeId);
    await assert.rejects(http.review(operator, input), { code: "reward_club_claim_not_found", status: 404 });
    await assert.rejects(http.review(owner, { ...input, role: "operator" }), { code: "reward_club_claim_not_found", status: 404 });
    await assert.rejects(http.review(operator, { ...input, role: "operator" }), { code: "reward_claim_recipient_consent_required", status: 409 });
    await assert.rejects(http.call(operator, "GET", `${http.root.replace(programmeId, "7c700000-0000-4000-8000-000000000001")}/${input.intentId}/approval`),
      { status: 409 }); // Recipient consent is still absent; no signing data escapes.
    assert.equal(await scalar("select count(*) from app_private.reward_club_claim_proofs"), 0);
    assert.equal(await chain.publicClient.getBalance({ address: prepared.claim.recipient }), 0n);
  });
  await scenario("new club signing reads require current source/review and actual post-wait session with private grants", async () => {
    const c = await readRewardClubSigningContext(owner, input, rpc), round = c.claimContext.lifecycleContext.upload.body;
    const scope = await scalar(`select scope_key from app_private.reward_campaigns where id=${literal(c.intent.campaignId)}`);
    const mapping = await scalar(`select id from public.league_round_race_mappings where league_round_event_id=${literal(scope)} limit 1`);
    const call = rpcSql("service_read_reward_club_signing_context", args);
    await assert.rejects(query(`begin; update public.league_round_race_mappings set current_result_publication_id=null where id=${literal(mapping)}; ${call} rollback;`), { code: "reward_mapping_source_not_ready" });
    for (const role of ["anon", "authenticated"]) await assert.rejects(query(`begin; set local role ${role}; ${call} rollback;`));
    const saved = JSON.parse(await query(`begin; alter role service_role bypassrls; set local role service_role; ${call} rollback;`));
    assert.equal(saved.claimContext.intent.intentId, prepared.intentId);
    assert.equal(await scalar("select count(*) from pg_proc where proname='service_read_reward_club_signing_context' and prosecdef"), 0);
    const release = await lock(`select id from app_private.reward_programmes where id=${literal(programmeId)} for update`);
    const pending = assert.rejects(readRewardClubSigningContext(owner, input, rpc), { code: "reward_account_session_required" }); pending.catch(() => {});
    try { await waiting(1); await query(`update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${literal(owner.sessionId)}`); }
    finally { await release(); }
    await pending; await query(`update auth.sessions set not_after=clock_timestamp()+interval '1 hour' where id=${literal(owner.sessionId)}`);
    assert.equal(round.enabledPot, 0);
  });
  await scenario("club HTTP suppresses signing data when the real recipient session expires during chain verification", async () => {
    let signal, resume, first = true; const reached = new Promise(r => { signal = r; }), release = new Promise(r => { resume = r; });
    const reader = { ...chain.publicClient, getChainId: async () => { if (first) { first = false; signal(); await release; } return chain.publicClient.getChainId(); } };
    const pending = assert.rejects(http.review(owner, input, { clubClaimReader: reader }), { status: 401, code: "reward_auth_required" }); pending.catch(() => {});
    let timer;
    try {
      await Promise.race([reached, new Promise((_, reject) => { timer = setTimeout(() => reject(Error("club signing chain checkpoint was not reached")), 10000); })]);
      await query(`update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${literal(owner.sessionId)}`);
    } finally { clearTimeout(timer); resume(); }
    await pending; await query(`update auth.sessions set not_after=clock_timestamp()+interval '1 hour' where id=${literal(owner.sessionId)}`);
    assert.equal(await scalar("select count(*) from app_private.reward_club_claim_proofs"), 0);
  });
}
