import assert from "node:assert/strict";
import test from "node:test";
import { toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { rewardWalletControlMessage,verifyRewardWalletControl } from "../../../packages/rewards-chain/dist/index.js";
import { requestRewardAthleteDestination,readRewardAthleteDestination,withdrawRewardAthleteDestination,listRewardAthleteDestinations } from "../../../packages/db/dist/rewards/index.js";
import { submitAthleteRewardDestination } from "../dist/features/rewards/athlete-destination-service.js";
import { dispatchAthleteRewardRoutes } from "../dist/routes/rewards/athlete.js";
import { applyPrivateSessionHeaders } from "../dist/browser-session.js";

const id=n=>`79000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const signer=privateKeyToAccount(toHex(993n,{size:32})); // Synthetic, no real wallet.
async function fixture(){
  const identity={userId:id(1),sessionId:id(2)};
  const config={chainId:31337,origin:"http://127.0.0.1:5173"};
  const c={challengeId:id(3),...identity,...config,address:signer.address.toLowerCase(),nonce:"c".repeat(64),
    issuedAt:"2026-09-08T07:00:00Z",expiresAt:"2026-09-08T07:10:00Z",checkedAt:"2026-09-08T07:00:02Z",idempotencyKey:"destination-proof",proof:null};
  const signature=await signer.signMessage({message:rewardWalletControlMessage(c)});
  c.proof={proofId:id(4),...await verifyRewardWalletControl(c,signature),verifiedAt:"2026-09-08T07:00:01Z"};
  const d={requestId:id(5),...identity,athleteProfileId:id(6),proofId:id(4),address:c.address,chainId:31337,
    requestedAt:"2026-09-08T07:00:02Z",idempotencyKey:"destination-request",withdrawnAt:null,status:"pending_review"};
  const calls=[];const rpc=async(name,args)=>{calls.push({name,args:structuredClone(args)});
    assert.equal(args.p_user_id,id(1));assert.equal(args.p_session_id,identity.sessionId);
    if(name==="service_read_reward_wallet_challenge")return{data:structuredClone(c),error:null};
    if(name==="service_list_reward_athlete_destinations")return{data:{items:[structuredClone(d)],nextCursor:null},error:null};
    if(name==="service_withdraw_reward_athlete_destination"){d.status="withdrawn";d.withdrawnAt="2026-09-08T07:00:03Z";}
    return{data:structuredClone(d),error:null};};
  return{identity,config,c,d,calls,rpc,input:{challengeId:id(3),athleteProfileId:id(6),idempotencyKey:"destination-request"}};
}
test("destination selection re-verifies stored cryptographic control and returns a pending choice, never authorization",async()=>{
  const f=await fixture();const result=await submitAthleteRewardDestination(f.identity,f.input,{...f.config,rpc:f.rpc});
  assert.equal(result.status,"pending_review");assert.equal(result.address,signer.address.toLowerCase());
  assert.deepEqual(f.calls.map(c=>c.name),["service_read_reward_wallet_challenge","service_request_reward_athlete_destination"]);
  assert.deepEqual(f.calls[1].args,{p_user_id:id(1),p_session_id:id(2),p_athlete_profile_id:id(6),p_proof_id:id(4),p_idempotency_key:"destination-request"});
  assert.doesNotMatch(JSON.stringify(result),/proofId|sessionId|userId|signature|messageHash|amount|nonce|approved|active/);
});
test("missing, tampered and foreign-network wallet proofs never create a destination request",async()=>{
  for(const change of [f=>{f.c.proof=null;},f=>{f.c.proof.signature=`0x${"ff".repeat(65)}`;},
    f=>{f.c.proof.messageHash=`0x${"ab".repeat(32)}`;},f=>{f.c.chainId=10143;f.c.origin="https://www.raceson.com";}]){
    const f=await fixture();change(f);
    await assert.rejects(submitAthleteRewardDestination(f.identity,f.input,{...f.config,rpc:f.rpc}));
    assert.equal(f.calls.length,1);
  }
});
test("repository refuses foreign, corrupt or activated destination documents",async()=>{
  const f=await fixture();
  for(const patch of [{requestId:id(90)},{userId:id(90)},{chainId:143},{status:"approved"},{amountWei:"100"},{address:"0x"},
    {status:"withdrawn"},{withdrawnAt:"2026-09-08T06:00:00Z",status:"withdrawn"}])
    await assert.rejects(readRewardAthleteDestination(f.identity,id(5),async()=>({data:{...f.d,...patch},error:null})));
  await assert.rejects(requestRewardAthleteDestination(f.identity,{athleteProfileId:id(6),proofId:id(4),idempotencyKey:"other-key"},f.rpc));
  await assert.rejects(withdrawRewardAthleteDestination(f.identity,id(5),async()=>({data:f.d,error:null})));
});
test("old-session history can be read and withdrawn by the same newly authenticated account without renewal",async()=>{
  const f=await fixture();f.identity.sessionId=id(7);
  assert.equal((await readRewardAthleteDestination(f.identity,id(5),f.rpc)).sessionId,id(2));
  assert.equal((await withdrawRewardAthleteDestination(f.identity,id(5),f.rpc)).status,"withdrawn");
  assert.equal(f.calls[1].args.p_session_id,id(7));
});
test("selection freezes input and authenticated identity before asynchronous reads",async()=>{
  const f=await fixture();
  const rpc=async(name,args)=>{const result=await f.rpc(name,args);if(name==="service_read_reward_wallet_challenge"){
    f.input.athleteProfileId=id(90);f.input.idempotencyKey="changed-key";f.identity.userId=id(90);
  }return result;};
  const result=await submitAthleteRewardDestination(f.identity,f.input,{...f.config,rpc});assert.equal(result.athleteProfileId,id(6));
});
test("database failures expose only bounded destination error codes",async()=>{
  const f=await fixture();
  for(const [message,code] of [["reward_destination_profile_required","reward_destination_profile_required"],
    ["reward_destination_withdraw_first","reward_destination_withdraw_first"],["private SQL address and identity detail","reward_ledger_store_failed"]])
    await assert.rejects(readRewardAthleteDestination(f.identity,id(5),async()=>({data:null,error:{message}})),{code});
});
async function route(f,method,path,body={},overrides={}){
  const res={statusCode:200,headers:{},setHeader(name,value){this.headers[name]=value;},end(value){this.body=JSON.parse(value);}};
  const routed=await dispatchAthleteRewardRoutes({method,headers:{}},res,new URL(path,f.config.origin),{
    config:()=>f.config,requireIdentity:async()=>f.identity,readJsonBody:async()=>body,applyPrivateSessionHeaders,rpc:f.rpc,
    sendSuccess:(r,data)=>r.end(JSON.stringify({data})),sendError:(r,status,code,message)=>{r.statusCode=status;r.end(JSON.stringify({error:{code,message}}));},...overrides});
  return{...res,routed};
}
test("destination route submit/read/withdraw exposes only account-scoped pending history with no-store",async()=>{
  const f=await fixture();const base="/api/v1/athlete/rewards/destination-requests";
  for(const [method,path,body,status] of [["POST",base,f.input,"pending_review"],["GET",`${base}/${id(5)}`,{},"pending_review"],
    ["POST",`${base}/${id(5)}/withdraw`,{},"withdrawn"]]){
    const r=await route(f,method,path,body);assert.equal(r.statusCode,200);assert.equal(r.body.data.status,status);
    assert.equal(r.headers["Cache-Control"],"private, no-store");assert.doesNotMatch(JSON.stringify(r.body),/sessionId|userId|proofId|signature/);
  }
});
test("destination routes reject client-assigned address/amount/identity, malformed paths and disabled or unauthorized calls",async()=>{
  const f=await fixture();const base="/api/v1/athlete/rewards/destination-requests";
  for(const extra of [{userId:id(8)},{sessionId:id(8)},{address:signer.address},{amountWei:"100"},{chainId:143},{approved:true}])
    assert.equal((await route(f,"POST",base,{...f.input,...extra})).statusCode,400);
  assert.equal((await route(f,"GET",`${base}/bad`)).statusCode,400);
  assert.equal((await route(f,"POST",`${base}/${id(5)}/withdraw`,{requestId:id(8)})).statusCode,400);
  assert.equal((await route(f,"GET",`${base}/${id(5)}?userId=foreign`)).statusCode,400);
  assert.equal((await route(f,"POST",base,f.input,{config:()=>null})).routed,false);
  assert.equal((await route(f,"POST",base,f.input,{requireIdentity:async()=>{throw new Error("Unauthorized");}})).statusCode,401);
  assert.equal(f.calls.length,0);
});
test("destination routes distinguish missing, ownership, stale proof, withdrawal conflict and private storage failures",async()=>{
  const f=await fixture();const path=`/api/v1/athlete/rewards/destination-requests/${id(5)}`;
  for(const [message,status] of [["reward_destination_not_found",404],["reward_destination_profile_required",403],["reward_destination_proof_required",403],
    ["reward_wallet_challenge_expired",400],["reward_destination_withdraw_first",409],["private SQL identity",503]]){
    const r=await route(f,"GET",path,{}, {rpc:async()=>({data:null,error:{message}})});
    assert.equal(r.statusCode,status);assert.doesNotMatch(JSON.stringify(r.body),/private SQL/);
  }
});
test("destination history is account-scoped, bounded and strictly ordered, including historical sessions",async()=>{
  const f=await fixture();const items=Array.from({length:50},(_,n)=>({...f.d,requestId:id(100+n)}));
  const rpc=async(name,args)=>{assert.equal(name,"service_list_reward_athlete_destinations");assert.equal(args.p_user_id,id(1));
    assert.equal(args.p_session_id,id(2));assert.equal(args.p_after_id,id(99));return{data:{items,nextCursor:id(149)},error:null};};
  const page=await listRewardAthleteDestinations(f.identity,id(99),rpc);assert.equal(page.items.length,50);
  for(const data of [{items:[f.d,f.d],nextCursor:null},{items,nextCursor:id(148)},
    {items:[{...f.d,userId:id(9)}],nextCursor:null},{items:[f.d],nextCursor:id(5)},{items:[...items,f.d],nextCursor:null}])
    await assert.rejects(listRewardAthleteDestinations(f.identity,null,async()=>({data,error:null})));
  const response=await route(f,"GET","/api/v1/athlete/rewards/destination-requests");
  assert.equal(response.body.data.items[0].requestId,id(5));assert.equal(response.headers["Cache-Control"],"private, no-store");
  assert.doesNotMatch(JSON.stringify(response.body),/userId|sessionId|proofId|idempotencyKey|signature/);
  for(const query of ["?after=bad","?after=a&after=b","?userId=foreign"])
    assert.equal((await route(f,"GET",`/api/v1/athlete/rewards/destination-requests${query}`)).statusCode,400);
});
