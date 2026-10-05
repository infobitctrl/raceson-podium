import assert from "node:assert/strict";
import test from "node:test";
import { decodeClubClaimWitnessV3,decodeClubClaimIntentV3,decodeClubClaimProofV3 } from "../../../packages/db/dist/rewards/index.js";
import { dispatchClubClaimsV3 } from "../dist/routes/rewards/club-claims-v3.js";
const id=n=>`8f300000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const hash=n=>`0x${n.repeat(64)}`,address=n=>`0x${n.repeat(40)}`;
const identity={userId:id(1),sessionId:id(2)};
const witness=()=>({protocolVersion:3,chainId:31337,campaignAddress:address("a"),stageTransactionHash:hash("b"),allocationDigest:hash("c"),
  entitlementId:hash("d"),recipientAddress:address("e"),amountWei:"1000000000000000001",nonce:"0",finalizedBlock:{number:"200",hash:hash("f"),timestamp:"1801000000"},claimDeadline:"1832536000",treasury:{reviewedBlock:{number:"190",hash:hash("9"),timestamp:"1800999990"},
  deploymentBlock:{number:"180",hash:hash("8"),timestamp:"1800999980"},initializerHash:hash("7"),executionNonce:"0"}});
const summary=()=>({schema:"raceson-athlete-claim-record-v3",claimId:id(3),uploadId:id(4),requestId:id(5),entitlementId:hash("d"),chainId:31337,
  recipientAddress:address("e"),amountWei:"1000000000000000001",issuedAt:"1801000000",expiresAt:"1801086400",recipientConsented:false,operatorApproved:false});
const page=()=>({schema:"raceson-own-claims-v3",chainId:31337,items:[summary()],nextCursor:null});
test("V3 claim witness is explicitly versioned and refuses lossy money, exhausted nonce and invalid window",()=>{
  assert.equal(decodeClubClaimWitnessV3(witness()).amountWei,1000000000000000001n);
  for(const change of [w=>w.protocolVersion=2,w=>w.chainId=143,w=>w.amountWei=1,w=>w.amountWei="0",w=>w.nonce=(2n**256n-1n).toString(),
    w=>w.finalizedBlock.timestamp="0",w=>w.finalizedBlock.hash=hash("0"),w=>w.claimDeadline=w.finalizedBlock.timestamp,w=>w.signature="0x"]){
    const w=witness();change(w);assert.throws(()=>decodeClubClaimWitnessV3(w));
  }
});
test("V3 intent decoder binds award, destination, chain, nonce and the exact non-renewable 24-hour maximum",()=>{
  const i={id:id(3),uploadId:id(4),requestId:id(5),reviewId:id(6),entitlementId:hash("d"),chainId:31337,campaignAddress:address("a"),
    recipientUserId:id(1),recipientAddress:address("e"),sourceGuardHash:"a".repeat(64),identityFingerprint:"b".repeat(64),witness:witness(),nonce:"0",
    issuedAt:"1801000000",expiresAt:"1801086400",preparedByUserId:id(7),preparedSessionId:id(8),preparedAt:"2026-09-11T00:00:00Z"};
  assert.equal(decodeClubClaimIntentV3(i).expiresAt,1801086400n);
  for(const patch of [{expiresAt:"1801086401"},{expiresAt:"1801000001"},{issuedAt:"1801000001"},{nonce:"1"},{chainId:10143},{recipientAddress:address("a")},
    {entitlementId:hash("c")},{campaignAddress:address("b")},{witness:{...witness(),claimDeadline:"1801000002"}}])assert.throws(()=>decodeClubClaimIntentV3({...i,...patch}));
  assert.equal(decodeClubClaimIntentV3({...i,witness:{...witness(),claimDeadline:"1801000002"},expiresAt:"1801000002"}).expiresAt,1801000002n);
});
async function request(path,options={}) {
  let auth=0,bodies=0;const calls=[],headers={},res={setHeader:(k,v)=>headers[k]=v};
  const routed=await dispatchClubClaimsV3({method:options.method??"GET"},res,new URL(path,"http://127.0.0.1:3101"),{
    config:()=>options.disabled?null:{chainId:31337,origin:"http://127.0.0.1:3101"},requireIdentity:async()=>{auth++;if(options.authError)throw Error(options.authError);return identity;},
    readJsonBody:async()=>{bodies++;return options.body;},applyPrivateSessionHeaders:r=>r.setHeader("Cache-Control","private, no-store"),
    sendSuccess:(r,body)=>{r.status=200;r.body=body;},sendError:(r,status,code)=>{r.status=status;r.body={code};},clubClaimV3Reader:options.noReader?undefined:{},
    rpc:async(name,args)=>{calls.push({name,args});return {data:null,error:{message:options.error??"reward_claim_scope_required"}};},
  });return{...res,headers,routed,calls,auth,bodies};
}
const base=`/api/v1/club/rewards/uploads/${id(4)}/club-treasuries/${id(5)}/awards/${hash("d")}/claims/${id(3)}`;
test("claim API is demo-gated, no-store, authenticated and uses role from the path, never body authority",async()=>{
  const disabled=await request(base+"/signing",{disabled:true});assert.equal(disabled.routed,false);assert.equal(disabled.auth,0);
  assert.equal((await request(base+"/signing",{authError:"Unauthorized"})).status,401);
  assert.equal((await request(base+"/signing",{authError:"Untrusted browser origin"})).status,403);
  const missing=await request(base+"/signing");assert.equal(missing.status,404);assert.equal(missing.calls[0].args.p_role,"recipient");
  const organizer=await request(base.replace("club","organizer")+"/signing");assert.equal(organizer.calls[0].args.p_role,"operator");
  assert.equal((await request(base+"/prepare",{method:"POST"})).routed,false);
  assert.equal((await request(base+"/signing",{noReader:true})).status,503);
  for(const query of ["?role=operator","?chainId=143","?actor="+id(8)]){const r=await request(base+"/signing"+query);assert.equal(r.status,400);assert.equal(r.calls.length,0);}
  for(const body of [{signature:"0x"},{signature:"0x"+"a".repeat(130),role:"operator"},{signature:"0x"+"a".repeat(130),amountWei:"999"}]){
    const r=await request(base+"/proof",{method:"POST",body});assert.equal(r.status,400);assert.equal(r.calls.length,0);
  }
  const prepare={reviewId:id(6),sourceGuardHash:"a".repeat(64),identityFingerprint:"b".repeat(64)};
  assert.equal((await request(base.replace("club","organizer")+"/prepare",{method:"POST",body:prepare})).status,404);
  assert.equal((await request(base.replace("club","organizer")+"/prepare",{method:"POST",body:{...prepare,nonce:"1"}})).status,400);
});
test("claim errors are bounded and no SQL, witness or signing material escapes",async()=>{
  for(const [error,status] of [["reward_account_session_required",401],["reward_club_readiness_scope_required",404],["reward_claim_readiness_required",409],
    ["reward_recipient_consent_required",409],["reward_claim_window_unavailable",409],["reward_ledger_idempotency_conflict",409],["secret SQL signature",503]]){
    const r=await request(base+"/signing",{error});assert.equal(r.status,status);assert.doesNotMatch(JSON.stringify(r.body),/secret SQL signature/);
  }
});

test("club witness requires exact Safe deployment/review and bounded execution nonce",()=>{
  for(const change of [w=>delete w.treasury,w=>w.treasury.privateKey="x",w=>w.treasury.reviewedBlock.number="201",
    w=>w.treasury.deploymentBlock.number="191",w=>w.treasury.executionNonce="-1",w=>w.treasury.executionNonce=(1n<<256n).toString(),
    w=>w.treasury.initializerHash=hash("0"),w=>w.treasury.reviewedBlock={...w.finalizedBlock,hash:hash("a")}]) {
    const w=witness();change(w);assert.throws(()=>decodeClubClaimWitnessV3(w));
  }
});
test("club proof decoder separates bounded Safe consent from exact operator EOA proof",()=>{
  const p={protocolVersion:3,role:"recipient",signer:address("e"),digest:hash("a"),wrappedDigest:hash("b"),signature:"0x"+"ab".repeat(130)};
  assert.equal(decodeClubClaimProofV3(p).signature,p.signature);
  const operator={...p,role:"operator",wrappedDigest:null,signature:"0x"+"ab".repeat(65)};
  assert.equal(decodeClubClaimProofV3(operator).wrappedDigest,null);
  for(const patch of [{wrappedDigest:null},{signature:"0x"},{signature:"0xa"},{signature:"0x"+"ab".repeat(8193)},
    {protocolVersion:2},{role:"operator"},{role:"operator",wrappedDigest:null},{digest:hash("0")},{verified:true}])
    assert.throws(()=>decodeClubClaimProofV3({...p,...patch}));
});
test("club HTTP allows bounded combined signatures but keeps operator proof 65 bytes and has no send action",async()=>{
  const r=await request(base+"/proof",{method:"POST",body:{signature:"0x"+"ab".repeat(130)}});
  assert.equal(r.status,404);assert.equal(r.calls[0].args.p_role,"recipient");
  assert.equal((await request(base.replace("club","organizer")+"/proof",{method:"POST",body:{signature:"0x"+"ab".repeat(130)}})).status,400);
  for(const endpoint of ["pay","payment","send","fund","activate"])assert.equal((await request(base+"/"+endpoint,{method:"POST"})).routed,false);
});
