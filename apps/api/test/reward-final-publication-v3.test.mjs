import assert from 'node:assert/strict';
import test from 'node:test';
import { buildFinalPublicationEvidenceV3 as build, decodeFinalPublicationEvidenceV3 as decode, finalPublicationBindingV3 }
  from '../../../packages/domain/dist/rewards/final-publication-v3.js';
import { allocationDocumentHashV3 as hash, finalPublicationFactsV3 } from '../../../packages/db/dist/rewards/index.js';
import { dispatchFinalPublicationV3 } from '../dist/routes/rewards/final-publication-v3.js';
const id = n => `8c000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actor = { userId: id(1), sessionId: id(2) };
const scope = { chainId: 31337, draftId: id(3), slot: 5, approvalId: id(4), uploadId: id(5) };
function fixture(slot = 5, reviewPeriod = '1') {
  const sourceReview = slot === 6 ? { kind: 'published_league', guardHash: 'a'.repeat(64), publicationId: id(10),
    publicationDocumentHash: 'b'.repeat(64), evidenceHash: 'c'.repeat(64), publishedAt: '2026-09-10T11:30:00.000Z' }
    : { kind: 'native_finale', guardHash: 'a'.repeat(64), continuityReviewId: id(10), continuityContextHash: 'b'.repeat(64),
      continuityCommitment: 'c'.repeat(64), reviewedAt: '2026-09-10T11:00:00.000Z', policyReview: { id: id(11), previousReviewId: null,
        contextHash: 'd'.repeat(64), decision: 'selected', reviewedAt: '2026-09-10T11:00:00.000Z', policy: {
          schema: 'raceson-league-scoring-policy-v3', categories: [{ categoryId: id(12), points: [100, 80, 60], participationPoints: 1,
            bestN: 4, minimumRounds: 2, tieBreak: 'best_finish' }], club: { categoryId: id(13), membersPerRound: 3 } } } };
  return { ...scope, slot, contextHash: 'd'.repeat(64), documentHash: 'e'.repeat(64), packageHash: 'f'.repeat(64), sourceReview,
    reviewPeriod, finalRoundReviewPeriod: '1', nativeRaces: [0, 1].map(i => ({ raceId: id(20 + i), competitionId: id(30 + i),
      policyId: id(40 + i), reviewSeconds: '1', configuredAt: '2026-09-09T10:00:00.000Z', startedByPublicationId: id(50 + i),
      startedAt: `2026-09-10T10:00:0${i}.999999+00:00`, endsAt: `2026-09-10T10:00:0${i + 1}.999999+00:00`,
      finalPublicationId: id(60 + i), officialPublishedAt: `2026-09-10T10:00:0${i + 1}.999999+00:00` })) };
}
test('final native/league clocks reference completed source review, never a fresh countdown', () => {
  const race = build(fixture()), league = build(fixture(6)), zero = build(fixture(6, '0'));
  assert.equal(race.clockKind, 'native_round_review'); assert.equal(league.clockKind, 'final_round_review');
  assert.equal(race.reviewStartedAt, league.reviewStartedAt);
  assert.equal(BigInt(race.officialPublishedAt) - BigInt(race.reviewStartedAt), 1n, 'microsecond boundaries retain the completed integer interval');
  assert.equal(zero.clockKind, 'explicit_zero_league_review'); assert.equal(zero.reviewStartedAt, zero.officialPublishedAt);
  assert.equal(zero.finalRoundReviewPeriod, '1', 'explicit zero never erases the race review');
  for (const d of [race, league, zero]) {
    assert.deepEqual(decode(d), d);
    const binding = finalPublicationBindingV3(id(70), hash(d), d);
    assert.equal(binding.publicationEvidenceHash, '0x' + hash(d)); assert.equal(binding.reviewId, id(70));
  }
  const reversed = fixture(); reversed.nativeRaces.reverse(); assert.equal(hash(build(reversed)), hash(race));
});
test('mismatched funded policies cannot be made compatible by shortening or replacing source clocks', () => {
  for (const input of [fixture(5, '0'), fixture(5, '86400'), fixture(6, '2'), { ...fixture(), finalRoundReviewPeriod: '0' }])
    assert.throws(() => build(input), /reward_final_review_policy_mismatch/);
  for (const change of [r => r.reviewSeconds = '0', r => r.endsAt = r.startedAt, r => r.officialPublishedAt = r.startedAt,
    r => r.policyId = id(40), r => r.configuredAt = '2026-10-01T00:00:00.000Z']) {
    const f = fixture(); change(f.nativeRaces[1]); assert.throws(() => build(f));
  }
});
test('strict final evidence refuses forged summary timestamps, extra secrets and executable serializers', () => {
  for (const mutate of [d => d.chainId = 143, d => d.slot = 4, d => d.clockKind = 'explicit_zero_league_review',
    d => d.reviewStartedAt = '1', d => d.officialPublishedAt = '1', d => d.reviewPeriod = '01', d => d.privateKey = 'forbidden',
    d => d.nativeRaces[0].wallet = 'forbidden', d => d.nativeRaces.push(d.nativeRaces[0])]) {
    const d = build(fixture()); mutate(d); assert.throws(() => decode(d));
  }
  let ran = false; const d = build(fixture());
  Object.defineProperty(d.nativeRaces, '0', { enumerable: true, get() { ran = true; return {}; } });
  assert.throws(() => decode(d)); assert.equal(ran, false);
});
test('final publication repository refuses wrong scopes and preserves only safe database errors', async () => {
  for (const patch of [{ chainId: 143 }, { slot: 4 }, { slot: 7 }, { uploadId: 'unknown' }])
    await assert.rejects(finalPublicationFactsV3(actor, { ...scope, ...patch }, undefined, () => assert.fail('invalid scope must not query')));
  await assert.rejects(finalPublicationFactsV3(actor, scope, undefined, async () => ({ error: { message: 'private provider response' } })),
    { code: 'reward_ledger_unavailable' });
  for (const message of ['reward_final_publication_conflict', 'reward_final_review_policy_mismatch', 'reward_account_session_required'])
    await assert.rejects(finalPublicationFactsV3(actor, scope, undefined, async () => ({ error: { message } })), { code: message });
});
test('final publication HTTP rejects caller clocks, scope/query drift and untrusted origins before private writes', async () => {
  const run = async ({ slot = 5, method = 'GET', query = '', body, authError, error } = {}) => {
    const res = {}, calls = [];
    const handled = await dispatchFinalPublicationV3({ method }, res,
      new URL(`http://127.0.0.1:3101/api/v1/organizer/rewards/drafts/${scope.draftId}/final-publication/${slot}/${scope.approvalId}/${scope.uploadId}${query}`), {
        config: () => ({ chainId: 31337 }), requireIdentity: async () => { if (authError) throw Error(authError); return actor; },
        applyPrivateSessionHeaders: () => res.private = true, readJsonBody: async () => body,
        sendSuccess: (_, data) => Object.assign(res, { status: 200, data }), sendError: (_, status, code) => Object.assign(res, { status, code }),
        rpc: async (name, args) => { calls.push({ name, args }); return { data: null, error: { message: error ?? 'reward_final_publication_not_ready' } }; },
      });
    return { handled, res, calls };
  };
  for (const slot of [5, 6]) {
    assert.equal((await run({ slot })).res.status, 409);
    assert.equal((await run({ slot, authError: 'Unauthorized' })).res.status, 401);
    assert.equal((await run({ slot, authError: 'Untrusted browser origin' })).res.status, 403);
    for (const body of [{ reviewStartedAt: '1' }, { requestId: id(90), contextHash: 'a'.repeat(64), packageHash: 'b'.repeat(64), evidenceHash: 'c'.repeat(64), reviewSeconds: 0 }]) {
      const r = await run({ slot, method: 'POST', body }); assert.equal(r.res.status, 400); assert.equal(r.calls.length, 0);
    }
  }
  assert.equal((await run({ query: '?chainId=143' })).res.status, 400);
  for (const slot of [0, 4, 7]) assert.equal((await run({ slot })).handled, false);
  for (const method of ['DELETE', 'PATCH']) assert.equal((await run({ method })).handled, false);
  const failed = await run({ error: 'private provider response' }); assert.equal(failed.res.status, 503); assert.equal(failed.res.private, true);
  assert.doesNotMatch(JSON.stringify(failed.res), /private provider response/);
});
