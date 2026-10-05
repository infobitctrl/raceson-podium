import assert from "node:assert/strict";
import test from "node:test";
import { captureRewardSourceSnapshot, readRewardSource, RewardSourceStoreError } from "../../../packages/db/dist/rewards/source-snapshots.js";

const id = (n) => `76000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = () => ({ organizationId: id(1), leagueSeasonId: id(2), roundIds: [id(4), id(3)], actorUserId: id(5) });
const source = () => ({ schemaVersion: 1, season: { id: id(2), organizationId: id(1) },
  rounds: [{ id: id(3) }, { id: id(4) }], mappings: [], competitions: [], classifications: [], adjudicationCases: [],
  rows: [{ finishTimeMs: "9007199254740993", sourceAthleteId: id(6), rankAgeCategory: null }] });
const snapshot = () => ({ snapshotId: id(7), capturedAt: "2026-09-08T00:00:00Z", sourceFingerprintSha256: "a".repeat(64), source: source() });
const input = () => ({ ...scope(), idempotencyKey: "review-capture-0001" });
const rejectsCode = (code, operation) => assert.rejects(operation, (error) => error instanceof RewardSourceStoreError && error.code === code);

test("reward evidence capture uses exactly one server RPC and no browser-supplied source body", async () => {
  const request = input(); const original = structuredClone(request); const expected = snapshot(); let calls = 0;
  const result = await captureRewardSourceSnapshot({ ...request, source: { fake: true } }, async (name, args) => {
    calls++;
    assert.equal(name, "service_capture_reward_source");
    assert.deepEqual(args, { p_organization_id: id(1), p_league_season_id: id(2), p_round_ids: [id(3), id(4)],
      p_actor_user_id: id(5), p_idempotency_key: request.idempotencyKey });
    return { data: expected, error: null };
  });
  assert.equal(calls, 1); assert.deepEqual(request, original); assert.deepEqual(result, expected);
  assert.equal(result.source.rows[0].finishTimeMs, "9007199254740993");
  assert.equal(result.source.rows[0].rankAgeCategory, null);
});

test("reading current evidence does not call the snapshot writer", async () => {
  const result = await readRewardSource(scope(), async (name) => {
    assert.equal(name, "service_read_reward_source"); return { data: source(), error: null };
  });
  assert.deepEqual(result, source());
});

test("a caller mutating its request during the RPC cannot change the response's expected scope", async () => {
  const request = input();
  const result = await captureRewardSourceSnapshot(request, async () => {
    request.leagueSeasonId = id(99); request.roundIds.splice(0);
    return { data: snapshot(), error: null };
  });
  assert.equal(result.source.season.id, id(2));
});

test("invalid reward source scope or idempotency never reaches the database", async () => {
  let called = false; const rpc = async () => { called = true; return { data: snapshot(), error: null }; };
  for (const patch of [{ actorUserId: "browser-identity" }, { roundIds: [] }, { roundIds: [id(3), id(3)] },
    { roundIds: [null] }, { organizationId: "00000000-0000-0000-0000-000000000000" }, { roundIds: [1, 2, 3, 4, 5, 6].map(id) }]) {
    await rejectsCode("invalid_reward_source_scope", () => captureRewardSourceSnapshot({ ...input(), ...patch }, rpc));
  }
  await rejectsCode("invalid_reward_capture_key", () => captureRewardSourceSnapshot({ ...input(), idempotencyKey: "short" }, rpc));
  assert.equal(called, false);
});

test("capture responses must match requested organization/season/rounds and schema version", async () => {
  for (const [code, edit] of [
    ["reward_source_response_scope_mismatch", (r) => { r.source.season.organizationId = id(99); }],
    ["reward_source_response_scope_mismatch", (r) => { r.source.season.id = id(99); }],
    ["reward_source_response_scope_mismatch", (r) => { r.source.rounds.pop(); }],
    ["reward_source_response_scope_mismatch", (r) => { r.source.rounds = [{ id: id(3) }, { id: id(3) }]; }],
    ["invalid_reward_source_response", (r) => { r.source.schemaVersion = 2; }],
    ["invalid_reward_source_response", (r) => { r.source.rows = [null]; }],
    ["invalid_reward_capture_response", (r) => { r.sourceFingerprintSha256 = "not-a-digest"; }],
    ["invalid_reward_capture_response", (r) => { r.capturedAt = "not-a-date"; }],
  ]) {
    const result = snapshot(); edit(result);
    await rejectsCode(code, () => captureRewardSourceSnapshot(input(), async () => ({ data: result, error: null })));
  }
});

test("database errors expose only approved error codes, never raw details or credentials", async () => {
  await rejectsCode("reward_source_permission_required", () => captureRewardSourceSnapshot(input(), async () => ({ data: null, error: { message: "reward_source_permission_required" } })));
  await rejectsCode("reward_source_store_failed", () => captureRewardSourceSnapshot(input(), async () => ({ data: null, error: { message: "synthetic private SQL detail" } })));
  await rejectsCode("reward_source_store_unavailable", () => captureRewardSourceSnapshot(input(), async () => { throw new Error("synthetic private connection detail"); }));
});
