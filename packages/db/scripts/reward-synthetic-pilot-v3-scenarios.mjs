import assert from "node:assert/strict";
import { athleteAllocationsV3Scenarios } from "./reward-athlete-allocations-v3-scenarios.mjs";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createSyntheticPilotV3 } from "../../domain/dist/rewards/synthetic-pilot-v3.js";
import { rewardHistoricalSourceV3, readRewardPublishedPreviewV2, rewardFrozenProposalsV2 } from "../dist/rewards/index.js";
import { compactPilotSeedSql } from "../../../demo/rewards/scripts/seed-compact-pilot.mjs";
import { integrationFixtureSql, literal as q } from "./reward-integration-fixture.mjs";
import { fundCompactPilot } from "../../../demo/rewards/scripts/compact-pilot-funding.mjs";
import { startProgrammeLocalChain } from "../../../demo/rewards/scripts/programme-local-chain.mjs";
import { openCanaryJournal } from "../../../demo/rewards/scripts/canary-journal.mjs";
import { executeCompactRoundOne } from "../../../demo/rewards/scripts/compact-round-one.mjs";
import { rewardRoundPublicationV3 } from "../dist/rewards/index.js";
import { programmeActivationV3Scenarios } from "./reward-programme-activation-v3-scenarios.mjs";
const id = n => `8f000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export async function syntheticPilotV3Scenarios({ harness, scenario }) {
  const { query, scalar, rpc } = harness;
  await query(integrationFixtureSql().replaceAll("78000000-", "8f000000-")
    .replaceAll("reward-integration", "compact-pilot-integration").replaceAll("Synthetic ", "Synthetic compact pilot ")
    .replaceAll("synthetic-round-", "synthetic-compact-pilot-round-")
    .replaceAll("reward-operator@example.invalid", "compact-operator@example.invalid")
    .replaceAll("reward-successor@example.invalid", "compact-successor@example.invalid"));
  const identity = { userId: id(4), sessionId: id(980001) }, org = id(1);
  await query(`insert into auth.sessions(id,user_id,not_after) values(${q(identity.sessionId)},${q(identity.userId)},clock_timestamp()+interval '1 hour')`);
  const pilot = createSyntheticPilotV3(new Date().toISOString()), draft = pilot.draftId, seed = compactPilotSeedSql(pilot, org, identity.userId);
  const read = () => rewardHistoricalSourceV3(identity, 31337, draft, undefined, rpc);
  let initial, decision;
  await scenario("saved compact pilot uses the actual seed and shared private source reader without implicit approvals or identities", async () => {
    await query(seed); initial = await read();
    assert.equal(initial.record.rules.budgetMon, "100"); assert.equal(initial.source.kind, "synthetic_rehearsal");
    assert.equal(initial.source.rounds.flatMap(r => r.results).length, 80); assert.equal(initial.decisions.length, 0);
    assert.equal(initial.preview.proposedWei, 0n); assert.equal(initial.preview.payableWei, 0n);
    const preview = await readRewardPublishedPreviewV2(identity, 31337, draft, rpc);
    assert.deepEqual(preview.snapshot, pilot.snapshot); assert.equal(preview.sourceHash, initial.sourceHash);
    for (const table of ["public.athlete_profiles", "public.clubs", "public.result_rows", "public.result_publications"])
      assert.equal(await scalar(`select count(*) from ${table} where id::text like '8a000000-%'`), 0);
    for (const table of ["reward_historical_source_reviews_v3", "reward_allocation_approvals_v3", "reward_programme_deployment_intents_v3"])
      assert.equal(await scalar(`select count(*) from app_private.${table} where draft_id=${q(draft)}`), 0);
    assert.equal(await scalar(`select count(*) from public.event_categories where event_edition_id=${q(pilot.finale.editionId)}`), 2);
  });
  await scenario("pilot seed rerun preserves saved edits and refuses a conflicting immutable source without overwriting", async () => {
    const counts = await scalar(`select count(*) from public.event_editions`);
    await query(`update app_private.reward_planning_drafts set revision=2,rules=jsonb_set(rules,'{budgetMon}','"101"') where id=${q(draft)};`);
    await query(seed); assert.equal((await read()).record.rules.budgetMon, "101"); assert.equal((await read()).record.revision, 2);
    assert.equal(await scalar(`select count(*) from public.event_editions`), counts);
    const different = createSyntheticPilotV3(new Date(Date.parse(pilot.snapshot.capturedAt) + 1000).toISOString());
    await assert.rejects(query(compactPilotSeedSql(different, org, identity.userId)), /Synthetic pilot source conflict/);
    await query(`update app_private.reward_planning_drafts set revision=1,rules=jsonb_set(rules,'{budgetMon}','"100"') where id=${q(draft)};`);
    assert.equal((await read()).sourceHash, initial.sourceHash);
  });
  await scenario("explicit saved synthetic source review records current decision only and retains the fifth/league reserves", async () => {
    decision = { slot: 1, requestId: id(980010), expectedReviewId: null, contextHash: initial.contextHash, decision: "confirmed_final" };
    const approved = await rewardHistoricalSourceV3(identity, 31337, draft, decision, rpc);
    assert.equal(approved.source.kind, "synthetic_rehearsal"); assert.equal(approved.source.rounds[0].evidence.kind, "synthetic");
    assert.ok(approved.preview.rounds[0].proposedWei > 0n); assert.equal(approved.preview.league.proposedWei, 0n);
    assert.equal(approved.preview.rounds[4].proposedWei, 0n); assert.equal(approved.preview.payableWei, 0n);
    assert.equal(await scalar(`select count(*) from app_private.reward_result_review_policies_v3 where organization_id=${q(org)}`), 0);
    assert.ok(Date.parse(approved.recordedDecision.reviewedAt) >= Date.parse(pilot.snapshot.capturedAt));
    await query(seed); assert.equal((await read()).decisions[0].id, decision.requestId);
    await assert.rejects(rewardFrozenProposalsV2(identity, 31337, draft, 1, undefined, rpc), { code: "invalid_reward_planning_request" });
    // A direct service-role insert cannot bypass the old V2 provenance boundary.
    const insertV2 = `insert into app_private.reward_frozen_proposals_v2(draft_id,slot,revision,document,proposal_hash,frozen_by_user_id)
        values(${q(draft)},1,1,'{}',repeat('0',64),${q(identity.userId)});`;
    await assert.rejects(query(`begin; set local role service_role; ${insertV2} rollback;`), /invalid_reward_planning_request|row-level security/);
    await assert.rejects(query(`begin; ${insertV2} rollback;`), /invalid_reward_planning_request/);
  });
  await scenario("saved compact pilot funds six real V3 pots through actual SQL and recovers an accepted deposit without a duplicate", async () => {
    const directory = mkdtempSync("/private/tmp/raceson-programme-chain-compact-");
    let runtime, journal;
    try {
      runtime = await startProgrammeLocalChain({ directory, readPort: 0 });
      journal = openCanaryJournal(join(directory, "pilot-funding"));
      const send = runtime.reader.sendRawTransaction;
      let sends = 0, lost = false;
      runtime.reader.sendRawTransaction = async request => {
        const hash = await send(request); sends++;
        // Deployment is the first send; lose exactly the deposit reply.
        if (sends === 2 && !lost) { lost = true; throw Error("synthetic_lost_deposit_reply"); }
        return hash;
      };
      await assert.rejects(fundCompactPilot(runtime, { identity, rpc }, journal), /synthetic_lost_deposit_reply/);
      assert.equal(sends, 2); assert.ok(journal.read("deposit.json")); assert.equal(journal.read("deposit-receipt.json"), null);
      const recovered = await fundCompactPilot(runtime, { identity, rpc }, journal);
      assert.equal(recovered.depositedMon, "100"); assert.equal(recovered.routedMon, "100"); assert.equal(recovered.paidMon, "0");
      assert.equal(recovered.receipts.length, 7); assert.equal(sends, 8);
      const repeated = await fundCompactPilot(runtime, { identity, rpc }, journal);
      assert.deepEqual(repeated, recovered); assert.equal(sends, 8);
      assert.equal(await scalar(`select count(*) from app_private.reward_programme_deployment_intents_v3 where draft_id=${q(draft)}`), 1);
      assert.equal(await scalar(`select count(*) from app_private.reward_allocation_approvals_v3 where draft_id=${q(draft)}`), 0);
      for (const table of ["public.athlete_profiles", "public.clubs", "public.result_rows", "public.result_publications"])
        assert.equal(await scalar(`select count(*) from ${table} where id::text like '8a000000-%'`), 0);
      await scenario("Round 1 uses the saved approval, exact V3 jobs and database clock; uncertain send recovery does not upload or pay twice", async () => {
        let lostClose = false;
        runtime.reader.sendRawTransaction = async request => {
          const hash = await send(request); sends++;
          if (!lostClose) { lostClose = true; throw Error("synthetic_round_one_lost_reply"); }
          return hash;
        };
        await assert.rejects(executeCompactRoundOne(runtime, { identity, rpc }), /round_one_broadcast_unknown/);
        const first = await executeCompactRoundOne(runtime, { identity, rpc });
        assert.equal(first.receipts.length, 2); assert.equal(first.paidMon, "0"); assert.equal(sends, 10);
        assert.ok(first.awardCount > 0); assert.equal(BigInt(first.allocatedWei) + BigInt(first.unallocatedWei), 10n * 10n ** 18n);
        assert.deepEqual(await executeCompactRoundOne(runtime, { identity, rpc }), first); assert.equal(sends, 10);
        const scope = { chainId: 31337, draftId: draft, slot: 1, approvalId: first.approvalId, uploadId: first.uploadId, packageHash: first.packageHash };
        const readPublication = () => rewardRoundPublicationV3(identity, scope, undefined, rpc);
        const view = await readPublication(); assert.equal(view.current, true); assert.equal(view.review.seconds, 86400);
        assert.equal(view.canPublish, false); assert.equal(view.publication, null);
        const startAgain = { action: "start", requestId: view.review.id, reviewId: null, packageHash: scope.packageHash };
        const repeatedReviews = await Promise.all([rewardRoundPublicationV3(identity, scope, startAgain, rpc), rewardRoundPublicationV3(identity, scope, startAgain, rpc)]);
        assert.deepEqual(repeatedReviews[0].review, view.review); assert.deepEqual(repeatedReviews[1].review, view.review);
        const change = { action: "publish", requestId: id(981030), reviewId: view.review.id, packageHash: scope.packageHash };
        await assert.rejects(rewardRoundPublicationV3(identity, scope, change, rpc), { code: "reward_round_review_pending" });
        for (const table of ["reward_round_reviews_v3", "reward_round_publications_v3"]) {
          for (const role of ["anon", "authenticated"])
            assert.equal(await scalar(`select has_table_privilege('${role}','app_private.${table}','SELECT,INSERT,UPDATE,DELETE')`), false);
          assert.equal(await scalar(`select count(*) from pg_trigger where tgrelid='app_private.${table}'::regclass and tgname='${table}_immutable' and tgenabled='O'`), 1);
        }
        await assert.rejects(query(`update app_private.reward_round_reviews_v3 set id=id`), /reward_ledger_is_immutable/);
        await assert.rejects(rewardRoundPublicationV3(identity, scope, { ...change, action: "start", reviewId: null }, rpc), { code: "reward_round_publication_conflict" });
        await query(`update app_private.reward_planning_drafts set revision=revision+1 where id=${q(draft)}`);
        assert.equal((await readPublication()).current, false);
        await assert.rejects(rewardRoundPublicationV3(identity, scope, change, rpc), { code: "reward_allocation_not_ready" });
        await query(`update app_private.reward_planning_drafts set revision=revision-1 where id=${q(draft)}`);
        // Success/edge timing is tested against an independent transaction-local
        // synthetic clock fixture, never the persistent demo or real results.
        const args = { p_actor_user_id: identity.userId, p_actor_session_id: identity.sessionId, p_chain_id: 31337,
          p_draft_id: draft, p_slot: 1, p_approval_id: scope.approvalId, p_upload_id: scope.uploadId,
          p_action: "publish", p_request_id: change.requestId, p_review_id: change.reviewId, p_package_hash: scope.packageHash };
        const sql = harness.rpcSql("service_reward_round_publication_v3", args);
        const output = await query(`begin;
          alter table app_private.reward_round_reviews_v3 disable trigger reward_round_reviews_v3_immutable;
          update app_private.reward_round_reviews_v3 set started_at=clock_timestamp()-interval '24 hours 1 second' where id=${q(change.reviewId)};
          ${sql} ${sql}
          rollback;`);
        assert.match(output, /evidenceHash/); assert.equal((await readPublication()).publication, null);
        const release = await harness.lock('lock table app_private.reward_round_reviews_v3 in access exclusive mode');
        const blocked = assert.rejects(readPublication(), { code: "reward_account_session_required" }); blocked.catch(() => {});
        try { await harness.waiting(1); await query(`update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${q(identity.sessionId)}`); }
        finally { await release(); }
        await blocked;
        await query(`update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${q(identity.sessionId)}`);
        await assert.rejects(readPublication(), { code: "reward_account_session_required" });
        await query(`update auth.sessions set not_after=clock_timestamp()+interval '1 hour' where id=${q(identity.sessionId)}`);
        await programmeActivationV3Scenarios({ harness, scenario, identity, scope, runtime });
        // Ten funding/upload sends, stage + activation, then exactly one
        // synthetic recipient-consented payout in the rollback-only fixture.
        assert.equal(sends, 13);
        await athleteAllocationsV3Scenarios({ harness, scenario, scope, operatorIdentity: identity });
      });
      // A changed saved decision is not silently repaired to recover the trial.
      await query(`update app_private.reward_planning_drafts set rules=jsonb_set(rules,'{budgetMon}','"101"') where id=${q(draft)}`);
      await assert.rejects(fundCompactPilot(runtime, { identity, rpc }, journal)); assert.equal(sends, 13);
      await query(`update app_private.reward_planning_drafts set rules=jsonb_set(rules,'{budgetMon}','"100"') where id=${q(draft)}`);
    } finally {
      journal?.close(); await runtime?.stop();
      rmSync(directory, { recursive: true, force: true }); // Only this owned disposable chain/journal.
    }
  });
  await scenario("pilot snapshot stays immutable and private; live session and organization guards remain authoritative", async () => {
    await assert.rejects(query(`update app_private.reward_public_snapshots_v2 set payload=payload where season_id=${q(pilot.snapshot.sourceSeasonId)}`), /reward_snapshot_immutable/);
    for (const role of ["anon", "authenticated", "service_role"])
      assert.equal(await scalar(`select has_table_privilege('${role}','app_private.reward_public_snapshots_v2','INSERT,UPDATE,DELETE')`), false);
    for (const role of ["anon", "authenticated"])
      assert.equal(await scalar(`select has_table_privilege('${role}','app_private.reward_public_snapshots_v2','SELECT')`), false);
    await assert.rejects(rewardHistoricalSourceV3(identity, 10143, draft, undefined, rpc), { code: "reward_planning_not_found" });
    await query(`update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${q(identity.sessionId)}`);
    await assert.rejects(read(), { code: "reward_account_session_required" });
  });
}
