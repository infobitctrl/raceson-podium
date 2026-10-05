import assert from 'node:assert/strict';
import { finalExecutionUploadV3Scenarios } from './reward-final-execution-upload-v3-scenarios.mjs';
import { finalPublicationV3Scenarios } from './reward-final-publication-v3-scenarios.mjs';
import { finalRecipientV3Scenarios } from './reward-final-recipient-v3-scenarios.mjs';
import { finalAllocationApprovalV3, finalAllocationUploadV3, composeFinalAllocationUploadV3 } from '../../../apps/api/dist/features/rewards/final-allocation-actions-v3-service.js';
import { nativeContinuityReviewV3 } from '../../../apps/api/dist/features/rewards/native-finale-continuity-service.js';
import { leaguePublicationV3 } from '../../../apps/api/dist/features/rewards/league-publication-v3-service.js';
import { readFinalAllocationApprovalV3, readFinalAllocationUploadV3, readOwnRewardAllocationsV3 } from '../dist/rewards/index.js';
import { dispatchFinalAllocationActionsV3 } from '../../../apps/api/dist/routes/rewards/final-allocation-actions-v3.js';
import { canonicalRewardJson } from '../../rewards-chain/dist/index.js';
import { literal as q } from './reward-integration-fixture.mjs';
const id = n => `8c000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

// Uses only the surrounding validator's disposable SQL and owned unforked
// Anvil. Synthetic sporting fixtures, not real athletes or a saved demo reset.
export async function finalAllocationActionsV3Scenarios({ harness, scenario, fixture, reader, chain, operator }) {
  const { query, scalar, rpc, rpcSql, lock, waiting } = harness, { identity, draftId, raceId } = fixture;
  const scope = slot => ({ chainId: 31337, draftId, slot }), deps = { rpc, reader };
  const approve = (slot, change, overrides = {}) => finalAllocationApprovalV3(identity, scope(slot), change, { ...deps, ...overrides });
  const requests = {}, packages = {}, uploads = {};
  const count = () => scalar(`select count(*) from app_private.reward_allocation_approvals_v3 where draft_id=${q(draftId)} and slot in (5,6)`);
  const historySql = `select jsonb_agg(jsonb_build_object('id',a.id,'document',a.document_text,'hash',a.document_hash,
    'package',u.package_text,'packageHash',u.package_hash) order by a.id) from app_private.reward_allocation_approvals_v3 a
    left join app_private.reward_allocation_uploads_v3 u on u.approval_id=a.id where a.draft_id=${q(draftId)} and a.slot<=4`;
  const history = await scalar(historySql), profileCount = await scalar('select count(*) from public.athlete_profiles');
  const changeFor = async (slot, n) => {
    const v = await approve(slot); assert.deepEqual(v.reasons, []); assert.ok(v.documentHash);
    return { requestId: id(n), expectedApprovalId: v.approval?.id ?? null, contextHash: v.contextHash, documentHash: v.documentHash };
  };
  const http = async (slot, action, body) => {
    const res = {}, suffix = action === 'approval' ? '' : `/${requests[slot].requestId}`;
    assert.equal(await dispatchFinalAllocationActionsV3({ method: body ? 'POST' : 'GET' }, res,
      new URL(`http://127.0.0.1:3101/api/v1/organizer/rewards/drafts/${draftId}/final-allocation-${action}/${slot}${suffix}`), {
        config: () => ({ chainId: 31337 }), requireIdentity: async () => identity, readJsonBody: async () => body,
        rpc, programmeFundingReader: reader, applyPrivateSessionHeaders: () => res.private = true,
        sendSuccess: (_, data) => Object.assign(res, { status: 200, data }), sendError: (_, status, code) => Object.assign(res, { status, code }),
      }), true); assert.equal(res.private, true); return res;
  };
  await scenario('round-5 exact concurrent approvals persist one allocation with stable walletless shares', async () => {
    requests[5] = await changeFor(5, 988001);
    const pair = await Promise.all([approve(5, requests[5]), approve(5, requests[5])]);
    assert.equal(pair[0].recorded.id, pair[1].recorded.id); assert.equal(await count(), 1);
    assert.equal(pair[0].stageReady, false); assert.equal(pair[0].payableWei, '0');
    const v = await readFinalAllocationUploadV3(identity, { ...scope(5), approvalId: requests[5].requestId }, rpc);
    assert.ok(v.recipients.length > 0); assert.equal(v.recipients.reduce((n, r) => n + r.amountWei, 0n), v.document.calculation.proposedWei);
    // This native fixture has no represented clubs. Retain its entire club
    // share instead of inventing a club recipient to satisfy the test.
    assert.equal(v.recipients.some(r => r.beneficiaryKind === 'club'), false);
    const club = v.document.calculation.families.find(f => f.key === 'club_standings');
    assert.ok(club.budgetWei > 0n); assert.equal(club.proposedWei, 0n); assert.equal(club.retainedWei, club.budgetWei);
    assert.equal(v.prepared, null);
    assert.deepEqual((await readFinalAllocationUploadV3(identity, { ...scope(5), approvalId: requests[5].requestId }, rpc)).recipients, v.recipients);
    assert.equal((await http(5, 'approval')).status, 200);
  });
  await scenario('competing requests use compare-and-swap; an older same-context acknowledgement is not current', async () => {
    const a = await changeFor(5, 988002), b = { ...a, requestId: id(988003) };
    const pair = await Promise.allSettled([approve(5, a), approve(5, b)]);
    assert.equal(pair.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(pair.find(r => r.status === 'rejected').reason.code, 'reward_allocation_approval_conflict');
    const old = await approve(5, requests[5], { reader: { getBlock: () => assert.fail('retry must not inspect chain') } });
    assert.equal(old.recorded.current, false); assert.equal(old.historicalAcknowledgement, true);
    requests[5] = pair[0].status === 'fulfilled' ? a : b; assert.equal(await count(), 2);
  });
  await scenario('SQL refuses a source correction between final preparation and approval without partial recipients', async () => {
    const c = await changeFor(6, 988010); let changed = false;
    const driftRpc = async (name, args) => {
      if (name === 'service_approve_reward_final_allocation_v3' && !changed) {
        changed = true; await query(`update public.result_rows set finish_time_ms=finish_time_ms+1 where id=${q(id(983021))}`);
      }
      return rpc(name, args);
    };
    await assert.rejects(approve(6, c, { rpc: driftRpc }), { code: 'reward_planning_revision_changed' });
    assert.equal(changed, true); assert.equal(await count(), 2);
    assert.equal(await scalar(`select count(*) from app_private.reward_allocation_recipients_v3 where approval_id=${q(c.requestId)}`), 0);
    const native = await nativeContinuityReviewV3(identity, 31337, draftId, undefined, rpc);
    await nativeContinuityReviewV3(identity, 31337, draftId, { requestId: id(988011), expectedReviewId: native.review.id,
      contextHash: native.contextHash, selection: native.review.selection, decision: 'confirmed' }, rpc);
    const league = await leaguePublicationV3(identity, scope(6), undefined, rpc);
    await leaguePublicationV3(identity, scope(6), { requestId: id(988012), expectedPublicationId: league.publication.id,
      documentHash: league.documentHash, decision: 'published' }, rpc);
  });
  await scenario('both final approvals bind exact source proof, pot and actual funding; SQL rejects tampered witnesses', async () => {
    for (const slot of [5, 6]) {
      requests[slot] = await changeFor(slot, 988020 + slot); let writer;
      const saved = await approve(slot, requests[slot], { rpc: async (name, args) => {
        if (name === 'service_approve_reward_final_allocation_v3') writer = structuredClone(args);
        return rpc(name, args);
      } });
      assert.equal(saved.recorded.current, true); assert.equal(saved.allocationApproved, true); assert.equal(saved.payableWei, '0');
      const raw = { ...writer, p_request_id: id(988030 + slot), p_expected_approval_id: requests[slot].requestId };
      const roleWrite = JSON.parse(await query(`begin;alter role service_role bypassrls;set local role service_role;
        ${rpcSql('service_approve_reward_final_allocation_v3', raw)} rollback;`));
      assert.equal(roleWrite.recorded.id, raw.p_request_id);
      for (const mutate of [d => { d.enabledPot = 1 - d.enabledPot; }, d => { d.sourceReview.guardHash = 'f'.repeat(64); },
        d => { d.sourceReview[slot === 5 ? 'continuityReviewId' : 'publicationId'] = id(999999); },
        d => { d.source.capturedAt = '2999-01-01T00:00:00.000Z'; }]) {
        const d = JSON.parse(raw.p_document_text); mutate(d);
        await assert.rejects(query(rpcSql('service_approve_reward_final_allocation_v3', { ...raw, p_document_text: canonicalRewardJson(d) })),
          e => ['invalid_reward_final_allocation', 'reward_allocation_not_ready'].includes(e.code));
      }
      for (const mutate of [f => { f.slot = 0; }, f => { f.capWei = '1'; }, f => { f.paidWei = '1'; }, f => { f.address = '0x' + 'f'.repeat(40); }]) {
        const f = structuredClone(raw.p_funding); mutate(f);
        await assert.rejects(query(rpcSql('service_approve_reward_final_allocation_v3', { ...raw, p_funding: f })), { code: 'reward_allocation_not_ready' });
      }
    }
    assert.equal(await count(), 4);
  });
  await scenario('stable final packages preserve private salts, unclaimed recipients and the separate league pot index', async () => {
    for (const slot of [5, 6]) {
      const s = { ...scope(slot), approvalId: requests[slot].requestId }, facts = await readFinalAllocationUploadV3(identity, s, rpc);
      const p = composeFinalAllocationUploadV3(facts), c = { requestId: id(988040 + slot), contextHash: facts.contextHash, documentHash: facts.documentHash };
      assert.equal(p.enabledPot, slot === 5 ? 0 : 1); assert.ok(p.awards.every(r => r.pot === p.enabledPot));
      if (slot === 6) assert.ok(facts.recipients.some(r => r.beneficiaryKind === 'club'), 'historical club contributions earn league prizes');
      const sql = package_ => rpcSql('service_prepare_reward_final_allocation_upload_v3', { p_actor_user_id: identity.userId,
        p_actor_session_id: identity.sessionId, p_chain_id: 31337, p_draft_id: draftId, p_slot: slot, p_approval_id: s.approvalId,
        p_request_id: c.requestId, p_context_hash: c.contextHash, p_document_hash: c.documentHash, p_package_text: canonicalRewardJson(package_) });
      for (const mutate of [d => { d.enabledPot = 1 - d.enabledPot; }, d => { d.awards[0].pot = 1 - d.enabledPot; },
        d => { d.awards[0].amount = '1'; }, d => { d.awards[0].beneficiaryId = '0x' + 'f'.repeat(64); }]) {
        const bad = structuredClone(p); mutate(bad);
        await assert.rejects(query(sql(bad)), { code: 'invalid_reward_allocation_upload' });
      }
      const v = await http(slot, 'upload', c); assert.equal(v.status, 200); assert.ok(v.data.prepared);
      assert.equal(v.data.enabledPot, p.enabledPot); assert.equal(v.data.stageReady, false); assert.equal(v.data.payableWei, '0');
      assert.doesNotMatch(JSON.stringify(v.data), /snapshotSalt|explanationSalt|sourceBeneficiaryId|awards|privateKey|sessionId/);
      assert.deepEqual((await http(slot, 'upload', c)).data, v.data);
      const stored = await readFinalAllocationUploadV3(identity, s, rpc); assert.deepEqual(stored.recipients, facts.recipients);
      assert.equal(stored.snapshotSalt, facts.snapshotSalt); assert.equal(canonicalRewardJson(stored.prepared.package), canonicalRewardJson(p));
      packages[slot] = p; uploads[slot] = { ...c, packageHash: stored.prepared.packageHash };
      await assert.rejects(approve(slot, await changeFor(slot, 988050 + slot)), { code: 'reward_allocation_not_ready' });
    }
  });
  const verifyHeldExecution = await finalExecutionUploadV3Scenarios({ harness, scenario, fixture, reader, chain, operator, requests, packages, uploads });
  const verifyHeldPublication = await finalPublicationV3Scenarios({ harness, scenario, fixture, reader, chain, operator, requests, packages, uploads });
  await finalRecipientV3Scenarios({ harness, scenario, fixture, reader, chain, operator, requests, packages, uploads });
  await scenario('later league hold invalidates its allocation but exact retries recover history without chain access', async () => {
    const current = await leaguePublicationV3(identity, scope(6), undefined, rpc);
    await leaguePublicationV3(identity, scope(6), { requestId: id(988060), expectedPublicationId: current.publication.id,
      documentHash: current.publication.documentHash, decision: 'held' }, rpc);
    for (const slot of [5, 6]) {
      const v = await approve(slot, requests[slot], { reader: { getBlock: () => assert.fail('exact retry must not inspect chain') } });
      assert.equal(v.historicalAcknowledgement, true); assert.equal(v.recorded.current, slot === 5);
      const { packageHash, ...change } = uploads[slot];
      const u = await finalAllocationUploadV3(identity, { ...scope(slot), approvalId: requests[slot].requestId }, change, rpc);
      assert.equal(u.current, slot === 5); assert.equal(u.payableWei, '0'); assert.equal(u.stageReady, false);
      const f = await readFinalAllocationUploadV3(identity, { ...scope(slot), approvalId: requests[slot].requestId }, rpc);
      assert.equal(canonicalRewardJson(f.prepared.package), canonicalRewardJson(packages[slot]));
      const recipientSource=JSON.parse(await query(`select app_private.reward_recipient_source_v3(${q(uploads[slot].requestId)});`));
      assert.equal(recipientSource.current,slot===5,'A league publication hold blocks league claims, not unchanged race claims');
    }
  });
  await scenario('confirmed final execution history survives a later league hold without changing signed bytes', verifyHeldExecution);
  await scenario('final publication and activated receipt history survive a later league hold without new authority', verifyHeldPublication);
  await scenario('final approval rechecks revoked Auth after real locks and retains immutable private ledger boundaries', async () => {
    const release = await lock(`select id from public.event_categories where id=${q(raceId)} for update`);
    const pending = assert.rejects(readFinalAllocationApprovalV3(identity, scope(5), rpc), { code: 'reward_account_session_required' }); pending.catch(() => {});
    try { await waiting(1); await query(`update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${q(identity.sessionId)}`); }
    finally { await release(); } await pending;
    await query(`update auth.sessions set not_after=clock_timestamp()+interval '1 hour' where id=${q(identity.sessionId)}`);
    await assert.rejects(readFinalAllocationApprovalV3(identity, { ...scope(5), draftId: id(999999) }, rpc), { code: 'reward_planning_not_found' });
    assert.equal(await scalar(`select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
      and p.proname in ('service_read_reward_final_allocation_v3','service_approve_reward_final_allocation_v3',
      'service_read_reward_final_allocation_upload_v3','service_prepare_reward_final_allocation_upload_v3')
      and not p.prosecdef and has_function_privilege('service_role',p.oid,'execute')
      and not has_function_privilege('anon',p.oid,'execute') and not has_function_privilege('authenticated',p.oid,'execute')`), 4);
    await assert.rejects(query(`delete from app_private.reward_allocation_approvals_v3 where id=${q(requests[5].requestId)}`), { code: 'reward_ledger_is_immutable' });
    await assert.rejects(query(`update app_private.reward_allocation_uploads_v3 set package_text='{}' where id=${q(uploads[6].requestId)}`), { code: 'reward_ledger_is_immutable' });
    assert.equal(await scalar('select count(*) from public.athlete_profiles'), profileCount); assert.deepEqual(await scalar(historySql), history);
    assert.equal(await count(), 4);
  });
  await scenario('own final awards remain discoverable alongside historical awards after a source hold without losing reserves', async () => {
    await harness.rollbackFixture(async ({ query, rpc }) => {
      const actor = { userId: id(988071), sessionId: id(988072) };
      const profileId = '85000000-0000-4000-8000-000000000010';
      await query(`insert into auth.users(id,email,aud,role,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
        values(${q(actor.userId)},'final-compatibility@example.invalid','authenticated','authenticated','{}','{}',now(),now());
        update public.user_profiles set status='active' where user_id=${q(actor.userId)};
        insert into auth.sessions(id,user_id,not_after) values(${q(actor.sessionId)},${q(actor.userId)},clock_timestamp()+interval '1 hour');
        insert into public.athlete_profiles(id,slug,first_name,last_name,display_name,status,is_claimed,claimed_by_user_id,birth_year,date_of_birth)
        values(${q(profileId)},'synthetic-final-compatibility','Synthetic','Compatibility','Synthetic compatibility','active',true,${q(actor.userId)},1990,'1990-01-01');`);
      const page = await readOwnRewardAllocationsV3(actor, 31337, null, rpc);
      assert.ok(page.items.some(item=>item.slot===1));assert.ok(page.items.some(item=>item.slot===6&&item.sourceKind==='final_league'));
      assert.equal(page.nextCursor, null);
      assert.deepEqual((await readOwnRewardAllocationsV3(actor, 31337, page.items.at(-1).entitlementId, rpc)).items, []);
      const preserved = JSON.parse(await query(`select to_jsonb(count(*)) from app_private.reward_allocation_recipients_v3
        where source_beneficiary_id=${q(profileId)} and approval_id=${q(requests[6].requestId)};`));
      assert.equal(preserved, 1, 'discoverable history does not forfeit or reassign a held award');
    });
    assert.equal(await scalar('select count(*) from public.athlete_profiles'), profileCount);
  });
}
