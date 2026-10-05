import assert from "node:assert/strict";
import test from "node:test";
import { deriveLeagueParticipationMetrics } from "../../../packages/domain/dist/rewards/league-participation-metrics.js";
import { previewParticipationReward } from "../../../packages/domain/dist/rewards/participation-awards.js";
import { publishedSnapshot, id } from "./fixtures/published-reward-v2.mjs";

const hash = "b".repeat(64);
const review = () => ({ version: 1, sourceHash: hash, duplicates: [], confirmedUnaffiliatedResultIds: [] });
const rule = (metric = "athlete_finishes", method = "proportional", prizeSharesBps = []) => ({ metric, method, minimumFinishes: 1, prizeSharesBps });
const project = (source = publishedSnapshot()) => deriveLeagueParticipationMetrics(source, hash);

test("contribution estimates conserve indivisible units and never authorize a historical payout", () => {
  const result = previewParticipationReward(project(), review(), rule(), 100n);
  assert.deepEqual(result.awards.map(a => a.amountWei), [34n, 33n, 33n]);
  assert.equal(result.totalWeight, 12n); assert.equal(result.proposedWei, 100n);
  assert.equal(result.retainedWei, 0n); assert.equal(result.payableWei, 0n);
  assert.equal(result.state, "unapproved_progress_estimate");
  assert.equal(result.availableRounds, 4); assert.equal(result.plannedRounds, 5);
  const reversed = publishedSnapshot(); reversed.results.reverse();
  assert.deepEqual(previewParticipationReward(project(reversed), review(), rule(), 100n), result);
});

test("ranked cutoff ties share occupied slots, including tied candidates beyond the cutoff", () => {
  const source = publishedSnapshot();
  source.results[9].participationStatus = "dns";
  source.results[10].participationStatus = "dns";
  const result = previewParticipationReward(project(source), review(), rule("athlete_finishes", "ranked", [6000, 4000]), 25n);
  assert.deepEqual(result.awards.map(a => [a.beneficiaryId, a.place, a.amountWei]), [
    [id(12), 1, 15n], [id(10), 2, 5n], [id(11), 2, 5n],
  ]);
  const allTied = previewParticipationReward(project(), review(), rule("athlete_finishes", "ranked", [6000, 4000]), 25n);
  assert.deepEqual(allTied.awards.map(a => a.amountWei), [9n, 8n, 8n]);
});

test("missing distance holds metre pools without erasing otherwise verified finish estimates", () => {
  const source = publishedSnapshot(); source.catalogue.rounds[0].races[0].distanceMetres = null;
  assert.equal(previewParticipationReward(project(source), review(), rule(), 100n).proposedWei, 100n);
  const result = previewParticipationReward(project(source), review(), rule("athlete_metres"), 100n);
  assert.equal(result.proposedWei, 0n); assert.equal(result.retainedWei, 100n); assert.equal(result.totalWeight, null);
  assert.ok(result.unresolved.every(i => i.code === "missing_distance"));
});

test("represented clubs receive only their race contributions after null memberships are explicitly reviewed", () => {
  const source = publishedSnapshot();
  source.results[0].clubId = id(90); source.results[0].clubName = "First club";
  source.results[3].clubId = id(91); source.results[3].clubName = "Later club";
  const metrics = project(source), decisions = review();
  assert.equal(previewParticipationReward(metrics, decisions, rule("club_metres"), 101n).totalWeight, null);
  decisions.confirmedUnaffiliatedResultIds = source.results.filter(r => r.clubId === null).map(r => r.id);
  const result = previewParticipationReward(metrics, decisions, rule("club_metres"), 101n);
  assert.equal(result.totalWeight, 10000n);
  assert.deepEqual(result.awards.map(a => [a.beneficiaryId, a.amountWei]), [[id(90), 51n], [id(91), 50n]]);
  assert.deepEqual(result.awards[0].resultIds, [source.results[0].id]);
});

test("conflicting finishes hold the entire pool until an exact source-bound sporting decision", () => {
  const source = publishedSnapshot(); source.results[1].athleteId = source.results[0].athleteId;
  const metrics = project(source), decisions = review();
  assert.equal(previewParticipationReward(metrics, decisions, rule(), 100n).awards.length, 0);
  const issue = metrics.issues.find(i => i.code === "duplicate_athlete_round");
  decisions.duplicates.push({ round: issue.round, athleteId: issue.athleteId, resultIds: issue.resultIds,
    keepResultId: source.results[0].id, reason: "Synthetic review confirms the selected start" });
  const result = previewParticipationReward(metrics, decisions, rule(), 110n);
  assert.equal(result.totalWeight, 11n); assert.equal(result.proposedWei, 110n);
  assert.deepEqual(result.excludedResultIds, [source.results[1].id]);
  assert.deepEqual(result.awards.map(a => a.amountWei), [40n, 40n, 30n]);
  const stale = structuredClone(decisions); stale.sourceHash = "c".repeat(64);
  assert.throws(() => previewParticipationReward(metrics, stale, rule(), 100n));
  const incomplete = structuredClone(decisions); incomplete.duplicates[0].resultIds.pop();
  assert.throws(() => previewParticipationReward(metrics, incomplete, rule(), 100n));
});

test("minimum finishes is athlete eligibility, and empty or unfilled pools retain their budgets", () => {
  const source = publishedSnapshot();
  source.results.filter(r => r.athleteId !== id(10)).forEach(r => r.participationStatus = "dnf");
  const one = previewParticipationReward(project(source), review(), rule("athlete_finishes", "ranked", [6000, 4000]), 25n);
  assert.equal(one.proposedWei, 15n); assert.equal(one.retainedWei, 10n);
  const empty = previewParticipationReward(project(source), review(), { ...rule(), minimumFinishes: 5 }, 25n);
  assert.equal(empty.awards.length, 0); assert.equal(empty.totalWeight, 0n); assert.equal(empty.retainedWei, 25n);
});

test("category classification does not restrict unrestricted participation estimates", () => {
  const source = publishedSnapshot(); source.results.forEach(r => r.classificationIds = []);
  assert.equal(previewParticipationReward(project(source), review(), rule("athlete_metres"), 100n).proposedWei, 100n);
});

test("invalid rule methods, prize shares, review decisions and budgets are refused", () => {
  for (const badRule of [rule("manual"), rule("athlete_finishes", "unknown"), rule("athlete_finishes", "ranked"),
    rule("athlete_finishes", "ranked", [5000]), rule("athlete_finishes", "proportional", [10000]), { ...rule(), minimumFinishes: 0 }]) {
    assert.throws(() => previewParticipationReward(project(), review(), badRule, 100n));
  }
  assert.throws(() => previewParticipationReward(project(), review(), rule(), -1n));
  assert.throws(() => previewParticipationReward(project(), { ...review(), confirmedUnaffiliatedResultIds: [id(999)] }, rule(), 100n));
});
