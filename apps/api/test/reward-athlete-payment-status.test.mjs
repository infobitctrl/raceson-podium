import assert from "node:assert/strict";
import test from "node:test";
import { readRewardAthletePaymentStatus } from "../../../packages/db/dist/rewards/index.js";
import { getAthleteRewardPaymentStatus } from "../dist/features/rewards/athlete-payment-status-service.js";
import { dispatchAthleteRewardRoutes } from "../dist/routes/rewards/athlete.js";
import { applyPrivateSessionHeaders } from "../dist/browser-session.js";

const id = n => `7a000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const hash = n => `0x${n.repeat(64)}`, address = n => `0x${n.repeat(40)}`;
const identity = { userId: id(1), sessionId: id(2) }, config = { chainId: 31337, origin: "http://127.0.0.1:5173" };
const fixture = (status = "confirmed") => {
  const finalizedBlock = { number: "50", hash: hash("a"), timestamp: "1788854410" };
  return { claim: { intentId: id(10), programmeId: id(3), campaignId: id(4), entitlementId: id(5), scopeKey: id(6),
    pot: "race", chainId: 31337, amountWei: "999999999999999999", recipientAddress: address("b"), issuedAt: "1788854400",
    expiresAt: "1788940800", preparedAt: "2026-09-08T08:00:00Z", recipientConsentRecordedAt: "2026-09-08T08:00:01Z",
    operatorApprovalRecordedAt: "2026-09-08T08:00:02Z" },
    chainEntitlementId: hash("c"), authorizationNonce: "0", allocationDigest: hash("d"), status,
    confirmation: status !== "confirmed" ? null : { recordedAt: "2026-09-08T08:00:12Z", observedAt: "2026-09-08T08:00:11Z",
      transactionHash: hash("e"), deployment: { schemaVersion: 1, chainId: 31337, contractAddress: address("f"),
        buildId: "synthetic-verified-ledger", creationCodeHash: hash("1"), runtimeCodeHash: hash("2"), deploymentTransactionHash: hash("3"),
        deploymentNonce: "0", deploymentBlockNumber: "1", deploymentBlockHash: hash("4") },
      payment: { schemaVersion: 1, action: "pay_athlete", chainId: 31337, contractAddress: address("f"), relayerAddress: address("9"),
        transactionHash: hash("e"), nonce: "1", blockNumber: "50", blockHash: hash("a"), blockTimestamp: "1788854410", logIndex: 0,
        entitlementId: hash("c"), recipient: address("b"), amount: "999999999999999999", pot: "race", authorizationNonce: "0",
        allocationDigest: hash("d"), gasLimit: "500000", gasUsed: "100000", effectiveGasPrice: "100", monadGasLimitFee: "50000000",
        runtimeCodeHash: hash("2"), finalizedBlock },
      observation: { schemaVersion: 1, finalizedBlock: { ...finalizedBlock }, accounting: { state: 3, paused: false,
        accountedFunding: "999999999999999999", treasuryReturned: "0", budgets: ["999999999999999999", "0"],
        allocated: ["999999999999999999", "0"], paid: ["999999999999999999", "0"], nativeBalance: "0", entitlementCount: "1",
        uploadDigest: hash("5"), snapshotDigest: hash("6"), allocationDigest: hash("d"), activationNotBefore: "1788854300",
        claimDeadline: "1820390300", pausedAt: "0" } } } };
};
const transport = data => async () => ({ data, error: null });
const read = data => readRewardAthletePaymentStatus(identity, { chainId: 31337, intentId: id(10) }, transport(data));

test("athlete payment read returns exact recorded receipt and explicit minimal browser whitelist, not a balance or fresh chain read", async () => {
  const data = fixture(); let calls = 0;
  const output = await getAthleteRewardPaymentStatus(identity, id(10), { ...config, rpc: async (name, args) => {
    calls++; assert.equal(name, "service_read_reward_athlete_payment_status");
    assert.deepEqual(args, { p_user_id: id(1), p_session_id: id(2), p_chain_id: 31337, p_intent_id: id(10) });
    return { data, error: null };
  } });
  assert.equal(calls, 1); assert.equal(output.amountWei, data.claim.amountWei); assert.equal(output.status, "confirmed");
  assert.deepEqual(Object.keys(output).sort(), ["intentId", "programmeId", "campaignId", "entitlementId", "scopeKey", "pot", "chainId", "amountWei", "recipientAddress", "status", "receipt"].sort());
  assert.deepEqual(output.receipt, { transactionHash: hash("e"), contractAddress: address("f"), blockNumber: "50", blockHash: hash("a"),
    blockTimestamp: "1788854410", logIndex: 0, finalizedBlock: data.confirmation.payment.finalizedBlock,
    recordedAt: data.confirmation.recordedAt, observedAt: data.confirmation.observedAt });
  assert.doesNotMatch(JSON.stringify(output), /signature|signedTransaction|userId|sessionId|lease|relayer|authorizationNonce|witness|paid|balance|accounting|idempotencyKey/i);
});

test("every unconfirmed processing stage lacks a receipt; neither expired claim nor recorded proofs imply unpaid or paid", async () => {
  for (const status of ["no_confirmation", "queued", "processing", "submission_unconfirmed"]) {
    const result = await read(fixture(status)); assert.equal(result.status, status); assert.equal(result.receipt, null);
  }
  const past = fixture(); past.claim.issuedAt = "1"; past.claim.expiresAt = "20";
  past.confirmation.payment.blockTimestamp = "10"; past.confirmation.payment.finalizedBlock.timestamp = "10";
  past.confirmation.observation.finalizedBlock.timestamp = "10";
  assert.equal((await read(past)).status, "confirmed", "read-time expiry must not hide a historical confirmed receipt");
  const league = fixture(); league.claim.chainId = 10143; league.claim.pot = "league"; league.claim.scopeKey = "rounds-1-5";
  league.confirmation.deployment.chainId = 10143; league.confirmation.payment.chainId = 10143; league.confirmation.payment.pot = "league";
  league.confirmation.observation.accounting.paid.reverse();
  assert.equal((await readRewardAthletePaymentStatus(identity, { chainId: 10143, intentId: id(10) }, transport(league))).status, "confirmed");
});

test("payment status freezes account/session, intent and server network before await; malformed scope never calls SQL", async () => {
  const actor = { ...identity }, input = { chainId: 31337, intentId: id(10) }; let observed;
  const pending = readRewardAthletePaymentStatus(actor, input, async (name, args) => { observed = args; await Promise.resolve(); return { data: fixture(), error: null }; });
  actor.userId = id(9); actor.sessionId = id(9); input.chainId = 143; input.intentId = id(99);
  assert.equal((await pending).claim.intentId, id(10));
  assert.deepEqual(observed, { p_user_id: id(1), p_session_id: id(2), p_chain_id: 31337, p_intent_id: id(10) });
  let calls = 0; const never = async () => { calls++; throw new Error("unexpected"); };
  for (const [who, request] of [[{ ...identity, sessionId: "bad" }, { chainId: 31337, intentId: id(10) }],
    [identity, { chainId: 143, intentId: id(10) }], [identity, { chainId: 31337, intentId: "bad" }]])
    await assert.rejects(readRewardAthletePaymentStatus(who, request, never));
  assert.equal(calls, 0);
});

test("receipt decoding rejects mismatched scope, ledger linkage, chain/finalized facts, values and private fields", async () => {
  const corruptions = [d => { d.claim.intentId = id(99); }, d => { d.claim.chainId = 10143; }, d => { d.claim.amountWei = "01"; },
    d => { d.claim.recipientAddress = address("0"); }, d => { d.claim.operatorApprovalRecordedAt = null; },
    d => { d.status = "paid"; }, d => { d.status = "queued"; }, d => { d.confirmation = null; },
    d => { d.signature = "private"; }, d => { d.confirmation.leaseToken = "private"; }, d => { d.chainEntitlementId = hash("7"); },
    d => { d.authorizationNonce = "2"; }, d => { d.allocationDigest = hash("7"); }, d => { d.confirmation.transactionHash = hash("7"); },
    d => { d.confirmation.deployment.chainId = 10143; }, d => { d.confirmation.deployment.contractAddress = address("7"); },
    d => { d.confirmation.deployment.runtimeCodeHash = hash("7"); }, d => { d.confirmation.deployment.deploymentBlockNumber = "50"; },
    d => { d.confirmation.recordedAt = "2020-01-01T00:00:00Z"; }, d => { d.confirmation.observedAt = "2020-01-01T00:00:00Z"; },
    d => { d.confirmation.observation.finalizedBlock.number = "49"; }, d => { d.confirmation.observation.accounting.paid[0] = "0"; }];
  for (const [key, value] of Object.entries({ action: "fund", chainId: 143, contractAddress: address("7"), transactionHash: hash("7"),
    entitlementId: hash("7"), recipient: address("7"), amount: "1", pot: 0, authorizationNonce: "1", allocationDigest: hash("7"),
    relayerAddress: address("b"), nonce: "9007199254740992", blockNumber: "51", blockHash: hash("7"), blockTimestamp: "1788940800",
    gasLimit: "0", gasUsed: "500001", effectiveGasPrice: "101", monadGasLimitFee: "0", logIndex: -1,
    runtimeCodeHash: hash("7"), signature: "private", amountNumeric: 1 }))
    corruptions.push(d => { d.confirmation.payment[key] = value; });
  for (const corrupt of corruptions) { const data = fixture(); corrupt(data); await assert.rejects(read(data)); }
  const getter = fixture(); Object.defineProperty(getter, "status", { enumerable: true, get() { throw new Error("getter ran"); } });
  await assert.rejects(read(getter), error => error.message !== "getter ran");
});

test("payment read masks unexpected SQL/transport details but preserves missing-scope and revoked-session errors", async () => {
  for (const [message, code] of [["reward_account_session_required", "reward_account_session_required"],
    ["reward_payment_status_not_found", "reward_payment_status_not_found"], ["private secret", "reward_ledger_store_failed"]])
    await assert.rejects(readRewardAthletePaymentStatus(identity, { chainId: 31337, intentId: id(10) }, async () => ({ data: null, error: { message } })), { code });
  await assert.rejects(readRewardAthletePaymentStatus(identity, { chainId: 31337, intentId: id(10) }, async () => { throw new Error("private secret"); }), { code: "reward_ledger_unavailable" });
});

const path = `/api/v1/athlete/rewards/claims/${id(10)}/payment`;
async function request(url = path, overrides = {}, method = "GET") {
  let auth = 0, calls = 0;
  const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(v) { this.body = JSON.parse(v); } };
  const routed = await dispatchAthleteRewardRoutes({ method, headers: {} }, res, new URL(url, config.origin), {
    config: () => config, requireIdentity: async () => { auth++; return identity; }, applyPrivateSessionHeaders,
    readJsonBody: async () => { throw new Error("read must not consume a body"); },
    sendSuccess: (r, data) => r.end(JSON.stringify({ data })), sendError: (r, status, code, message) => { r.statusCode = status; r.end(JSON.stringify({ error: { code, message } })); },
    rpc: async () => { calls++; return { data: fixture(), error: null }; },
    claimReader: new Proxy({}, { get() { throw new Error("historical read must not query chain or execute anything"); } }), ...overrides,
  });
  return { ...res, routed, auth, calls };
}

test("payment HTTP read is demo-gated/private/no-store with strict path/query scope and no chain or mutation route", async () => {
  const ok = await request(); assert.equal(ok.statusCode, 200); assert.equal(ok.body.data.status, "confirmed");
  assert.equal(ok.routed, true); assert.equal(ok.auth, 1); assert.equal(ok.calls, 1); assert.equal(ok.headers["Cache-Control"], "private, no-store");
  for (const query of ["?chainId=143", "?userId=other", "?role=operator", `?after=${id(1)}`, "?foo="]) {
    const denied = await request(`${path}${query}`); assert.equal(denied.statusCode, 400); assert.equal(denied.calls, 0);
  }
  assert.equal((await request(path.replace(id(10), "invalid"))).statusCode, 400);
  assert.equal((await request(path, {}, "POST")).routed, false);
  assert.equal((await request(`${path}/consent`)).routed, false);
  const disabled = await request(path, { config: () => null }); assert.equal(disabled.routed, false); assert.equal(disabled.auth, 0); assert.equal(disabled.calls, 0);
  for (const [message, status] of [["Unauthorized", 401], ["Missing bearer token", 401], ["Untrusted browser origin", 403]]) {
    const denied = await request(path, { requireIdentity: async () => { throw new Error(message); } }); assert.equal(denied.statusCode, status); assert.equal(denied.calls, 0);
  }
  for (const [message, status] of [["reward_account_session_required", 401], ["reward_payment_status_not_found", 404], ["private secret", 503]]) {
    const denied = await request(path, { rpc: async () => ({ data: null, error: { message } }) });
    assert.equal(denied.statusCode, status); assert.doesNotMatch(JSON.stringify(denied.body), /private secret/);
  }
  const damaged = fixture(); damaged.confirmation.payment.recipient = address("7");
  assert.equal((await request(path, { rpc: transport(damaged) })).statusCode, 503);
});
