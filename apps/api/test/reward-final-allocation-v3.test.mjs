import assert from 'node:assert/strict';
import test from 'node:test';
import { buildFinalAllocationDocumentV3 as build, decodeFinalAllocationDocumentV3 as decode, finalAllocationReasonsV3 } from '../../../packages/domain/dist/rewards/final-allocation-document-v3.js';
import { decodeAllocationDocumentV3 } from '../../../packages/domain/dist/rewards/allocation-approval-v3.js';
import { proposeRoundClubStandingsV3, proposeLeagueStandingsV3 } from '../../../packages/domain/dist/rewards/league-standings-v3.js';
import { allocationDocumentHashV3 as hash } from '../../../packages/db/dist/rewards/index.js';
import { previewNativeFinaleContinuityV3 } from '../dist/features/rewards/native-finale-continuity-service.js';
import { leaguePolicyContextV3 } from '../dist/features/rewards/league-policy-v3-service.js';
import { buildLeaguePublicationDocumentV3, publishedLeagueSourceV3 } from '../dist/features/rewards/league-publication-v3-service.js';
import { readFinalAllocationSourceV3 } from '../dist/features/rewards/final-allocation-v3-service.js';
import { dispatchFinalAllocationV3 } from '../dist/routes/rewards/final-allocation-v3.js';
import { nativeContinuityFixture } from './fixtures/native-finale-continuity-v3.mjs';
import { nativeId as id } from './fixtures/native-finale-v3.mjs';
const mon = 10n ** 18n;
const json = v => JSON.parse(JSON.stringify(v, (_, x) => typeof x === 'bigint' ? x.toString() : x));
function fixture(slot = 5) {
  const f = nativeContinuityFixture();
  f.review = { id: id(900), contextHash: previewNativeFinaleContinuityV3(f).contextHash, selection: f.selection,
    decision: 'confirmed', reviewedAt: '2026-09-10T04:45:00.000Z' };
  const native = previewNativeFinaleContinuityV3(f), context = leaguePolicyContextV3(f);
  const policyReview = { id: id(901), previousReviewId: null, contextHash: hash(context), decision: 'selected', reviewedAt: '2026-09-10T04:50:00.000Z',
    policy: { schema: 'raceson-league-scoring-policy-v3', categories: f.workspace.catalogue.categories.filter(c => c.target === 'individual')
      .map(c => ({ categoryId: c.id, points: [100, 80, 60], participationPoints: 1, bestN: 4, minimumRounds: 2, tieBreak: 'best_finish' })),
      club: { categoryId: f.workspace.catalogue.categories.find(c => c.target === 'club').id, membersPerRound: 3 } } };
  let source = native.source, review = { kind: 'native_finale', guardHash: 'b'.repeat(64), continuityReviewId: f.review.id,
    continuityContextHash: native.contextHash, continuityCommitment: native.commitment, reviewedAt: f.review.reviewedAt, policyReview };
  if (slot === 6) {
    const document = buildLeaguePublicationDocumentV3(context, policyReview, source);
    const publication = { id: id(902), draftId: f.record.draftId, previousPublicationId: null, sourceGuardHash: 'c'.repeat(64),
      documentHash: hash(document), document, decision: 'published', publishedAt: '2026-09-10T05:00:00.000Z',
      publishedByUserId: id(903), evidenceHash: 'd'.repeat(64) };
    source = publishedLeagueSourceV3(publication);
    review = { kind: 'published_league', guardHash: publication.sourceGuardHash, publicationId: publication.id,
      publicationDocumentHash: publication.documentHash, evidenceHash: publication.evidenceHash, publishedAt: publication.publishedAt };
  }
  const binding = { intentId: id(904), fundingApprovalId: id(905), programmeAddress: `0x${'1'.repeat(40)}`,
    campaignAddress: `0x${String(slot).repeat(40)}`, deploymentTransactionHash: `0x${'2'.repeat(64)}`, programmeId: `0x${'3'.repeat(64)}`,
    campaignId: `0x${String(slot).repeat(64)}`, programmeManifestHash: `0x${'4'.repeat(64)}`, reviewSeconds: 86400, fundingContextHash: 'e'.repeat(64) };
  return { ...f, source, sourceReview: review, binding, policy: policyReview.policy };
}
const document = f => build(f.record, f.workspace, f.source, f.sourceReview, f.binding);
test('synthetic final pots retain their evidence label and reject mixed real evidence', () => {
  for (const slot of [5, 6]) {
    const f = fixture(slot);
    f.source.kind = 'synthetic_rehearsal';
    for (const r of f.source.rounds) if (r.evidence) r.evidence.kind = 'synthetic';
    for (const t of f.source.standings) t.evidence.kind = 'synthetic';
    if (f.source.league) f.source.league.evidence.kind = 'synthetic';
    const d = document(f); conserved(d);
    assert.deepEqual(finalAllocationReasonsV3(d), []);
    assert.deepEqual(decode(json(d)), d);
    assert.equal(d.source.kind, 'synthetic_rehearsal');
    assert.equal(d.source.rounds[4].evidence.kind, 'synthetic');
    assert.ok(d.recipients.length > 0);
    f.source.rounds[4].evidence.kind = 'native_final';
    assert.throws(() => document(f), 'synthetic inputs cannot contain real evidence');
  }
  const real = fixture();
  real.source.rounds[4].evidence.kind = 'synthetic';
  assert.throws(() => document(real), 'real inputs cannot contain synthetic evidence');
});
function conserved(d) {
  assert.equal(d.calculation.budgetWei, d.calculation.proposedWei + d.calculation.retainedWei);
  assert.equal(d.recipients.reduce((n, r) => n + r.amountWei, 0n), d.calculation.proposedWei);
  assert.equal(new Set(d.recipients.map(r => `${r.beneficiaryKind}:${r.beneficiaryId}`)).size, d.recipients.length);
  assert.ok(d.recipients.every(r => r.amountWei > 0n));
}
test('round 5 derives club prizes from selected scoring and retains all athlete identities without wallet inputs', () => {
  const f = fixture(), before = structuredClone(f), d = document(f); conserved(d);
  assert.deepEqual(f, before); assert.equal(d.schema, 'raceson-allocation-document-v3.2');
  assert.equal(d.slot, 5); assert.equal(d.enabledPot, 0); assert.equal(d.calculation.budgetWei, 10000n * mon);
  assert.deepEqual(finalAllocationReasonsV3(d), []); assert.deepEqual(decode(json(d)), d);
  assert.equal(d.calculation.families.find(f => f.key === 'athlete_standings').categories.length, 7);
  assert.ok(d.recipients.some(r => r.beneficiaryKind === 'club'));
  assert.ok(d.recipients.some(r => r.beneficiaryKind === 'athlete' && r.beneficiaryId === id(202)), 'unclaimed newcomer keeps share');
  assert.equal(d.source.league, null); assert.ok(d.source.rounds.slice(0, 4).every(r => !r.evidence && !r.results.length));
  assert.ok(d.clubProposal.table.rows.every(r => r.points === r.contributions.filter(c => c.counted).reduce((n, c) => n + c.points, 0)));
  assert.doesNotMatch(JSON.stringify(json(d)), /athleteName|clubName|wallet|privateKey|dateOfBirth|claimedBy/);
});
test('race club calculation is independent of league closure, earlier holds and league minimum-round eligibility', () => {
  const f = fixture(), before = document(f);
  const full = proposeLeagueStandingsV3(f.source, f.policy).clubTables.find(t => t.slot === 5);
  assert.deepEqual(proposeRoundClubStandingsV3(f.source, f.policy, 5).table, full);
  f.source.rounds[0].evidence.held = true; f.source.rounds[1].resultsComplete = false; f.source.league = null;
  assert.equal(proposeLeagueStandingsV3(f.source, f.policy).state, 'held');
  assert.deepEqual(proposeRoundClubStandingsV3(f.source, f.policy, 5).table, full);
  assert.equal(hash(document(f)), hash(before));
  f.policy.categories.forEach(c => { c.bestN = 5; c.minimumRounds = 5; });
  assert.deepEqual(proposeRoundClubStandingsV3(f.source, f.policy, 5).table, full);
  for (const slot of [0, 6, 1.5]) assert.throws(() => proposeRoundClubStandingsV3(f.source, f.policy, slot));
});
test('supplied club table, unrelated sources and refresh times cannot replace round scoring or churn its document', () => {
  const f = fixture(), expected = hash(document(f)), table = structuredClone(document(f).source.standings.find(t => t.categoryId === f.policy.club.categoryId));
  table.rows.reverse(); table.rows[0].rank = 99; f.source.standings.push(table);
  f.source.capturedAt = '2026-10-04T00:00:00.000Z'; f.workspace.catalogueHash = 'f'.repeat(64);
  assert.equal(hash(document(f)), expected);
  const old = document(f).calculation.families.find(x => x.key === 'club_standings').proposedWei;
  f.sourceReview.policyReview.policy.club.membersPerRound = 1;
  assert.notEqual(hash(document(f)), expected); assert.ok(document(f).calculation.families.find(x => x.key === 'club_standings').proposedWei > 0n);
  assert.ok(old > 0n);
});
test('league document aggregates category prizes and kilometre participation once per athlete and uses league pot 1', () => {
  const f = fixture(6), d = document(f); conserved(d); assert.deepEqual(decode(json(d)), d);
  assert.equal(d.slot, 6); assert.equal(d.enabledPot, 1); assert.equal(d.calculation.budgetWei, 50000n * mon);
  assert.deepEqual(finalAllocationReasonsV3(d), []); assert.equal(d.source.rounds.length, 5);
  assert.ok(d.source.standings.every(t => t.slot === null));
  const newcomer = d.recipients.find(r => r.beneficiaryId === id(202));
  assert.ok(newcomer); assert.equal(newcomer.amountWei, d.calculation.participation.awards.find(r => r.beneficiaryId === id(202)).amountWei,
    'minimum-round exclusion from league standings does not remove earned participation');
  assert.equal(d.calculation.participation.awards.find(r => r.beneficiaryId === id(202)).finishes, 1);
  f.source.capturedAt = '2026-10-04T00:00:00.000Z'; assert.equal(hash(document(f)), hash(d));
});
test('unresolved source and missing distance retain money and block approval readiness rather than substitute denominators', () => {
  const f = fixture(6); f.source.rounds[0].results[0].distanceMetres = null;
  const d = document(f); conserved(d); assert.ok(finalAllocationReasonsV3(d).includes('unresolved_results'));
  assert.equal(d.calculation.participation.proposedWei, 0n); assert.equal(d.calculation.participation.retainedWei, d.calculation.participation.budgetWei);
  assert.ok(d.calculation.families.some(f => f.proposedWei > 0n));
  for (const edit of [f => f.source.rounds[4].evidence.held = true, f => f.source.rounds[4].resultsComplete = false,
    f => f.source.standings.find(t => t.slot === 5 && t.rows.length).rows[0].rank = 2]) {
    const f = fixture(); edit(f); const d = document(f); conserved(d); assert.ok(finalAllocationReasonsV3(d).includes('unresolved_results'));
  }
  const noFunding = fixture(); noFunding.binding = null; assert.ok(finalAllocationReasonsV3(document(noFunding)).includes('funding_required'));
});
test('new document decoder refuses altered recipients, pot, calculations, evidence, club contributions and extra authority fields', () => {
  for (const slot of [5, 6]) {
    const original = json(document(fixture(slot)));
    for (const edit of [d => d.enabledPot = 1 - d.enabledPot, d => d.slot = 1, d => d.recipients[0].amountWei = '1',
      d => d.calculation.retainedWei = '1', d => d.binding.walletKey = 'never', d => d.approved = true, d => d.schema = 'raceson-allocation-document-v3.1']) {
      const bad = structuredClone(original); edit(bad); assert.throws(() => decode(bad));
    }
    assert.throws(() => decodeAllocationDocumentV3(original), 'historical decoder remains isolated');
  }
  const round = json(document(fixture())); round.clubProposal.table.rows[0].contributions[0].points++; assert.throws(() => decode(round));
  for (const edit of [f => f.sourceReview.continuityCommitment = '9'.repeat(64), f => f.sourceReview.policyReview.decision = 'held',
    f => f.sourceReview.reviewedAt = '2026-09-01T00:00:00.000Z']) { const f = fixture(); edit(f); assert.throws(() => document(f)); }
  const league = fixture(6); league.sourceReview.evidenceHash = '9'.repeat(64); assert.throws(() => document(league));
});
test('final allocation HTTP is read-only, requires current Auth, excludes browser inputs and sanitizes private failures', async () => {
  const run = async ({ method = 'GET', slot = 5, query = '', authError, rpcError = 'private-secret-sentinel' } = {}) => {
    const res = {}, calls = [];
    const handled = await dispatchFinalAllocationV3({ method }, res, new URL(`http://127.0.0.1:3101/api/v1/organizer/rewards/drafts/${id(1)}/final-allocation/${slot}${query}`), {
      config: () => ({ chainId: 31337 }), requireIdentity: async () => { if (authError) throw Error(authError); return { userId: id(2), sessionId: id(3) }; },
      rpc: async (name, args) => { calls.push({ name, args }); return { data: null, error: { message: rpcError } }; },
      readJsonBody: async () => { throw Error('must not read body'); }, applyPrivateSessionHeaders: () => res.private = true,
      sendSuccess: (_, data) => Object.assign(res, { status: 200, data }), sendError: (_, status, code) => Object.assign(res, { status, code }),
    }); return { res, calls, handled };
  };
  for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) assert.equal((await run({ method })).handled, false);
  for (const slot of [0, 1, 4, 7]) assert.equal((await run({ slot })).handled, false);
  for (const query of ['?chainId=143', '?amountWei=1', '?wallet=0x123', '?source=%7B%7D']) {
    const r = await run({ query }); assert.equal(r.res.status, 400); assert.equal(r.calls.length, 0);
  }
  for (const authError of ['Unauthorized', 'Missing bearer token', 'reward_account_session_required']) {
    const r = await run({ authError }); assert.equal(r.res.status, 401); assert.equal(r.calls.length, 0);
  }
  assert.equal((await run({ authError: 'Untrusted browser origin' })).res.status, 403);
  assert.equal((await run({ rpcError: 'reward_planning_not_found' })).res.status, 404);
  assert.equal((await run({ rpcError: 'reward_planning_revision_changed' })).res.status, 409);
  for (const slot of [5, 6]) { const r = await run({ slot }); assert.equal(r.res.status, 503); assert.equal(r.res.private, true);
    assert.doesNotMatch(JSON.stringify(r.res), /private-secret/); }
});
test('private final-source adapter rejects unsupported chain and historical scopes before database IO', async () => {
  for (const patch of [{ chainId: 143 }, { slot: 1 }, { slot: 4 }, { slot: 7 }, { slot: 5.5 }]) {
    let called = false;
    await assert.rejects(readFinalAllocationSourceV3({ userId: id(1), sessionId: id(2) }, { chainId: 31337, draftId: id(3), slot: 5, ...patch },
      async () => { called = true; throw Error('never'); })); assert.equal(called, false);
  }
});
