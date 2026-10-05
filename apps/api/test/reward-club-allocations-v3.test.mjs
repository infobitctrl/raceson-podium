import assert from "node:assert/strict";
import test from "node:test";
import { decodeClubAllocationsV3 } from "../../../packages/domain/dist/rewards/club-allocations-v3.js";
import { listRewardClubAllocationsV3 } from "../../../packages/db/dist/rewards/index.js";
import { dispatchClubAllocationsV3 } from "../dist/routes/rewards/club-allocations-v3.js";
const id=n=>`81000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const hash=n=>`0x${BigInt(n).toString(16).padStart(64,"0")}`;
const identity={userId:id(1),sessionId:id(2)},clubId=id(5),address="0x"+"b".repeat(40);
const award={entitlementId:hash(1),approvalId:id(3),draftId:id(4),slot:1,sourceKind:"synthetic_rehearsal",amountWei:"1000000000000000001",
  campaignAddress:address,recordedAt:"2026-09-11T07:00:00.000Z",allocationRevision:"latest",uploadId:null,claimAccess:"not_prepared",claim:null,payment:null};
const fixture=()=>({schema:"raceson-club-allocations-v3",chainId:31337,clubId,items:[{...award}],nextCursor:null});
const claim={claimId:id(7),requestId:id(8),recipientAddress:address,recipientConsented:true,operatorApproved:true};
const prepared={state:"prepared",recipientAddress:address,transactionHash:null,confirmed:false,blockNumber:null,blockHash:null};
const decode=raw=>decodeClubAllocationsV3(raw,31337,clubId);

test("club discovery is exact, lossless and distinguishes allocation revisions from execution",()=>{
  assert.deepEqual(decode(fixture()),fixture());
  for(const edit of [p=>p.privateSalt="secret",p=>p.clubId=id(99),p=>p.chainId=143,p=>p.items[0].paid=true,p=>p.items[0].amountWei=1,
    p=>p.items[0].amountWei="0",p=>p.items[0].amountWei=(1n<<256n).toString(),p=>p.items[0].allocationRevision="ready",
    p=>p.items[0].campaignAddress="0x"+"0".repeat(40),p=>p.items[0].slot=5,p=>p.items[0].entitlementId=hash(0),
    p=>p.items[0].claimAccess="available",p=>p.items[0].claimAccess="organizer_required",p=>p.items.push({...award})]){
    const p=fixture();edit(p);assert.throws(()=>decode(p),/invalid_reward_club_allocations_v3/);
  }
  for(const [slot,sourceKind] of [[1,"minimized_source"],[5,"native_finale"],[6,"final_league"]]){
    const p=fixture();Object.assign(p.items[0],{slot,sourceKind,allocationRevision:"superseded"});assert.deepEqual(decode(p),p);
  }
});
test("club claim and confirmed payment metadata cannot invent consent, finality or leak private fields",()=>{
  for(const state of ["prepared","signed","queued","leased","broadcasting","submitted","confirmed"]){
    const p=fixture(),payment={...prepared,state,transactionHash:state==="prepared"?null:hash(20),confirmed:state==="confirmed",
      blockNumber:state==="confirmed"?"123":null,blockHash:state==="confirmed"?hash(21):null};
    Object.assign(p.items[0],{uploadId:id(6),claimAccess:"available",claim:{...claim},payment});assert.deepEqual(decode(p),p);
    for(const edit of [a=>a.claim.signature="private",a=>a.claim.operatorApproved="yes",a=>a.claim.recipientConsented=false,
      a=>a.payment.signedTransaction="private",a=>a.payment.confirmed=!a.payment.confirmed,
      a=>a.payment.blockNumber=123,a=>a.payment.transactionHash=null,a=>a.payment.blockHash="invalid"]){
      const bad=structuredClone(p);edit(bad.items[0]);if(JSON.stringify(bad)===JSON.stringify(p))continue;assert.throws(()=>decode(bad));
    }
    // A new owner may see club financial metadata, but not the previous nominee's private claim handles.
    p.items[0].claimAccess="organizer_required";p.items[0].claim=null;assert.deepEqual(decode(p),p);
    p.items[0].claim={...claim};assert.throws(()=>decode(p));
  }
});
test("club pagination rejects UUID cursors, duplicates, gaps and invoking accessors",()=>{
  const p=fixture();p.items=Array.from({length:50},(_,n)=>({...award,entitlementId:hash(n+1)}));p.nextCursor=hash(50);
  assert.equal(decode(p).items.length,50);
  assert.throws(()=>decodeClubAllocationsV3(p,31337,clubId,hash(1)));
  assert.throws(()=>decodeClubAllocationsV3(p,31337,clubId,id(1)));
  p.nextCursor=hash(49);assert.throws(()=>decode(p));p.nextCursor=null;p.items.push({...award,entitlementId:hash(51)});assert.throws(()=>decode(p));
  for(const edit of [p=>delete p.items[0],p=>p.items.extra=true,p=>p.items[Symbol("secret")]=true,
    p=>Object.defineProperty(p.items[0],"amountWei",{get(){assert.fail("accessor invoked");}}),
    p=>Object.defineProperty(p.items,"0",{get(){assert.fail("accessor invoked");}})]){
    const bad=fixture();edit(bad);assert.throws(()=>decode(bad),/invalid_reward_club_allocations_v3/);
  }
});
test("club repository scopes one read-only RPC to authenticated identity, club and configured chain",async()=>{
  const calls=[],rpc=async(name,args)=>{calls.push({name,args});return{data:fixture(),error:null};};
  assert.deepEqual(await listRewardClubAllocationsV3(identity,{chainId:31337,clubId},rpc),fixture());
  assert.deepEqual(calls,[{name:"service_list_reward_club_allocations_v3",args:{p_user_id:id(1),p_session_id:id(2),p_chain_id:31337,p_club_id:clubId,p_after_id:null}}]);
  for(const input of [{chainId:143,clubId},{chainId:31337,clubId,after:id(1)}])
    await assert.rejects(listRewardClubAllocationsV3(identity,input,rpc),{code:"invalid_reward_club_allocation_query"});
  assert.equal(calls.length,1);
  for(const [message,code] of [["reward_account_session_required","reward_account_session_required"],["reward_club_owner_required","reward_club_owner_required"],["private detail","reward_ledger_store_failed"]])
    await assert.rejects(listRewardClubAllocationsV3(identity,{chainId:31337,clubId},async()=>({error:{message}})),{code});
  await assert.rejects(listRewardClubAllocationsV3(identity,{chainId:31337,clubId},async()=>{throw Error("private transport");}),{code:"reward_ledger_unavailable"});
});
const path=`/api/v1/club/rewards/clubs/${clubId}/allocations-v3`;
async function request(url=path,options={}){
  let calls=0,auth=0;const res={headers:{}};
  const routed=await dispatchClubAllocationsV3({method:options.method??"GET"},res,new URL(url,"http://127.0.0.1:3101"),{
    config:()=>options.disabled?null:{chainId:31337,origin:"http://127.0.0.1:3101"},
    requireIdentity:async()=>{auth++;if(options.authError)throw Error(options.authError);return identity;},
    readJsonBody:()=>assert.fail("read-only"),applyPrivateSessionHeaders:r=>r.headers["Cache-Control"]="private, no-store",
    sendSuccess:(r,data)=>{r.status=200;r.body=data;},sendError:(r,status,code)=>{r.status=status;r.body={code};},
    rpc:async(name,args)=>{calls++;assert.equal(name,"service_list_reward_club_allocations_v3");assert.equal(args.p_club_id,clubId);
      return options.error?{error:{message:options.error}}:{data:options.data??fixture(),error:null};}
  });return{...res,routed,calls,auth};
}
test("private demo club endpoint is authenticated, owner-scoped, no-store and GET only",async()=>{
  const r=await request();assert.equal(r.status,200);assert.deepEqual(r.body,fixture());assert.match(r.headers["Cache-Control"],/no-store/);
  assert.equal((await request(path,{method:"POST"})).routed,false);assert.equal((await request(path,{disabled:true})).auth,0);
  for(const authError of ["Unauthorized","Missing bearer token"])assert.equal((await request(path,{authError})).status,401);
  assert.equal((await request(path,{authError:"Untrusted browser origin"})).status,403);
  for(const [error,status] of [["reward_account_session_required",401],["reward_club_owner_required",403],["private detail",503]]){
    const r=await request(path,{error});assert.equal(r.status,status);assert.doesNotMatch(JSON.stringify(r),/private detail/);
  }
  const bad=fixture();bad.items[0].signature="private";assert.equal((await request(path,{data:bad})).status,503);
});
test("club discovery cannot substitute account, chain, arbitrary filters or legacy UUID cursor",async()=>{
  for(const suffix of ["?chainId=10143","?userId="+id(9),"?clubId="+id(9),"?after=","?after="+id(1),"?after="+hash(0)+"&after="+hash(0)]){
    const r=await request(path+suffix);assert.equal(r.status,400);assert.equal(r.calls,0);
  }
  assert.equal((await request(path.replace(clubId,"bad"))).status,400);
  assert.equal((await request(path+"?after="+hash(0))).status,200);
});
