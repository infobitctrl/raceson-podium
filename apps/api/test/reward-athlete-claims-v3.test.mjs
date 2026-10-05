import assert from "node:assert/strict";
import test from "node:test";
import { decodeClaimWitnessV3,decodeClaimIntentV3,listOwnClaimsV3 } from "../../../packages/db/dist/rewards/index.js";
import { dispatchAthleteClaimsV3 } from "../dist/routes/rewards/athlete-claims-v3.js";
const id=n=>`8f300000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const hash=n=>`0x${n.repeat(64)}`,address=n=>`0x${n.repeat(40)}`;
const identity={userId:id(1),sessionId:id(2)};
const witness=()=>({protocolVersion:3,chainId:31337,campaignAddress:address("a"),stageTransactionHash:hash("b"),allocationDigest:hash("c"),
  entitlementId:hash("d"),recipientAddress:address("e"),amountWei:"1000000000000000001",nonce:"0",finalizedBlock:{number:"200",hash:hash("f"),timestamp:"1801000000"},claimDeadline:"1832536000"});
const summary=()=>({schema:"raceson-athlete-claim-record-v3",claimId:id(3),uploadId:id(4),destinationId:id(5),entitlementId:hash("d"),chainId:31337,
  recipientAddress:address("e"),amountWei:"1000000000000000001",issuedAt:"1801000000",expiresAt:"1801086400",recipientConsented:false,operatorApproved:false});
const page=()=>({schema:"raceson-own-claims-v3",chainId:31337,items:[summary()],nextCursor:null});
test("V3 claim witness is explicitly versioned and refuses lossy money, exhausted nonce and invalid window",()=>{
  assert.equal(decodeClaimWitnessV3(witness()).amountWei,1000000000000000001n);
  for(const change of [w=>w.protocolVersion=2,w=>w.chainId=143,w=>w.amountWei=1,w=>w.amountWei="0",w=>w.nonce=(2n**256n-1n).toString(),
    w=>w.finalizedBlock.timestamp="0",w=>w.finalizedBlock.hash=hash("0"),w=>w.claimDeadline=w.finalizedBlock.timestamp,w=>w.signature="0x"]){
    const w=witness();change(w);assert.throws(()=>decodeClaimWitnessV3(w));
  }
});
test("V3 intent decoder binds award, destination, chain, nonce and the exact non-renewable 24-hour maximum",()=>{
  const i={id:id(3),uploadId:id(4),destinationId:id(5),reviewId:id(6),entitlementId:hash("d"),chainId:31337,campaignAddress:address("a"),
    recipientUserId:id(1),recipientAddress:address("e"),sourceGuardHash:"a".repeat(64),profileFingerprint:"b".repeat(64),witness:witness(),nonce:"0",
    issuedAt:"1801000000",expiresAt:"1801086400",preparedByUserId:id(7),preparedSessionId:id(8),preparedAt:"2026-09-11T00:00:00Z"};
  assert.equal(decodeClaimIntentV3(i).expiresAt,1801086400n);
  for(const patch of [{expiresAt:"1801086401"},{expiresAt:"1801000001"},{issuedAt:"1801000001"},{nonce:"1"},{chainId:10143},{recipientAddress:address("a")},
    {entitlementId:hash("c")},{campaignAddress:address("b")},{witness:{...witness(),claimDeadline:"1801000002"}}])assert.throws(()=>decodeClaimIntentV3({...i,...patch}));
  assert.equal(decodeClaimIntentV3({...i,witness:{...witness(),claimDeadline:"1801000002"},expiresAt:"1801000002"}).expiresAt,1801000002n);
});
test("recipient history is private, paginated, exact-wei and never a paid/claimable assertion",async()=>{
  const calls=[],rpc=async(name,args)=>{calls.push({name,args});return{data:page(),error:null};};
  assert.deepEqual(await listOwnClaimsV3(identity,31337,null,rpc),page());
  assert.deepEqual(calls,[{name:"service_list_own_reward_claims_v3",args:{p_actor_user_id:id(1),p_actor_session_id:id(2),p_chain_id:31337,p_after_id:null}}]);
  for(const change of [r=>r.items[0].paid=true,r=>r.items[0].signature="0x",r=>r.items[0].operatorApproved=true,r=>r.items[0].amountWei=1,
    r=>r.items.push({...r.items[0]}),r=>r.chainId=143,r=>r.nextCursor=id(3)]){
    const r=page();change(r);await assert.rejects(listOwnClaimsV3(identity,31337,null,async()=>({data:r,error:null})));
  }
});
async function request(path,options={}) {
  let auth=0,bodies=0;const calls=[],headers={},res={setHeader:(k,v)=>headers[k]=v};
  const routed=await dispatchAthleteClaimsV3({method:options.method??"GET"},res,new URL(path,"http://127.0.0.1:3101"),{
    config:()=>options.disabled?null:{chainId:31337,origin:"http://127.0.0.1:3101"},requireIdentity:async()=>{auth++;if(options.authError)throw Error(options.authError);return identity;},
    readJsonBody:async()=>{bodies++;return options.body;},applyPrivateSessionHeaders:r=>r.setHeader("Cache-Control","private, no-store"),
    sendSuccess:(r,body)=>{r.status=200;r.body=body;},sendError:(r,status,code)=>{r.status=status;r.body={code};},claimV3Reader:options.noReader?undefined:{},
    rpc:async(name,args)=>{calls.push({name,args});return name==="service_list_own_reward_claims_v3" && !options.error?{data:page(),error:null}:
      {data:null,error:{message:options.error??"reward_claim_scope_required"}};},
  });return{...res,headers,routed,calls,auth,bodies};
}
const base=`/api/v1/athlete/rewards/uploads/${id(4)}/destinations/${id(5)}/awards/${hash("d")}/claims/${id(3)}`;
test("claim API is demo-gated, no-store, authenticated and uses role from the path, never body authority",async()=>{
  const history=await request("/api/v1/athlete/rewards/claims-v3");assert.equal(history.status,200);assert.match(history.headers["Cache-Control"],/no-store/);
  assert.deepEqual(history.body,page());
  const disabled=await request(base+"/signing",{disabled:true});assert.equal(disabled.routed,false);assert.equal(disabled.auth,0);
  assert.equal((await request(base+"/signing",{authError:"Unauthorized"})).status,401);
  assert.equal((await request(base+"/signing",{authError:"Untrusted browser origin"})).status,403);
  const missing=await request(base+"/signing");assert.equal(missing.status,404);assert.equal(missing.calls[0].args.p_role,"recipient");
  const organizer=await request(base.replace("athlete","organizer")+"/signing");assert.equal(organizer.calls[0].args.p_role,"operator");
  assert.equal((await request(base+"/prepare",{method:"POST"})).routed,false);
  assert.equal((await request(base+"/signing",{noReader:true})).status,503);
  for(const query of ["?role=operator","?chainId=143","?actor="+id(8)]){const r=await request(base+"/signing"+query);assert.equal(r.status,400);assert.equal(r.calls.length,0);}
  for(const query of ["?after=not-a-uuid","?after="+id(3)+"&after="+id(4),"?userId="+id(8)])assert.equal((await request("/api/v1/athlete/rewards/claims-v3"+query)).status,400);
  for(const body of [{signature:"0x"},{signature:"0x"+"a".repeat(130),role:"operator"},{signature:"0x"+"a".repeat(130),amountWei:"999"}]){
    const r=await request(base+"/proof",{method:"POST",body});assert.equal(r.status,400);assert.equal(r.calls.length,0);
  }
  const prepare={reviewId:id(6),sourceGuardHash:"a".repeat(64),profileFingerprint:"b".repeat(64)};
  assert.equal((await request(base.replace("athlete","organizer")+"/prepare",{method:"POST",body:prepare})).status,404);
  assert.equal((await request(base.replace("athlete","organizer")+"/prepare",{method:"POST",body:{...prepare,nonce:"1"}})).status,400);
});
test("claim errors are bounded and no SQL, witness or signing material escapes",async()=>{
  for(const [error,status] of [["reward_account_session_required",401],["reward_readiness_scope_required",404],["reward_claim_readiness_required",409],
    ["reward_recipient_consent_required",409],["reward_claim_window_unavailable",409],["reward_ledger_idempotency_conflict",409],["secret SQL signature",503]]){
    const r=await request(base+"/signing",{error});assert.equal(r.status,status);assert.doesNotMatch(JSON.stringify(r.body),/secret SQL signature/);
  }
});
