import assert from "node:assert/strict";
import test from "node:test";
import { getOrganizerSportingSource, captureOrganizerSportingSource, previewOrganizerSportingReview,
  submitOrganizerSportingReview } from "../dist/features/rewards/organizer-sporting-service.js";
import { dispatchOrganizerRewardRoutes } from "../dist/routes/rewards/organizer.js";
import { getOrganizerSportingRecord } from "../dist/features/rewards/organizer-sporting-service.js";
import { recordFixture } from "./fixtures/reward-record.mjs";
import { verifyRewardRecordCandidate } from "../../../packages/domain/dist/rewards/index.js";
import { decodeRewardConfiguration, rewardRecordApprovalRequest } from "../../../packages/db/dist/rewards/index.js";
import { calculationFixture, rewardId as id } from "./fixtures/reward-calculation.mjs";

function fixture(pot = "race") {
  const f = calculationFixture(pot, 1, 10000n * 10n ** 18n), identity = { userId: f.actorId, sessionId: id(98600) },
    scope = { programmeId: f.context.programme.id, campaignId: f.campaignId, chainId: 31337 };
  f.context.review = null;
  const bundle = { ...scope, context: f.context, latestReviewId: null, latestRevision: 0, allocationId: null,
    names: [...new Map(f.source.rows.map(r => [r.canonicalAthleteId, { kind: "athlete", id: r.canonicalAthleteId, name: "Synthetic runner" }])).values(),
      { kind: "club", id: id(2000), name: "Synthetic club" }], recordApprovals: [] };
  const calls = [], saved = new Map();
  const rpc = async (name, args) => {
    calls.push({ name, args: structuredClone(args) });
    assert.equal(args.p_actor_user_id, identity.userId); assert.equal(args.p_actor_session_id, identity.sessionId);
    assert.equal(args.p_programme_id, scope.programmeId); assert.equal(args.p_campaign_id, scope.campaignId);
    if (name === "service_check_reward_operator_preparation") return { data: { ...scope }, error: null };
    if (name === "service_read_reward_operator_sporting_context") return { data: structuredClone(bundle), error: null };
    if (name === "service_capture_reward_operator_source") return { data: { ...scope, snapshotId: f.snapshotId, capturedAt: f.context.snapshot.capturedAt }, error: null };
    assert.equal(name, "service_record_reward_operator_sporting_review");
    const old = saved.get(args.p_idempotency_key);
    if (old) { assert.deepEqual(args.p_review, old.review); return { data: old.result, error: null }; }
    if (args.p_expected_revision !== bundle.latestRevision) return { data: null, error: { message: "reward_sporting_revision_changed" } };
    const result = { ...scope, snapshotId: f.snapshotId, reviewId: id(98700 + ++bundle.latestRevision),
      revision: bundle.latestRevision, reviewedAt: "2026-09-09T10:00:00Z" };
    bundle.latestReviewId = result.reviewId; saved.set(args.p_idempotency_key, { result, review: args.p_review });
    return { data: result, error: null };
  };
  const draft = () => ({ snapshotId: f.snapshotId, expectedRevision: bundle.latestRevision, review: structuredClone(f.review) });
  return { f, identity, scope, bundle, calls, saved, rpc, draft };
}
const confirm = (draft, preview, key = "synthetic-sporting-review") => ({ ...draft, previewDigest: preview.previewDigest, idempotencyKey: key, confirmReview: true });
const privateFields = /profileBirthYear|registrationBirthYear|dateOfBirth|sourceFingerprint|operatorUserId|sessionId|recordApprovals|signature|wallet/;

test("record lookup rederives a minimal historical baseline and rejects a tampered approval or expired session", async () => {
  const f = recordFixture(), identity = { userId: f.actorId, sessionId: id(98600) }, scope = { programmeId: f.context.programme.id, campaignId: f.campaignId, chainId: 31337 };
  const candidate = verifyRewardRecordCandidate({ ...f.input, roundId: f.context.campaign.scopeKey,
    priorSnapshot: f.priorSnapshot, targetSnapshot: f.context.snapshot, configuration: decodeRewardConfiguration(f.configuration) });
  const approvalId = id(61000), approval = { approvalId, campaignId: f.campaignId, targetSnapshotId: f.snapshotId, priorSnapshotId: f.priorSnapshot.snapshotId,
    revision: 1, approvedByUserId: f.actorId, approvedAt: "2026-06-02T13:00:00Z", body: rewardRecordApprovalRequest(candidate), priorSnapshot: f.priorSnapshot };
  let expired = false;
  const rpc = async (name, args) => {
    assert.equal(args.p_actor_session_id, identity.sessionId);
    if (name === "service_check_reward_operator_preparation") return expired ? { data: null, error: { message: "reward_account_session_required" } } : { data: scope, error: null };
    assert.equal(name, "service_read_reward_operator_sporting_context"); assert.deepEqual(args.p_record_approval_ids, [approvalId]);
    return { data: { ...scope, context: { ...f.context, review: null }, names: [], latestRevision: 0, latestReviewId: null, allocationId: null, recordApprovals: [structuredClone(approval)] }, error: null };
  };
  const input = { snapshotId: f.snapshotId, approvalId }, result = await getOrganizerSportingRecord(identity, scope, input, rpc);
  assert.equal(result.baseline.finishTimeMs, "1800000"); assert.equal(result.raceId, f.input.targetRaceId); assert.doesNotMatch(JSON.stringify(result), privateFields);
  expired = true; await assert.rejects(getOrganizerSportingRecord(identity, scope, input, rpc), { code: "reward_account_session_required" }); expired = false;
  approval.body.baseline.finishTimeMs = "1"; await assert.rejects(getOrganizerSportingRecord(identity, scope, input, rpc));
});

test("source capture requires explicit confirmation and returns metadata without approving, allocating or paying", async () => {
  const h = fixture(), input = { idempotencyKey: "synthetic-source-capture", confirmCapture: true };
  const a = await captureOrganizerSportingSource(h.identity, h.scope, input, h.rpc), b = await captureOrganizerSportingSource(h.identity, h.scope, input, h.rpc);
  assert.deepEqual(a, b); assert.equal(a.snapshotId, h.f.snapshotId); assert.doesNotMatch(JSON.stringify(a), privateFields);
  assert.ok(h.calls.every(c => c.name === "service_capture_reward_operator_source")); assert.equal(h.saved.size, 0);
  await assert.rejects(captureOrganizerSportingSource(h.identity, h.scope, { ...input, confirmCapture: false }, h.rpc), { code: "invalid_reward_sporting_request" });
});
test("source inspection exposes published facts and unknown membership without silently excluding walletless runners", async () => {
  const h = fixture(), view = await getOrganizerSportingSource(h.identity, h.scope, { snapshotId: null }, h.rpc), s = view.source;
  assert.equal(s.resultCount, 7); assert.equal(s.finishedCount, 6); assert.equal(s.uncertainMembershipCount, 1);
  assert.equal(s.budgetWei, String(1200n * 10n ** 18n)); assert.equal(s.classifications[0].maximumAgeHundredths, "1599");
  assert.equal(s.items[4].possibleClassificationIds.length, 3); assert.deepEqual(s.items[4].classificationIds, []);
  assert.equal(s.items[6].participationStatus, "dns"); assert.equal(s.items[6].finishTimeMs, null);
  assert.equal(s.items[0].athleteName, "Synthetic runner"); assert.equal(s.items[0].clubName, "Synthetic club");
  assert.doesNotMatch(JSON.stringify(view), privateFields); assert.equal(h.saved.size, 0);
  h.bundle.context = null; h.bundle.names = [];
  assert.equal((await getOrganizerSportingSource(h.identity, h.scope, { snapshotId: null }, h.rpc)).source, null);
});
test("source pagination pins 35 league rows and reports duplicate finishes without choosing a winner", async () => {
  const h = fixture("league"), reference = { snapshotId: h.f.snapshotId };
  const a = await getOrganizerSportingSource(h.identity, h.scope, reference, h.rpc);
  const b = await getOrganizerSportingSource(h.identity, h.scope, { ...reference, afterId: a.source.nextCursor }, h.rpc);
  assert.equal(a.source.items.length, 25); assert.equal(b.source.items.length, 10); assert.equal(b.source.nextCursor, null);
  assert.equal(new Set([...a.source.items, ...b.source.items].map(r => r.sourceId)).size, 35);
  await assert.rejects(getOrganizerSportingSource(h.identity, h.scope, { snapshotId: null, afterId: a.source.nextCursor }, h.rpc), { code: "invalid_reward_sporting_request" });
  const r = structuredClone(h.f.source.rows[0]); r.id = id(9000); r.registrationId = id(9001); h.f.source.rows.push(r);
  const dup = await getOrganizerSportingSource(h.identity, h.scope, reference, h.rpc);
  assert.equal(dup.source.duplicateGroupCount, 1); assert.equal(dup.source.items[0].sameAthleteRoundFinishCount, 2);
  await assert.rejects(previewOrganizerSportingReview(h.identity, h.scope, h.draft(), h.rpc), { code: "duplicate_athlete_round_requires_review" });
});
test("race and league drafts calculate exact server amounts, require confirmation and replay their original saved revision", async () => {
  for (const pot of ["race", "league"]) {
    const h = fixture(pot), draft = h.draft(), p = await previewOrganizerSportingReview(h.identity, h.scope, draft, h.rpc);
    assert.equal(p.selectedFinishCount, pot === "race" ? 6 : 30); assert.equal(h.saved.size, 0);
    assert.equal(BigInt(p.allocatedWei) + BigInt(p.unallocatedWei), BigInt(p.budgetWei));
    assert.equal(p.families.reduce((sum, f) => sum + BigInt(f.budgetWei), 0n), BigInt(p.budgetWei));
    assert.doesNotMatch(JSON.stringify(p), privateFields);
    const input = confirm(draft, p), first = await submitOrganizerSportingReview(h.identity, h.scope, input, h.rpc);
    const next = h.draft(), nextPreview = await previewOrganizerSportingReview(h.identity, h.scope, next, h.rpc);
    assert.equal((await submitOrganizerSportingReview(h.identity, h.scope, confirm(next, nextPreview, "synthetic-next-review"), h.rpc)).revision, 2);
    h.bundle.allocationId = id(99999);
    assert.deepEqual(await submitOrganizerSportingReview(h.identity, h.scope, input, h.rpc), first);
    await assert.rejects(previewOrganizerSportingReview(h.identity, h.scope, h.draft(), h.rpc), { code: "reward_campaign_allocation_already_reserved" });
  }
});
test("incomplete podium/membership reviews, changed preview/revision and absent consent never save", async () => {
  const h = fixture(), draft = h.draft(), p = await previewOrganizerSportingReview(h.identity, h.scope, draft, h.rpc);
  for (const [mutate, code] of [
    [d => d.review.roundReviews[0].memberships.pop(), "reward_membership_review_incomplete"],
    [d => d.review.roundReviews[0].podiums.pop(), "reward_podium_review_incomplete"],
    [d => d.review.roundReviews[0].podiums[3].entries.pop(), "reward_podium_members_missing"],
  ]) { const d = h.draft(); mutate(d); await assert.rejects(previewOrganizerSportingReview(h.identity, h.scope, d, h.rpc), { code }); }
  for (const [patch, code] of [[{ previewDigest: "0".repeat(64) }, "reward_sporting_preview_changed"], [{ confirmReview: false }, "invalid_reward_sporting_request"]])
    await assert.rejects(submitOrganizerSportingReview(h.identity, h.scope, { ...confirm(draft, p), ...patch }, h.rpc), { code });
  h.bundle.latestRevision = 1; h.bundle.latestReviewId = id(98701);
  await assert.rejects(previewOrganizerSportingReview(h.identity, h.scope, draft, h.rpc), { code: "reward_sporting_revision_changed" });
  await assert.rejects(submitOrganizerSportingReview(h.identity, h.scope, confirm(draft, p), h.rpc), { code: "reward_sporting_revision_changed" });
  assert.equal(h.saved.size, 0);
});
test("identity, scope and explicit decision are captured before awaiting, with a final session check on reads", async () => {
  const h = fixture(), d = h.draft(), p = await previewOrganizerSportingReview(h.identity, h.scope, d, h.rpc), input = confirm(d, p),
    identity = { ...h.identity }, scope = { ...h.scope };
  const result = await submitOrganizerSportingReview(identity, scope, input, async (name, args) => {
    identity.userId = id(9); scope.campaignId = id(9); input.review.roundReviews = []; input.idempotencyKey = "mutated-key";
    input.expectedRevision = 99; input.previewDigest = "0".repeat(64); input.confirmReview = false;
    return h.rpc(name, args);
  });
  assert.equal(result.campaignId, h.scope.campaignId); assert.ok(h.saved.has("synthetic-sporting-review"));
  for (const read of [() => getOrganizerSportingSource(h.identity, h.scope, { snapshotId: null }, revoked),
    () => previewOrganizerSportingReview(h.identity, h.scope, h.draft(), revoked)]) await assert.rejects(read(), { code: "reward_account_session_required" });
  async function revoked(name, args) { return name === "service_check_reward_operator_preparation"
    ? { data: null, error: { message: "reward_account_session_required", details: "private" } } : h.rpc(name, args); }
});
test("HTTP methods, query/body scope, sporting errors and private failure messages are strictly bounded", async () => {
  const h = fixture(), base = `/api/v1/organizer/rewards/programmes/${h.scope.programmeId}/campaigns/${h.scope.campaignId}/sources`;
  const run = async (path = "", method = "GET", body = null, rpc = h.rpc) => {
    const res = { status: 200 }; const handled = await dispatchOrganizerRewardRoutes({ method }, res, new URL(base + path, "http://localhost"), {
      config: () => ({ chainId: 31337, origin: "http://localhost" }), requireIdentity: async () => h.identity, readJsonBody: async () => body,
      applyPrivateSessionHeaders: r => { r.private = true; }, sendSuccess: (r, data) => { r.body = data; },
      sendError: (r, status, code) => { r.status = status; r.body = { error: { code } }; }, rpc,
    }); return { ...res, handled };
  };
  assert.equal((await run()).private, true); assert.equal((await run("", "POST")).handled, false);
  assert.equal((await run("/capture", "GET")).handled, false);
  for (const query of ["?chainId=143", "?after=" + id(1), `/${h.f.snapshotId}?after=${id(1)}&after=${id(2)}`]) assert.equal((await run(query)).status, 400);
  assert.equal((await run("/capture", "POST", { idempotencyKey: "synthetic-capture", confirmCapture: true })).status, 200);
  const { snapshotId, ...draft } = h.draft(), previewPath = `/${snapshotId}/review-preview`;
  const p = await run(previewPath, "POST", draft); assert.equal(p.status, 200);
  for (const body of [{ ...draft, amountWei: "1" }, { expectedRevision: 0 }, { ...draft, actorId: id(9) }]) assert.equal((await run(previewPath, "POST", body)).status, 400);
  const incomplete = structuredClone(draft); incomplete.review.roundReviews[0].memberships = [];
  assert.equal((await run(previewPath, "POST", incomplete)).status, 422);
  assert.equal((await run(`/${snapshotId}/reviews`, "POST", confirm(draft, p.body))).status, 200);
  for (const [message, status] of [["reward_account_session_required", 401], ["reward_operator_permission_required", 403],
    ["reward_preparation_scope_required", 404], ["reward_review_source_changed", 409], ["private database failure", 503]]) {
    const r = await run("", "GET", null, async () => ({ data: null, error: { message, details: "private query" } }));
    assert.equal(r.status, status); assert.doesNotMatch(JSON.stringify(r), /private query|private database failure/);
  }
});
