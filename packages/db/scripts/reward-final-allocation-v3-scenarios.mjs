import assert from 'node:assert/strict';
import { prepareFinalAllocationV3, readFinalAllocationSourceV3 } from '../../../apps/api/dist/features/rewards/final-allocation-v3-service.js';
import { nativeContinuityReviewV3 } from '../../../apps/api/dist/features/rewards/native-finale-continuity-service.js';
import { leaguePublicationV3 } from '../../../apps/api/dist/features/rewards/league-publication-v3-service.js';
import { dispatchFinalAllocationV3 } from '../../../apps/api/dist/routes/rewards/final-allocation-v3.js';
import { literal as q } from './reward-integration-fixture.mjs';
const id = n => `8c000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

// Runs while the earlier fixture's real, owned Anvil programme is still alive.
// Only fixture sporting reviews are written here; this increment sends no tx.
export async function finalAllocationV3Scenarios({ harness, scenario, fixture, reader }) {
  const { query, scalar, rpc, lock, waiting } = harness, { identity, draftId, raceId } = fixture;
  const scope = slot => ({ chainId: 31337, draftId, slot });
  const run = (slot, overrides = {}) => prepareFinalAllocationV3(identity, scope(slot), { rpc, reader, ...overrides });
  const historySql = `select jsonb_agg(jsonb_build_object('id',id,'documentHash',document_hash,'document',document_text) order by id)
    from app_private.reward_allocation_approvals_v3 where draft_id=${q(draftId)}`;
  const history = await scalar(historySql);
  const balances = async () => ({ approvals: await scalar('select count(*) from app_private.reward_allocation_approvals_v3'),
    uploads: await scalar('select count(*) from app_private.reward_allocation_uploads_v3'), profiles: await scalar('select count(*) from public.athlete_profiles') });
  const before = await balances();
  const http = async slot => {
    const res = {};
    assert.equal(await dispatchFinalAllocationV3({ method: 'GET' }, res,
      new URL(`http://127.0.0.1:3101/api/v1/organizer/rewards/drafts/${draftId}/final-allocation/${slot}`), {
        config: () => ({ chainId: 31337 }), requireIdentity: async () => identity, rpc, programmeFundingReader: reader,
        applyPrivateSessionHeaders: () => res.private = true, sendSuccess: (_, data) => Object.assign(res, { status: 200, data }),
        sendError: (_, status, code) => Object.assign(res, { status, code }),
      }), true); assert.equal(res.private, true); return res;
  };
  const confirm = async n => {
    const current = await nativeContinuityReviewV3(identity, 31337, draftId, undefined, rpc);
    return nativeContinuityReviewV3(identity, 31337, draftId, { requestId: id(n), expectedReviewId: current.review.id,
      contextHash: current.contextHash, selection: current.review.selection, decision: 'confirmed' }, rpc);
  };
  const publish = async n => {
    const current = await leaguePublicationV3(identity, scope(6), undefined, rpc);
    return leaguePublicationV3(identity, scope(6), { requestId: id(n), expectedPublicationId: current.publication.id,
      documentHash: current.documentHash, decision: 'published' }, rpc);
  };
  await scenario('final prize preparation refuses stale native continuity and a held league publication', async () => {
    assert.equal((await http(5)).status, 409); assert.equal((await http(6)).status, 409);
    await assert.rejects(run(5), { code: 'reward_final_allocation_source_not_ready' });
    await assert.rejects(run(6), { code: 'reward_league_publication_not_ready' });
  });
  await scenario('round 5 prepares athlete and club prizes against the actual funded child while league remains held', async () => {
    await confirm(987001);
    const a = await run(5); assert.equal(a.document.slot, 5); assert.equal(a.document.enabledPot, 0);
    assert.equal(a.document.calculation.budgetWei, 10000n * 10n ** 18n); assert.deepEqual(a.reasons, []);
    assert.ok(a.document.recipients.some(r => r.beneficiaryKind === 'athlete'));
    assert.equal(a.document.clubProposal.state, 'unapproved_proposal');
    assert.equal(a.funding.accountedFundingWei, a.document.calculation.budgetWei.toString());
    assert.equal((await run(5)).documentHash, a.documentHash);
    assert.equal((await http(6)).status, 409);
    const v = await http(5); assert.equal(v.status, 200); assert.equal(v.data.documentHash, a.documentHash);
    assert.equal(v.data.allocationApproved, false); assert.equal(v.data.stageReady, false); assert.equal(v.data.payableWei, '0');
    assert.doesNotMatch(JSON.stringify(v.data), /sourceGuardHash|guardHash|nativeAthleteId|policyReview.*policy|identityEvidence|privateKey|sessionId/);
  });
  await scenario('published five-round league prepares a separate funded league allocation including all completed metres', async () => {
    const published = await publish(987002), a = await run(6); assert.deepEqual(a.reasons, []);
    assert.equal(a.document.slot, 6); assert.equal(a.document.enabledPot, 1); assert.equal(a.document.sourceReview.publicationId, published.publication.id);
    assert.equal(a.document.calculation.budgetWei, 50000n * 10n ** 18n);
    assert.equal(a.document.recipients.reduce((n, r) => n + r.amountWei, 0n), a.document.calculation.proposedWei);
    assert.equal(a.document.calculation.participation.totalMetres.toString(), published.leagueAllocation.participation.totalMetres);
    assert.notEqual(a.document.binding.campaignAddress, (await run(5)).document.binding.campaignAddress);
    const v = await http(6); assert.equal(v.status, 200); assert.equal(v.data.documentHash, a.documentHash);
    assert.equal(v.data.enabledPot, 1); assert.equal(v.data.payableWei, '0');
    assert.deepEqual(await balances(), before); assert.deepEqual(await scalar(historySql), history);
  });
  await scenario('source correction during actual chain observation invalidates preparation without creating an allocation', async () => {
    let changed = false;
    const driftReader = { ...reader, getBlock: async args => {
      if (!changed) { changed = true; await query(`update public.result_rows set finish_time_ms=finish_time_ms+1 where id=${q(id(983021))}`); }
      return reader.getBlock(args);
    } };
    await assert.rejects(run(5, { reader: driftReader }), { code: 'reward_final_allocation_source_not_ready' });
    assert.equal(changed, true); assert.equal((await http(6)).status, 409);
    assert.deepEqual(await balances(), before); assert.deepEqual(await scalar(historySql), history);
    await confirm(987003); await publish(987004); assert.deepEqual((await run(6)).reasons, []);
  });
  await scenario('final prize source adapter rechecks revoked Auth after a real lock wait and rejects foreign draft access', async () => {
    const release = await lock(`select id from public.event_categories where id=${q(raceId)} for update`);
    const pending = assert.rejects(readFinalAllocationSourceV3(identity, scope(5), rpc), { code: 'reward_account_session_required' }); pending.catch(() => {});
    try { await waiting(1); await query(`update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${q(identity.sessionId)}`); }
    finally { await release(); } await pending;
    await query(`update auth.sessions set not_after=clock_timestamp()+interval '1 hour' where id=${q(identity.sessionId)}`);
    await assert.rejects(readFinalAllocationSourceV3(identity, { ...scope(5), draftId: id(999999) }, rpc), { code: 'reward_planning_not_found' });
    assert.deepEqual(await balances(), before); assert.deepEqual(await scalar(historySql), history);
  });
}
