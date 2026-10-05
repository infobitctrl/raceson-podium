import assert from "node:assert/strict";
import { createPrivyTestnetPilotV3 } from "../../domain/dist/rewards/privy-testnet-pilot-v3.js";
import { privyPilotSeedSql, privyPilotOrganization } from "../../../demo/rewards/scripts/seed-privy-testnet-pilot.mjs";
import { readRewardPublishedPreviewV2, rewardHistoricalSourceV3, rewardFrozenProposalsV2 } from "../dist/rewards/index.js";
import { literal as q } from "./reward-integration-fixture.mjs";
import { preparePrivyProgramme } from "../../../demo/rewards/scripts/privy-testnet-programme.mjs";

/** Runs after the compact fixture, inside the parent-owned disposable database.
 * Uses its two existing invented Auth identities, not real provider sessions. */
export async function privyTestnetPilotV3Scenarios({ harness, scenario }) {
  const { query, scalar, rpc } = harness;
  const operator = "8f000000-0000-4000-8000-000000000004", athlete = "8f000000-0000-4000-8000-000000000005";
  const identity = { userId: operator, sessionId: "9a000000-0000-4000-8000-000000900001" };
  const pilot = createPrivyTestnetPilotV3(new Date().toISOString());
  const seed = privyPilotSeedSql(pilot, operator, athlete);
  await scenario("separate Privy seed creates only a 10143 ten-person source and one explicitly linked synthetic profile", async () => {
    await query(`insert into auth.sessions(id,user_id,not_after) values(${q(identity.sessionId)},${q(operator)},clock_timestamp()+interval '1 hour');
      insert into public.organizations(id,slug,name,status) values(${q(privyPilotOrganization)},'monad-demo','Monad · Synthetic','active');
      insert into public.organization_memberships(organization_id,user_id,role,status,membership_type) values(${q(privyPilotOrganization)},${q(operator)},'owner','active','permanent');
      insert into public.account_login_identifiers(user_id,username) values(${q(operator)},'demo.organizer'),(${q(athlete)},'demo.athlete');`);
    await query(seed);
    const view = await readRewardPublishedPreviewV2(identity, 10143, pilot.draftId, rpc);
    assert.deepEqual(view.snapshot, pilot.snapshot); assert.equal(view.record.rules.budgetMon, "100");
    assert.equal(await scalar("select count(*) from public.athlete_profiles where id::text like '9a000000-%'"), 10);
    assert.equal(await scalar("select count(*) from public.athlete_profiles where id::text like '9a000000-%' and is_claimed"), 1);
    assert.equal(await scalar("select count(*) from public.athlete_profiles where id::text like '9a000000-%' and date_of_birth is not null"), 0);
    assert.equal(await scalar(`select app_private.reward_privy_synthetic_identity_v3(${q(pilot.draftId)},10143,${q(pilot.firstAthleteId)},${q(athlete)})`),true);
    for(const [draft,chain,profile,actor] of [[pilot.draftId,143,pilot.firstAthleteId,athlete],
      [pilot.draftId,31337,pilot.firstAthleteId,athlete],[pilot.draftId,10143,pilot.firstAthleteId,operator],
      ["8a000000-0000-4000-8000-000000000052",10143,pilot.firstAthleteId,athlete],
      [pilot.draftId,10143,"9a000000-0000-4000-8000-000000001061",athlete]])
      assert.equal(await scalar(`select app_private.reward_privy_synthetic_identity_v3(${q(draft)},${chain},${q(profile)},${q(actor)})`),false);
    const source = await rewardHistoricalSourceV3(identity, 10143, pilot.draftId, undefined, rpc);
    assert.equal(source.source.kind, "synthetic_rehearsal"); assert.equal(source.decisions.length, 0); assert.equal(source.preview.payableWei, 0n);
    assert.equal(await scalar(`select count(*) from app_private.reward_programme_deployment_intents_v3 where draft_id=${q(pilot.draftId)}`), 0);
  });
  await scenario("Privy pilot retries preserve rules and fail closed on a changed source or claimed profile", async () => {
    await query(`update app_private.reward_planning_drafts set revision=2,rules=jsonb_set(rules,'{budgetMon}','"99"') where id=${q(pilot.draftId)};`);
    await query(seed); assert.equal((await readRewardPublishedPreviewV2(identity, 10143, pilot.draftId, rpc)).record.rules.budgetMon, "99");
    const changed = createPrivyTestnetPilotV3(new Date(Date.parse(pilot.snapshot.capturedAt) + 1000).toISOString());
    await assert.rejects(query(privyPilotSeedSql(changed, operator, athlete)), /Privy pilot saved scope changed/);
    await query(`update public.athlete_profiles set claimed_by_user_id=${q(operator)} where id=${q(pilot.firstAthleteId)};`);
    await assert.rejects(query(seed), /Privy pilot saved scope changed/);
    await query(`update public.athlete_profiles set claimed_by_user_id=${q(athlete)} where id=${q(pilot.firstAthleteId)};`);
    await assert.rejects(query(`begin; update app_private.reward_planning_drafts set chain_id=31337 where id=${q(pilot.draftId)}; rollback;`), /reward_privy_pilot_chain/);
    await assert.rejects(rewardFrozenProposalsV2(identity, 10143, pilot.draftId, 1, undefined, rpc), { code: "invalid_reward_planning_request" });
  });
  await scenario("10143 pilot preparation binds real SQL approval, upfront zero review and one immutable deployment reservation without signing", async () => {
    await query(`update app_private.reward_planning_drafts set revision=3,rules=jsonb_set(rules,'{budgetMon}','"100"') where id=${q(pilot.draftId)};`);
    let nonceReads = 0;
    const reader = { getChainId: async () => 10143, getTransactionCount: async () => { nonceReads++; return 7; } };
    const first = await preparePrivyProgramme({ identity, rpc }, reader);
    assert.equal(first.prepared.plan.context.chainId, 10143); assert.equal(first.prepared.plan.budgetWei, 100n * 10n ** 18n);
    assert.deepEqual(first.prepared.plan.reviewPeriods, Array(6).fill(0n)); assert.equal(first.prepared.plan.deploymentNonce, 7n);
    const reads = nonceReads, second = await preparePrivyProgramme({ identity, rpc }, reader);
    assert.deepEqual(second.prepared, first.prepared); assert.equal(nonceReads, reads);
    assert.equal(await scalar(`select count(*) from app_private.reward_programme_deployment_intents_v3 where draft_id=${q(pilot.draftId)}`), 1);
    assert.equal(await scalar(`select count(*) from app_private.reward_athlete_readiness_v3 where destination_id in
      (select id from app_private.reward_athlete_destination_requests where athlete_profile_id=${q(pilot.firstAthleteId)})`), 0);
  });
}
