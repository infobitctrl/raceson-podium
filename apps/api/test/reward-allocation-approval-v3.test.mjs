import assert from "node:assert/strict";
import test from "node:test";
import { buildAllocationDocumentV3, decodeAllocationDocumentV3, allocationApprovalReasonsV3 } from "../../../packages/domain/dist/rewards/allocation-approval-v3.js";
import { historicalAllocationSourceV3 } from "../../../packages/domain/dist/rewards/historical-source-v3.js";
import { createDefaultRewardProgrammeDraftV2 } from "../../../packages/domain/dist/rewards/programme-draft-v2.js";
import { allocationDocumentHashV3 } from "../../../packages/db/dist/rewards/index.js";
import { publishedSnapshot, publishedMapping, id } from "./fixtures/published-reward-v2.mjs";
import { dispatchRewardPlanningRoutes } from "../dist/routes/rewards/planning.js";
const digest = "a".repeat(64), at = "2026-09-10T02:00:00.000Z";
function fixture() {
  const snapshot = publishedSnapshot(); snapshot.results.forEach((r, i) => r.clubId = snapshot.clubs[i % 2].clubId);
  const record = { draftId: id(900), organizationId: id(901), seasonId: id(902), chainId: 31337,
    organizationName: "Synthetic organization", seasonName: "Synthetic season", revision: 1, updatedAt: at, rules: createDefaultRewardProgrammeDraftV2() };
  const workspace = { draftId: record.draftId, revision: 1, rulesRevision: 1, catalogueHash: digest, boundCatalogueHash: digest,
    mapping: publishedMapping(), catalogue: structuredClone(snapshot.catalogue) };
  const finale = { ...structuredClone(workspace.catalogue.rounds[0]), id: id(910), editionId: id(911), slot: 5, status: "draft",
    races: [{ ...workspace.catalogue.rounds[0].races[0], id: id(912), publicationId: null, publicationState: null, resultCount: 0 }] };
  workspace.catalogue.rounds.push(finale); workspace.mapping.rounds[4].roundId = finale.id;
  const decision = { id: id(920), slot: 1, contextHash: digest, decision: "confirmed_final", reviewedAt: at, current: true };
  const source = historicalAllocationSourceV3(snapshot, workspace.mapping, digest, [decision], at);
  const binding = { intentId: id(930), fundingApprovalId: id(931), programmeAddress: `0x${"1".repeat(40)}`,
    campaignAddress: `0x${"2".repeat(40)}`, deploymentTransactionHash: `0x${"3".repeat(64)}`, programmeId: `0x${"4".repeat(64)}`,
    campaignId: `0x${"5".repeat(64)}`, programmeManifestHash: `0x${"6".repeat(64)}`, reviewSeconds: 86400, fundingContextHash: digest };
  return { record, workspace, decision, source, binding };
}
const build = f => buildAllocationDocumentV3(f.record, f.workspace, digest, digest, 1, f.source, f.decision, f.binding);
const json = value => JSON.parse(JSON.stringify(value, (_, v) => typeof v === "bigint" ? v.toString() : v));

test("per-pot document recomputes exact totals, aggregates athlete/club recipients and retains walletless shares", () => {
  const f = fixture(), before = structuredClone(f), d = build(f);
  assert.deepEqual(f, before); assert.equal(d.schema, "raceson-allocation-document-v3.1");
  assert.deepEqual(decodeAllocationDocumentV3(json(d)), d); assert.deepEqual(allocationApprovalReasonsV3(d), []);
  assert.equal(d.calculation.budgetWei, 10000n * 10n ** 18n);
  assert.equal(d.calculation.proposedWei + d.calculation.retainedWei, d.calculation.budgetWei);
  assert.equal(d.recipients.reduce((n, r) => n + r.amountWei, 0n), d.calculation.proposedWei);
  assert.ok(d.recipients.some(r => r.beneficiaryKind === "club")); assert.ok(d.recipients.some(r => r.beneficiaryKind === "athlete"));
  assert.doesNotMatch(JSON.stringify(json(d)), /athleteName|clubName|wallet|privateKey|reviewStartedAt|officialPublishedAt/);
});
test("finale publication, unrelated standings and observation time cannot churn a historical pot commitment", () => {
  const f = fixture(), original = allocationDocumentHashV3(build(f));
  f.workspace.catalogueHash = "b".repeat(64);
  Object.assign(f.workspace.catalogue.rounds[4], { status: "completed" });
  Object.assign(f.workspace.catalogue.rounds[4].races[0], { publicationId: id(940), publicationState: "official", resultCount: 50 });
  f.source.capturedAt = "2026-10-04T00:00:00.000Z";
  f.source.rounds[4].evidence = { kind: "native_final", digest: "b".repeat(64), publishedAt: "2026-10-03T20:00:00.000Z", held: false };
  f.source.rounds[1].evidence.held = false;
  f.source.standings.find(t => t.slot === 2).rows.reverse();
  assert.equal(allocationDocumentHashV3(build(f)), original);
  assert.ok(build(f).source.rounds.slice(1).every(r => !r.evidence && !r.results.length && !r.resultsComplete));
});
test("a source hold cannot be cleared by a confirmed human decision; recipient and total edits fail decoding", () => {
  const f = fixture(); f.source.rounds[0].evidence.held = true;
  const held = build(f); assert.equal(held.calculation.proposedWei, 0n);
  assert.ok(allocationApprovalReasonsV3(held).includes("unresolved_results"));
  const d = json(build(fixture()));
  for (const mutate of [v => v.recipients[0].amountWei = "1", v => v.calculation.proposedWei = "0", v => v.source.rounds[1].resultsComplete = true,
    v => v.binding.privateKey = "never", v => v.mappingRevision = 0, v => v.schema = "raceson-allocation-document-v3"]) {
    const copy = structuredClone(d); mutate(copy); assert.throws(() => decodeAllocationDocumentV3(copy));
  }
});
test("selected-round decisions, sources, mappings and funding bindings are committed, not interchangeable", () => {
  const original = allocationDocumentHashV3(build(fixture()));
  for (const mutate of [f => f.decision.id = id(999), f => f.binding.campaignAddress = `0x${"7".repeat(40)}`,
    f => f.binding.fundingContextHash = "c".repeat(64), f => f.workspace.mapping.rounds[0].categories[0].shareBps = 5000,
    f => f.source.rounds[0].results[0].status = "dnf"]) {
    const f = fixture(); mutate(f); assert.notEqual(allocationDocumentHashV3(build(f)), original);
  }
  const f = fixture(); f.decision.current = false; assert.throws(() => build(f));
});
test("allocation HTTP accepts only exact expectations and never accepts arbitrary amounts, clocks or destinations", async () => {
  const request = async ({ body, method = "POST", query = "", authError, rpcError = "private provider error", slot = 1 } = {}) => {
    const response = {}, calls = [];
    const handled = await dispatchRewardPlanningRoutes({ method }, response,
      new URL(`http://127.0.0.1:3101/api/v1/organizer/rewards/drafts/${id(900)}/allocation-approval/${slot}${query}`), {
        config: () => ({ chainId: 31337 }), requireIdentity: async () => { if (authError) throw Error(authError); return { userId: id(901), sessionId: id(902) }; },
        readJsonBody: async () => body, applyPrivateSessionHeaders: () => response.private = true,
        sendSuccess: (_, data) => Object.assign(response, { status: 200, data }), sendError: (_, status, code) => Object.assign(response, { status, code }),
        rpc: async (name, args) => { calls.push({ name, args }); return { data: null, error: { message: rpcError } }; } });
    return { response, calls, handled };
  };
  const body = { requestId: id(920), expectedApprovalId: null, contextHash: digest, documentHash: digest };
  for (const patch of [{ amountWei: "1" }, { wallet: `0x${"1".repeat(40)}` }, { reviewStartedAt: at }, { document: {} }, { requestId: id(0).toUpperCase() + "x" }]) {
    const r = await request({ body: { ...body, ...patch } }); assert.equal(r.response.status, 400); assert.equal(r.calls.length, 0);
  }
  for (const authError of ["Unauthorized", "Missing bearer token"]) assert.equal((await request({ body, authError })).response.status, 401);
  assert.equal((await request({ body, query: "?chainId=143" })).response.status, 400);
  assert.equal((await request({ body, method: "PATCH" })).handled, false);
  assert.equal((await request({ method: "GET", slot: 5 })).handled, false);
  const failure = await request({ method: "GET" }); assert.equal(failure.response.status, 503); assert.equal(failure.response.private, true);
  assert.doesNotMatch(JSON.stringify(failure.response), /private provider error/);
  for (const code of ["reward_allocation_approval_conflict", "reward_allocation_not_ready"]) assert.equal((await request({ body, rpcError: code })).response.status, 409);
});
