import assert from "node:assert/strict";
import test from "node:test";
import { decodeClubPaymentAttemptV3,decodeClubPaymentStatusV3 } from "../../../packages/db/dist/rewards/index.js";
import { dispatchClubPaymentActionsV3 } from "../dist/routes/rewards/club-payment-actions-v3.js";
import { dispatchClubClaimsV3 } from "../dist/routes/rewards/club-claims-v3.js";
const id=n=>`8fb10000-0000-4000-8000-${String(n).padStart(12,"0")}`,hash=n=>"0x"+n.repeat(64),address=n=>"0x"+n.repeat(40);
const identity={userId:id(1),sessionId:id(2)},scope={chainId:31337,uploadId:id(3),requestId:id(4),entitlementId:hash("a"),claimId:id(5),role:"recipient"};
const attempt=()=>({protocolVersion:3,chainId:31337,contractAddress:address("b"),relayerAddress:address("c"),nonce:"0",
  transactionHash:hash("d"),calldataHash:hash("e"),signedTransaction:"0x02ab",gasLimit:"600000",maxFeePerGas:"30000000000",maxPriorityFeePerGas:"0",
  operatorDigest:hash("f"),recipientDigest:hash("1"),wrappedRecipientDigest:hash("2"),safeExecutionNonce:"0",
  consentCheckpoint:{number:"200",hash:hash("3"),timestamp:"1801000000"}});
test("club attempt schema binds Safe consent checkpoint, wrapper and bounded canonical transaction bytes",()=>{
  const a=attempt();assert.equal(decodeClubPaymentAttemptV3(a).safeExecutionNonce,0n);
  for(const patch of [{protocolVersion:2},{chainId:143},{signedTransaction:"0x03ab"},{signedTransaction:"0x02"+"ab".repeat(12288)},
    {wrappedRecipientDigest:hash("0")},{safeExecutionNonce:"-1"},{safeExecutionNonce:(1n<<256n).toString()},
    {consentCheckpoint:{...a.consentCheckpoint,number:"0"}},{nonce:"9007199254740992"},{maxPriorityFeePerGas:"30000000001"},{signature:"never"}])
    assert.throws(()=>decodeClubPaymentAttemptV3({...a,...patch}));
  const {wrappedRecipientDigest:_,...athleteShaped}=a;assert.throws(()=>decodeClubPaymentAttemptV3(athleteShaped));
});
const status=()=>({schema:"raceson-club-payment-status-v3",...scope,recipientAddress:address("b"),amountWei:"123",paymentId:null,
  state:"not_prepared",transactionHash:null,confirmed:false,blockNumber:null,blockHash:null,readinessHeld:false});
test("club status reports persisted confirmation separately from current holds, never signatures",()=>{
  const s=status();delete s.role;
  assert.equal(decodeClubPaymentStatusV3(s,scope).confirmed,false);
  const paid={...s,paymentId:id(6),state:"confirmed",transactionHash:hash("d"),confirmed:true,blockNumber:"210",blockHash:hash("e"),readinessHeld:true};
  assert.equal(decodeClubPaymentStatusV3(paid,scope).readinessHeld,true);
  for(const patch of [{requestId:id(7)},{schema:"raceson-athlete-payment-status-v3"},{amountWei:123},{confirmed:true},{state:"confirmed"},{signature:"never"}])
    assert.throws(()=>decodeClubPaymentStatusV3({...s,...patch},scope));
});
async function request({kind="actions",role="organizer",method="GET",body,query="",disabled=false,error,authError}={}){
  const res={},calls=[];
  const endpoint=kind==="actions"?`payment-actions/${id(6)}`:"payment";
  const path=`http://127.0.0.1:3101/api/v1/${role}/rewards/uploads/${scope.uploadId}/club-treasuries/${scope.requestId}/awards/${scope.entitlementId}/claims/${scope.claimId}/${endpoint}${query}`;
  const handled=await (kind==="actions"?dispatchClubPaymentActionsV3:dispatchClubClaimsV3)({method},res,new URL(path),{
    config:()=>disabled?null:{chainId:31337,origin:"http://127.0.0.1:3101"},requireIdentity:async()=>{if(authError)throw Error(authError);return identity;},
    readJsonBody:async()=>body,applyPrivateSessionHeaders:()=>res.private=true,
    rpc:async(name,args)=>{calls.push({name,args});return{data:null,error:{message:error??"reward_club_readiness_scope_required"}};},
    sendSuccess:(_,data)=>Object.assign(res,{status:200,data}),sendError:(_,status,code)=>Object.assign(res,{status,code})
  });return{res,calls,handled};
}
test("club actions are demo-only organizer prepare/queue; no browser signing or sending capability",async()=>{
  assert.equal((await request({disabled:true})).calls.length,0);
  assert.equal((await request({role:"club"})).handled,false);
  for(const authError of ["Unauthorized","Missing bearer token","reward_account_session_required"]){
    const r=await request({authError});assert.equal(r.res.status,401);assert.equal(r.calls.length,0);assert.equal(r.res.private,true);
  }
  assert.equal((await request({authError:"Untrusted browser origin"})).res.status,403);
  for(const kind of ["sign","send","arm","pay","confirm"]){
    const r=await request({method:"POST",body:{kind}});assert.equal(r.res.status,400);assert.equal(r.calls.length,0);
  }
  assert.equal((await request({query:"?chainId=143"})).res.status,400);
  const r=await request();assert.equal(r.res.status,404);assert.equal(r.calls[0].name,"service_read_reward_club_payment_v3");
  assert.equal(r.calls[0].args.p_request_id,scope.requestId);assert.equal(r.calls[0].args.p_actor_session_id,identity.sessionId);
  const hidden=await request({error:"private-sql-sentinel"});assert.equal(hidden.res.status,503);assert.doesNotMatch(JSON.stringify(hidden.res),/private-sql/);
});
test("club receipt status uses each viewer's own session and needs no blockchain reader",async()=>{
  for(const [role,p_role] of [["club","recipient"],["organizer","operator"]]){
    const r=await request({kind:"status",role});assert.equal(r.res.status,404);
    assert.equal(r.calls[0].name,"service_read_reward_club_payment_status_v3");
    assert.equal(r.calls[0].args.p_role,p_role);assert.equal(r.calls[0].args.p_actor_user_id,identity.userId);
    assert.equal(r.res.private,true);
  }
  assert.equal((await request({kind:"status",role:"club",method:"POST"})).handled,false);
  assert.equal((await request({kind:"status",role:"club",query:"?role=operator"})).res.status,400);
});
