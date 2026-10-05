import assert from "node:assert/strict";
import { hashTypedData } from "viem";
import { dispatchAthleteRewardRoutes } from "../../../apps/api/dist/routes/rewards/athlete.js";
import { createRewardClaimReader } from "../../../apps/api/dist/features/rewards/claim-chain-reader.js";
import { applyPrivateSessionHeaders } from "../../../apps/api/dist/browser-session.js";
import { literal } from "./reward-integration-fixture.mjs";

// Synthetic request identity; actual session authorization, SQL, bounded HTTP
// chain reads and pinned deployment checks. This is not real hosted Auth.
export function claimHttpFixture({ harness, chain, config, recipient }) {
  const rpcUrl = new URL(chain.publicClient.chain.rpcUrls.default.http[0]).href;
  return async (method, intentId, body = null, overrides = {}) => {
    const path = `/api/v1/athlete/rewards/claims/${intentId}${method === "POST" ? "/consent" : ""}`;
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(value) { this.body = JSON.parse(value); } };
    const routed = await dispatchAthleteRewardRoutes({ method, headers: {} }, res, new URL(path, config.origin), {
      config: () => config, requireIdentity: async () => recipient, rpc: harness.rpc,
      claimReader: createRewardClaimReader(config, { RACESON_REWARD_LOCAL_RPC_URL: rpcUrl }),
      readJsonBody: async () => body, sendSuccess: (r, data) => r.end(JSON.stringify({ data })),
      sendError: (r, status, code, message) => { r.statusCode = status; r.end(JSON.stringify({ error: { code, message } })); },
      applyPrivateSessionHeaders, ...overrides,
    });
    assert.equal(routed, true); assert.equal(res.headers["Cache-Control"], "private, no-store"); return res;
  };
}
export function signingFromClaimPreview(preview) {
  const { signing } = preview; assert.equal(preview.state, "awaiting_consent");
  return { ...signing, message: { ...signing.message, amount: BigInt(signing.message.amount), nonce: BigInt(signing.message.nonce),
    issuedAt: BigInt(signing.message.issuedAt), expiresAt: BigInt(signing.message.expiresAt) } };
}

export async function claimConsentReviewScenarios({ harness, scenario, chain, config, recipient, identity, profile, first, request }) {
  const { query, scalar, rpc, rpcSql, lock, waiting } = harness;
  const args = { p_actor_user_id: recipient.userId, p_actor_session_id: recipient.sessionId, p_intent_id: first.intentId };
  await scenario("athlete HTTP review reconstructs exact v2 consent using real SQL and bounded local RPC without compiler files", async () => {
    const r = await request("GET", first.intentId); assert.equal(r.statusCode, 200); const preview = r.body.data;
    assert.equal(preview.amountWei, first.claim.amount.toString()); assert.equal(preview.recipientAddress, first.claim.recipient);
    assert.equal(preview.verifyingContract, first.context.verifyingContract); assert.equal(preview.chainId, 31337);
    assert.equal(preview.signing.primaryType, "ReceiveReward");
    assert.equal(hashTypedData(signingFromClaimPreview(preview)), first.digests.consent);
    assert.deepEqual(preview.signing.types, first.messages.consent.types);
    assert.doesNotMatch(JSON.stringify(preview), /signature|dateOfBirth|attestation|reviewContext|recipientUserId|sessionId|idempotencyKey|creationCode|ClaimAuthorization/i);
    assert.equal((await request("GET", first.intentId, null, { requireIdentity: async () => identity })).statusCode, 404);
    for (const corrupt of [tx => ({ ...tx, input: `0x00${tx.input.slice(4)}` }),
      tx => ({ ...tx, input: `${tx.input.slice(0, -2)}01` }), tx => ({ ...tx, from: chain.relayer.address })]) {
      const reader = { ...chain.publicClient, getTransaction: async args => corrupt(await chain.publicClient.getTransaction(args)) };
      const failure = await request("GET", first.intentId, null, { claimReader: reader }); assert.equal(failure.statusCode, 503);
      assert.equal(failure.body.error.code, "reward_service_unavailable");
    }
    assert.equal(await scalar("select count(*) from app_private.reward_athlete_claim_proofs"), 0);
    assert.equal(await scalar("select count(*) from app_private.reward_athlete_payment_intents"), 0);
  });
  await scenario("claim review retains source/identity holds and repeats session checks after lock waits and chain IO", async () => {
    await assert.rejects(query(`begin; alter role service_role bypassrls;
      update public.athlete_profiles set claimed_by_user_id=${literal(identity.userId)} where id=${literal(profile)};
      set local role service_role; ${rpcSql("service_read_reward_athlete_consent_context", args)} rollback;`), { code: "reward_claim_readiness_required" });
    await assert.rejects(query(`begin; alter role service_role bypassrls;
      insert into app_private.reward_sporting_reviews(campaign_id,source_snapshot_id,revision,reviewed_by_user_id,review_body,idempotency_key)
      select r.campaign_id,r.source_snapshot_id,r.revision+1,r.reviewed_by_user_id,r.review_body,'consent-preview-source-revision'
      from app_private.reward_athlete_claim_intents i join app_private.reward_entitlements e on e.id=i.entitlement_id
      join app_private.reward_allocations a on a.id=e.allocation_id join app_private.reward_sporting_reviews r on r.id=a.review_id
      where i.id=${literal(first.intentId)};
      set local role service_role; ${rpcSql("service_read_reward_athlete_consent_context", args)} rollback;`), { code: "reward_review_superseded" });
    const restore = () => query(`update auth.sessions set not_after=clock_timestamp()+interval '1 hour' where id=${literal(recipient.sessionId)}`);
    const release = await lock(`select id from app_private.reward_programmes where id=(select c.programme_id
      from app_private.reward_athlete_claim_intents i join app_private.reward_campaigns c on c.id=i.campaign_id where i.id=${literal(first.intentId)}) for update;
      update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${literal(recipient.sessionId)}`);
    const blocked = request("GET", first.intentId); blocked.catch(() => {});
    try { await waiting(1); } finally { await release(); }
    try { assert.equal((await blocked).statusCode, 401); } finally { await restore(); }
    let reads = 0;
    try {
      const r = await request("GET", first.intentId, null, { rpc: async (name, params) => {
        if (name === "service_read_reward_athlete_consent_context" && ++reads === 2)
          await query(`update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${literal(recipient.sessionId)}`);
        return rpc(name, params);
      } });
      assert.equal(reads, 2); assert.equal(r.statusCode, 401);
    } finally { await restore(); }
    assert.equal((await request("GET", first.intentId)).statusCode, 200);
    assert.equal(await scalar("select count(*) from app_private.reward_athlete_claim_proofs"), 0);
    assert.equal(await scalar("select rolbypassrls from pg_roles where rolname='service_role'"), false);
  });
}
