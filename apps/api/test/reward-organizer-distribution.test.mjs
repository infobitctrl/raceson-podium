import assert from "node:assert/strict";
import test from "node:test";
import { decodeRewardCampaigns, decodeRewardAwardPage, decodeRewardAwardDetail } from "@raceson/domain/rewards";
import { listRewardOperatorCampaigns, listRewardOperatorAwards, readRewardOperatorAward } from "@raceson/db/rewards";
import { dispatchOrganizerRewardRoutes } from "../dist/routes/rewards/organizer.js";
import { distributionFixture } from "./fixtures/reward-distribution.mjs";
import { rewardId as id } from "./fixtures/reward-calculation.mjs";

const endpoint = f => `/api/v1/organizer/rewards/programmes/${f.scope.programmeId}/campaigns`;
const awardPath = f => `${endpoint(f)}/${f.allocation.campaignId}/allocations/${f.allocation.allocationId}/awards`;
async function http(f, kind = "campaigns", overrides = {}) {
  const res = { status: 200, body: null, private: false }, calls = [];
  const handled = await dispatchOrganizerRewardRoutes({ method: overrides.method ?? "GET" }, res,
    new URL(overrides.path ?? (kind === "campaigns" ? endpoint(f) : `${awardPath(f)}${kind === "detail" ? `/${f.selected.entitlementId}` : ""}`), "http://127.0.0.1:3101"), {
      config: () => ({ chainId: 31337, origin: "http://127.0.0.1:3101" }),
      requireIdentity: async () => { if (overrides.authError) throw Error(overrides.authError); return f.identity; },
      readJsonBody: async () => { throw Error("Read-only route must not read a body"); },
      applyPrivateSessionHeaders: r => { r.private = true; }, sendSuccess: (r, body) => { r.body = body; },
      sendError: (r, status, code) => { r.status = status; r.body = { error: { code } }; },
      rpc: async (method, args) => { calls.push({ method, args }); return { data: f[kind === "awards" ? "page" : kind], error: overrides.error ? { message: overrides.error } : null }; },
    });
  return { ...res, handled, calls };
}
test("distribution whitelist preserves all six campaign budgets and exact saved sporting detail without payment claims", async () => {
  const f = distributionFixture();
  assert.deepEqual(decodeRewardCampaigns(f.campaigns, f.scope), f.campaigns);
  assert.deepEqual(decodeRewardAwardPage(f.page, f.allocation), f.page);
  assert.deepEqual(decodeRewardAwardDetail(f.detail, f.selected), f.detail);
  for (const kind of ["campaigns", "awards", "detail"]) {
    const result = await http(f, kind); assert.equal(result.status, 200); assert.equal(result.handled, true); assert.equal(result.private, true);
    assert.deepEqual(result.body, f[kind === "awards" ? "page" : kind]);
    assert.equal(result.calls.length, 1); assert.equal(result.calls[0].args.p_actor_user_id, f.identity.userId);
    assert.equal(result.calls[0].args.p_actor_session_id, f.identity.sessionId);
    assert.doesNotMatch(JSON.stringify(result.body), /signature|snapshotSalt|explanationSalt|dateOfBirth|birthYear|sessionId|operatorAddress|walletAddress|funded|paid|isClaimed/);
  }
});
test("campaign projection rejects incomplete, reordered, cross-network and non-conserving records", () => {
  for (const mutate of [d => d.items.pop(), d => d.items.reverse(), d => { d.items[1].roundNumber = 1; },
    d => { d.items[1].scopeKey = d.items[0].scopeKey; }, d => { d.items[1].campaignId = d.items[0].campaignId; },
    d => { d.chainId = 10143; }, d => { d.programmeId = id(999); }, d => { d.budgetWei = "1"; },
    d => { d.items[0].allocation.allocatedWei = "1"; }, d => { d.items[0].allocation.awardCount = 0; },
    d => { d.items[0].budgetWei = 1200; }, d => { d.items[0].allocation.reservedAt = "yesterday"; },
    d => { d.items[0].allocation.snapshotSalt = "private"; }, d => { d.items[5].raceName = "Foreign race"; }]) {
    const f = distributionFixture(); mutate(f.campaigns); assert.throws(() => decodeRewardCampaigns(f.campaigns, f.scope));
  }
});
test("award detail rejects leaked fields, altered totals, foreign beneficiaries and unsupported calculation methods", () => {
  for (const mutate of [d => { d.entitlementId = id(999); }, d => { d.allocationId = id(999); }, d => { d.campaignId = id(999); },
    d => { d.amountWei = "1"; }, d => { d.breakdown[0].amountWei = "01"; }, d => { d.breakdown[0].amountWei = 1; },
    d => { d.breakdown[0].calculation.privateProof = "private"; }, d => { d.breakdown[0].sourceIds = [id(1)]; },
    d => { d.breakdown[0].calculation.method = "arbitrary"; }, d => { d.breakdown[0].calculation.prizeSlots = [1, 1]; },
    d => { d.breakdown[1].calculation.finishTimeMs = "1200000"; }, d => { d.breakdown[0].family = "club_performance"; },
    d => { d.sources[0].athleteId = id(999); }, d => { d.sources[0].dateOfBirth = "1990-01-01"; },
    d => { d.sources[0].contributions[0].scopeId = id(999); }, d => { d.sources[0].finishTimeMs = null; },
    d => { d.sources[0].contributions = []; }, d => { d.sourceCount = 0; }, d => { d.nextCursor = id(3010); },
    d => { d.breakdown[0].sourceCount = 2; }]) {
    const f = distributionFixture(); mutate(f.detail); assert.throws(() => decodeRewardAwardDetail(f.detail, f.selected));
  }
  const f = distributionFixture(); let invoked = false;
  Object.defineProperty(f.detail.breakdown[0].calculation, "method", { enumerable: true, get() { invoked = true; return "podium"; } });
  assert.throws(() => decodeRewardAwardDetail(f.detail, f.selected)); assert.equal(invoked, false);
});
test("club and proportional explanations retain walletless shares and exact weighting", () => {
  for (const family of ["club_performance", "club_finishes", "athlete_metres"]) {
    const f = distributionFixture(), club = family !== "athlete_metres";
    f.detail.beneficiaryKind = club ? "club" : "athlete"; f.detail.beneficiaryId = id(club ? 2000 : 1000);
    f.detail.beneficiaryName = club ? null : "Synthetic runner";
    const b = { family, scopeId: id(101), scopeName: null, amountWei: f.detail.amountWei, sourceCount: 1,
      calculation: family === "club_performance"
        ? { method: "podium", divisionBudgetWei: f.detail.amountWei, rank: 1, tieSize: 1, sharedPrizeWei: f.detail.amountWei, prizeSlots: [1], clubScore: "10000" }
        : { method: "proportional", familyBudgetWei: f.detail.amountWei, weight: "5000", totalWeight: "5000" } };
    f.detail.breakdown = [b]; f.detail.sources[0].contributions = [{ family, scopeId: b.scopeId }];
    assert.deepEqual(decodeRewardAwardDetail(f.detail, f.selected), f.detail);
    if (family !== "club_performance") { b.calculation.totalWeight = "1"; assert.throws(() => decodeRewardAwardDetail(f.detail, f.selected)); }
  }
});
test("award and result pages require ordered unique rows and exact bounded cursors", () => {
  const f = distributionFixture(), row = f.page.items[0];
  f.page.items = Array.from({ length: 25 }, (_, n) => ({ ...row, entitlementId: id(100 + n) })); f.page.nextCursor = id(124);
  assert.equal(decodeRewardAwardPage(f.page, f.allocation, id(99)).nextCursor, id(124));
  for (const mutate of [d => d.items.push(row), d => d.items.reverse(), d => { d.items[1] = d.items[0]; },
    d => { d.nextCursor = id(999); }, d => { d.items.pop(); }]) {
    const d = structuredClone(f.page); mutate(d); assert.throws(() => decodeRewardAwardPage(d, f.allocation, id(99)));
  }
  const source = f.detail.sources[0]; f.detail.sourceCount = 51;
  f.detail.breakdown.forEach(b => { b.sourceCount = 51; });
  f.detail.sources = Array.from({ length: 50 }, (_, n) => ({ ...source, sourceId: id(3100 + n) })); f.detail.nextCursor = id(3149);
  assert.equal(decodeRewardAwardDetail(f.detail, f.selected).nextCursor, id(3149));
  f.detail.sources = [{ ...source, sourceId: id(3150) }]; f.detail.nextCursor = null;
  assert.equal(decodeRewardAwardDetail(f.detail, f.selected, id(3149)).sources.length, 1);
  f.detail.sources[0].sourceId = id(3149); assert.throws(() => decodeRewardAwardDetail(f.detail, f.selected, id(3149)));
});
test("distribution requests freeze identity and selected scope before asynchronous work", async () => {
  for (const [method, key, select] of [[listRewardOperatorCampaigns, "campaigns", "scope"], [listRewardOperatorAwards, "page", "allocation"], [readRewardOperatorAward, "detail", "selected"]]) {
    const f = distributionFixture(), expected = structuredClone(f[key]);
    const result = await method(f.identity, f[select], async (_name, args) => {
      assert.equal(args.p_actor_user_id, id(4)); f.identity.userId = id(999); f[select].programmeId = id(999); f[select].chainId = 10143;
      return { data: expected, error: null };
    }); assert.deepEqual(result, expected);
  }
});
test("distribution HTTP rejects writes, arbitrary query/body authority and sanitizes denied or unavailable reads", async () => {
  const f = distributionFixture();
  for (const kind of ["campaigns", "awards", "detail"]) {
    assert.equal((await http(f, kind, { method: "POST" })).handled, false);
    assert.equal((await http(f, kind, { authError: "Unauthorized" })).status, 401);
    for (const [error, status] of [["reward_operator_permission_required", 403], ["reward_account_session_required", 401],
      ["reward_distribution_scope_required", 404], ["private database diagnostic", 503]]) {
      const response = await http(f, kind, { error }); assert.equal(response.status, status);
      assert.doesNotMatch(JSON.stringify(response.body), /private database diagnostic/);
    }
  }
  for (const path of [`${endpoint(f)}?after=${id(1)}`, `${awardPath(f)}?after=${id(1)}&after=${id(2)}`,
    `${awardPath(f)}?actorUserId=${id(1)}`, `${awardPath(f)}/invalid`]) {
    const result = await http(f, "awards", { path }); assert.equal(result.status, 400); assert.equal(result.calls.length, 0);
  }
});
