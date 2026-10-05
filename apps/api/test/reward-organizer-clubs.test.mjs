import assert from "node:assert/strict";
import test from "node:test";
import { organizerClubFixture as fixture } from "./fixtures/reward-organizer-club.mjs";
import { clubReviewId as id } from "./fixtures/reward-club-review.mjs";
import { dispatchOrganizerRewardRoutes } from "../dist/routes/rewards/organizer.js";
import { listRewardOperatorClubTreasuries } from "../../../packages/db/dist/rewards/index.js";
import { observeOrganizerClubTreasury } from "../dist/features/rewards/organizer-club-treasury-service.js";
import { createRewardClubReviewReader, rewardClubReviewChainFetch, rewardClaimChainFetch, REWARD_CLAIM_TESTNET_RPC } from "../dist/features/rewards/claim-chain-reader.js";
const base = f => `/api/v1/organizer/rewards/programmes/${f.input.programmeId}/club-treasuries`;
const detail = f => `${base(f)}/${f.input.requestId}/review`;
const observation = f => ({ expectedIdentityFingerprintSha256: f.input.expectedIdentityFingerprintSha256, expectedRevision: f.input.expectedRevision,
  factoryAddress: f.input.evidence.factoryAddress, deploymentTransactionHash: f.input.evidence.deploymentTransactionHash });
const record = f => { const { programmeId, requestId, ...input } = f.input; return { ...input, confirmReview: true }; };
const privateCheck = value => assert.doesNotMatch(JSON.stringify(value), /sessionId|SessionId|userId|UserId|EvidenceRef|signature|idempotencyKey|privateKey|signedTransaction/);
async function request(f, { url = detail(f), method = "GET", body, rpc = f.rpc, identity = async () => f.identity, config = f.config, reader = f.chain.reader } = {}) {
  const res = { status: 200, value: null, headers: {} }; let bodyReads = 0;
  const handled = await dispatchOrganizerRewardRoutes({ method }, res, new URL(url, f.config.origin), {
    config: () => config, requireIdentity: identity, rpc, clubReader: reader,
    readJsonBody: async () => { bodyReads++; return body; }, applyPrivateSessionHeaders: r => { r.headers["cache-control"] = "private, no-store"; },
    sendSuccess: (r, value) => { r.value = value; }, sendError: (r, status, code, message) => { r.status = status; r.value = { error: { code, message } }; },
  }); return { ...res, handled, bodyReads };
}
test("programme club discovery and detail whitelist current labels, candidate and review state without private audit/session data", async () => {
  const f = fixture(); f.context.latestReview = f.review; f.context.reviewState = "reviewed";
  for (const url of [base(f), detail(f)]) { const r = await request(f, { url }); assert.equal(r.status, 200); assert.equal(r.bodyReads, 0); privateCheck(r.value);
    assert.equal(r.headers["cache-control"], "private, no-store"); }
  const r = await request(f); assert.deepEqual(Object.keys(r.value).sort(), ["programmeId", "requestId", "chainId", "clubId", "clubName", "ownerProfileId", "ownerName",
    "candidate", "requestedAt", "nominationStatus", "identityFingerprintSha256", "reviewState", "latestReview"].sort());
  assert.equal(r.value.ownerName, f.labels.ownerName); assert.equal(f.chain.calls.length, 0);
});
test("read-only chain preview binds exact nomination/version and rechecks the current session after verification", async () => {
  const f = fixture(); const r = await request(f, { url: `${base(f)}/${f.input.requestId}/observe`, method: "POST", body: observation(f) });
  assert.equal(r.status, 200); privateCheck(r.value); assert.equal(r.value.scope, "initialization_only"); assert.equal(r.value.executionHistoryReviewRequired, true);
  assert.deepEqual(r.value.reviewedBlock, f.input.evidence.reviewedBlock); assert.equal(r.value.initializerHash, f.input.evidence.initializerHash);
  assert.deepEqual(f.calls.map(c => c.name), ["service_read_reward_club_review_context", "service_read_reward_club_review_context"]);
  let reads = 0; const expired = await request(f, { url: `${base(f)}/${f.input.requestId}/observe`, method: "POST", body: observation(f),
    rpc: async (name, args) => ++reads === 2 ? { data: null, error: { message: "reward_account_session_required" } } : f.rpc(name, args) });
  assert.equal(expired.status, 401); privateCheck(expired.value);
});
test("explicit saving rechecks the exact preview and returns an immutable historical summary; retry does not require a chain client", async () => {
  const f = fixture(); const r = await request(f, { method: "POST", body: record(f) }); assert.equal(r.status, 200); privateCheck(r.value);
  assert.equal(r.value.review.revision, 1); assert.equal(f.calls.at(-1).name, "service_record_reward_club_review");
  assert.deepEqual(f.calls.at(-1).args.p_evidence, f.input.evidence);
  f.context.latestReview = f.review; f.context.retryReview = f.review; f.context.reviewState = "reviewed";
  const retry = await request(f, { method: "POST", body: record(f), reader: () => { throw Error("Must not create reader for an exact historical retry"); } });
  assert.equal(retry.status, 200); assert.deepEqual(retry.value, r.value);
});
test("revocation is explicit and bound to the selected latest review, request, programme and network", async () => {
  const f = fixture(); f.context.latestReview = f.review; f.context.reviewState = "reviewed";
  const url = `${base(f)}/${f.input.requestId}/reviews/${f.review.reviewId}/revoke`, body = { reason: "authority_uncertain", confirmRevoke: true };
  const r = await request(f, { url, method: "POST", body }); assert.equal(r.status, 200); assert.equal(r.value.review.revocationReason, body.reason); privateCheck(r.value);
  assert.equal((await request(f, { url: url.replace(f.review.reviewId, id(99)), method: "POST", body })).status, 409);
  assert.equal((await request(f, { url, method: "POST", body, config: { ...f.config, chainId: 10143 } })).status, 404);
  assert.equal(f.chain.calls.length, 0);
});
test("every club operator route rejects expired sessions, unauthorized operators, foreign scopes and private raw failures", async () => {
  for (const action of ["list", "read", "observe", "record", "revoke"]) {
    const f = fixture(), options = action === "list" ? { url: base(f) } : action === "read" ? {} : action === "observe"
      ? { url: `${base(f)}/${f.input.requestId}/observe`, method: "POST", body: observation(f) } : action === "record"
        ? { method: "POST", body: record(f) } : { url: `${base(f)}/${f.input.requestId}/reviews/${f.review.reviewId}/revoke`, method: "POST", body: { reason: "operator_correction", confirmRevoke: true } };
    assert.equal((await request(f, { ...options, identity: async () => { throw Error("Unauthorized"); } })).status, 401);
    for (const [message, status] of [["reward_account_session_required",401],["reward_operator_permission_required",403],["reward_club_review_scope_required",404],["private SQL token evidence",503]]) {
      const r = await request(f, { ...options, rpc: async () => ({ data: null, error: { message } }) }); assert.equal(r.status,status); privateCheck(r.value);
      assert.doesNotMatch(JSON.stringify(r.value), /private SQL/);
    } assert.equal(f.chain.calls.length, 0);
  }
});
test("unsupported methods and malformed, cross-network, unconfirmed or privilege-bearing inputs never save reviews", async () => {
  const f = fixture(); assert.equal((await request(f, { config: null })).handled, false);
  for (const method of ["PUT","PATCH","DELETE"]) assert.equal((await request(f, { method })).handled,false);
  for (const url of [`${detail(f)}?after=${id(1)}`,`${base(f)}?after=${id(1)}&after=${id(2)}`,`${base(f)}?chainId=143`,detail(f).replace(f.input.programmeId,"bad")])
    assert.equal((await request(f,{url})).status,400);
  for (const body of [null, {}, {...record(f),confirmReview:false},{...record(f),actorUserId:id(99)},{...record(f),rpcUrl:"http://127.0.0.1:1/"},
    {...record(f),evidence:{...f.input.evidence,privateKey:"secret"}},{...record(f),evidence:{...f.input.evidence,candidate:{...f.input.evidence.candidate,owners:[]}}}])
    assert.equal((await request(f,{method:"POST",body})).status,400);
  assert.equal(f.calls.length,0); assert.equal(f.chain.calls.length,0);
});
test("changed identity/review and unsupported chain evidence return holds, never successful observations or writes", async () => {
  const f = fixture(), url = `${base(f)}/${f.input.requestId}/observe`, body = observation(f);
  f.context.identityFingerprintSha256="b".repeat(64); assert.equal((await request(f,{url,method:"POST",body})).status,409); assert.equal(f.chain.calls.length,0);
  f.context.identityFingerprintSha256="a".repeat(64); f.context.nomination.status="identity_hold"; f.context.reviewState="identity_hold";
  assert.equal((await request(f,{url,method:"POST",body})).status,409); assert.equal(f.chain.calls.length,0);
  f.context.nomination.status="pending_review"; f.context.reviewState="unreviewed"; f.chain.tx.value=1n;
  const r=await request(f,{url,method:"POST",body}); assert.equal(r.status,409); assert.equal(r.value.error.code,"reward_club_chain_check_failed");
  f.context.extra="private"; assert.equal((await request(f)).status,503);
});
test("club discovery enforces sorted bounded pages, exact cursors and strict private response fields", async () => {
  const f=fixture(), input={programmeId:f.input.programmeId,chainId:31337};
  f.page.items=Array.from({length:25},(_,n)=>({...f.item,requestId:id(100+n)})); f.page.nextCursor=id(124);
  const page=await listRewardOperatorClubTreasuries(f.identity,input,f.rpc); assert.equal(page.items.length,25); assert.equal(page.nextCursor,id(124));
  for (const change of [p=>p.nextCursor=id(125),p=>p.items.push({...f.item,requestId:id(126)}),p=>p.items.reverse(),p=>p.items[0].sessionId=id(99),p=>p.chainId=10143]) {
    const data=structuredClone(f.page); change(data); await assert.rejects(listRewardOperatorClubTreasuries(f.identity,input,async()=>({data,error:null})));
  }
});
test("club RPC transport adds read-only storage access without widening athlete transport or permitting wallet/send/URL inputs",async()=>{
  let calls=0; const response=()=>{const r=new Response(JSON.stringify({jsonrpc:"2.0",id:1,result:"0x00"}),{headers:{"content-type":"application/json"}});Object.defineProperty(r,"url",{value:REWARD_CLAIM_TESTNET_RPC});return r;};
  const fetcher=async()=>{calls++;return response();}, init=method=>({method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method,params:[]})});
  const club=rewardClubReviewChainFetch(REWARD_CLAIM_TESTNET_RPC,fetcher);
  await club(REWARD_CLAIM_TESTNET_RPC,init("eth_getStorageAt")); assert.equal(calls,1);
  for(const method of ["eth_sendRawTransaction","eth_sendTransaction","eth_sign","personal_sign","eth_requestAccounts","debug_traceTransaction"])
    await assert.rejects(club(REWARD_CLAIM_TESTNET_RPC,init(method)),{code:"reward_claim_transport_unavailable"});
  await assert.rejects(rewardClaimChainFetch(REWARD_CLAIM_TESTNET_RPC,fetcher)(REWARD_CLAIM_TESTNET_RPC,init("eth_getStorageAt")));
  await assert.rejects(club("https://example.invalid/",init("eth_chainId")));assert.equal(calls,1);
  assert.throws(()=>createRewardClubReviewReader({chainId:31337,origin:"http://127.0.0.1:3101"},{NODE_ENV:"production",RACESON_REWARD_LOCAL_RPC_URL:"http://127.0.0.1:8545/"}));
});
test("preview freezes identity and original expectations before chain IO and refuses a changed context after observation",async()=>{
  const f=fixture(), input={...f.input,...observation(f)}, options={...f.options}; let reads=0;
  options.rpc=async(name,args)=>{const result=await f.rpc(name,args); if(++reads===1){input.expectedIdentityFingerprintSha256="b".repeat(64);input.expectedRevision=99;options.chainId=10143;}return result;};
  const r=await observeOrganizerClubTreasury(f.identity,input,options);assert.equal(r.expectedRevision,0);assert.equal(r.chainId,31337);
  reads=0; const g=fixture();g.options.rpc=async(name,args)=>{const result=await g.rpc(name,args);if(++reads===2)result.data.identityFingerprintSha256="b".repeat(64);return result;};
  await assert.rejects(observeOrganizerClubTreasury(g.identity,{...g.input,...observation(g)},g.options),{code:"reward_club_review_identity_changed"});
});
