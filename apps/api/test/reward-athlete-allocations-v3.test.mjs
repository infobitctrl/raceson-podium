import assert from "node:assert/strict";
import test from "node:test";
import { decodeAthleteAllocationsV3 } from "../../../packages/domain/dist/rewards/athlete-allocations-v3.js";
import { readOwnRewardAllocationsV3 } from "../../../packages/db/dist/rewards/index.js";
import { dispatchAthleteRewardRoutes } from "../dist/routes/rewards/athlete.js";
const id = n => `81000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const identity = { userId: id(1), sessionId: id(2) };
const award = { entitlementId: `0x${"a".repeat(64)}`, approvalId: id(3), draftId: id(4), slot: 1,
  athleteProfileId: id(5), chainId: 31337, sourceKind: "synthetic_rehearsal", amountWei: "1000000000000000001",
  campaignAddress: `0x${"b".repeat(40)}`, recordedAt: "2026-09-10T18:00:00.000Z", ageStatus: "unverified_adult" };
const fixture = () => ({ schema: "raceson-own-allocations-v3", chainId: 31337, items: [{ ...award }], nextCursor: null });

test("approved breakdown reconciles exactly and cannot expose extra/private fields", () => {
  const data = fixture();
  data.items[0].breakdown = { schema: "raceson-athlete-award-breakdown-v1", sourceKind: "synthetic_rehearsal",
    components: [{ kind: "placing", categoryId: id(8), sourceRowId: id(9), rank: 2, poolWei: "9000000000000000000", amountWei: award.amountWei }] };
  assert.deepEqual(decodeAthleteAllocationsV3(data), data);
  for (const change of [b=>b.components[0].amountWei="1", b=>b.components[0].rank=11,
    b=>b.components[0].rank=0, b=>b.components[0].poolWei="1", b=>b.components[0].wallet="private",
    b=>b.components[0].sourceRowId="not-an-id", b=>b.components.push({...b.components[0]}),
    b=>b.components=[], b=>b.sourceKind="minimized_source", b=>b.proofs="private"]) {
    const bad=structuredClone(data);change(bad.items[0].breakdown);assert.throws(()=>decodeAthleteAllocationsV3(bad));
  }
});
test("league distance and placing are additive; distance evidence is bounded to five finishes", () => {
  const data=fixture();Object.assign(data.items[0],{slot:6,sourceKind:"final_league",amountWei:"10",breakdown:{
    schema:"raceson-athlete-award-breakdown-v1",sourceKind:"synthetic_rehearsal",components:[
      {kind:"placing",categoryId:id(8),sourceRowId:id(9),rank:25,poolWei:"50",amountWei:"4"},
      {kind:"participation",metres:"30000",totalMetres:"100000",finishes:2,resultIds:[id(10),id(11)],poolWei:"20",amountWei:"6"},
    ]}});
  assert.deepEqual(decodeAthleteAllocationsV3(data),data);
  for(const change of [a=>a.slot=1,a=>a.breakdown.components[0].rank=26,a=>a.breakdown.components[1].metres="100001",
    a=>a.breakdown.components[1].finishes=6,a=>a.breakdown.components[1].resultIds=[id(10),id(10)],
    a=>a.breakdown.components[1].amountWei="7",a=>a.breakdown.components[1].resultIds.push(id(12))]) {
    const bad=structuredClone(data);change(bad.items[0]);assert.throws(()=>decodeAthleteAllocationsV3(bad));
  }
});

test("only the two explicitly approved testnet personas have synthetic discovery labels",()=>{
  for(const profile of ["9a000000-0000-4000-8000-000000001060","9a000000-0000-4000-8000-000000001061"]){
    const page=fixture();page.chainId=10143;
    Object.assign(page.items[0],{chainId:10143,draftId:"9a000000-0000-4000-8000-000000000052",athleteProfileId:profile,ageStatus:"synthetic_test"});
    assert.deepEqual(decodeAthleteAllocationsV3(page,10143),page);
    for(const patch of [{athleteProfileId:"9a000000-0000-4000-8000-000000001062"},{draftId:id(4)},{chainId:31337}]){
      const bad=structuredClone(page);Object.assign(bad.items[0],patch);assert.throws(()=>decodeAthleteAllocationsV3(bad,10143));
    }
  }
});

test("V3 recipient document is exact, versioned, integer-safe and not a claim or payment", () => {
  assert.deepEqual(decodeAthleteAllocationsV3(fixture(),31337),fixture());
  for (const change of [r=>r.privateSalt="hidden",r=>r.items[0].paid=true,r=>r.items[0].amountWei=1,
    r=>r.items[0].amountWei="0",r=>r.items[0].amountWei=(2n**256n).toString(),r=>r.items[0].chainId=10143,
    r=>r.items[0].slot=5,r=>r.items[0].ageStatus="ready",r=>r.items[0].sourceKind="real_results",
    r=>r.items.push({...r.items[0]}),r=>r.nextCursor=r.items[0].entitlementId,r=>r.chainId=143]) {
    const data=fixture();change(data);assert.throws(()=>decodeAthleteAllocationsV3(data,31337),/invalid_reward_athlete_allocations_v3/);
  }
  assert.throws(()=>decodeAthleteAllocationsV3(fixture(),10143));
  assert.throws(()=>decodeAthleteAllocationsV3(fixture(),31337,award.entitlementId));
  const page=fixture();page.items=Array.from({length:50},(_,i)=>({...award,entitlementId:`0x${BigInt(i+1).toString(16).padStart(64,"0")}`}));
  page.nextCursor=page.items.at(-1).entitlementId;assert.equal(decodeAthleteAllocationsV3(page,31337).items.length,50);
  page.items.push({...award});assert.throws(()=>decodeAthleteAllocationsV3(page,31337));
});
test("recipient DB reader sends only authenticated identity and configured chain, never an operator identity",async()=>{
  const calls=[];const result=await readOwnRewardAllocationsV3(identity,31337,null,async(name,args)=>{calls.push({name,args});return{data:fixture(),error:null};});
  assert.deepEqual(result,fixture());assert.deepEqual(calls,[{name:"service_read_own_reward_allocations_v3",args:{p_user_id:id(1),p_session_id:id(2),p_chain_id:31337,p_after_id:null}}]);
  for(const [message,code] of [["reward_account_session_required","reward_account_session_required"],["private database detail","reward_ledger_store_failed"]])
    await assert.rejects(readOwnRewardAllocationsV3(identity,31337,null,async()=>({data:null,error:{message}})),{code});
});
test("final athlete discovery labels the native and league sources without granting claim or paid status",()=>{
  for(const [slot,sourceKind] of [[5,"native_finale"],[6,"final_league"]]){
    const page=fixture();Object.assign(page.items[0],{slot,sourceKind});
    assert.deepEqual(decodeAthleteAllocationsV3(page,31337),page);
    for(const kind of ["synthetic_rehearsal","minimized_source",slot===5?"final_league":"native_finale"]){
      const bad=structuredClone(page);bad.items[0].sourceKind=kind;
      assert.throws(()=>decodeAthleteAllocationsV3(bad,31337));
    }
    const historical=structuredClone(page);historical.items[0].slot=1;
    assert.throws(()=>decodeAthleteAllocationsV3(historical,31337));
  }
});
async function request(path,options={}) {
  let authenticated=0,calls=0;const headers={};const res={setHeader:(k,v)=>headers[k]=v};
  const routed=await dispatchAthleteRewardRoutes({method:options.method??"GET"},res,new URL(path,"http://127.0.0.1:3101"),{
    config:()=>options.disabled?null:{chainId:31337,origin:"http://127.0.0.1:3101"},
    requireIdentity:async()=>{authenticated++;if(options.authError)throw Error("Unauthorized");return identity;},
    readJsonBody:async()=>{throw Error("read-only");},
    applyPrivateSessionHeaders:r=>{r.setHeader("Cache-Control","private, no-store");r.setHeader("Vary","Authorization, Cookie");},
    sendSuccess:(r,data)=>{r.status=200;r.body=data;},sendError:(r,status,code)=>{r.status=status;r.body={code};},
    rpc:async(name,args)=>{calls++;assert.equal(name,"service_read_own_reward_allocations_v3");assert.equal(args.p_user_id,identity.userId);assert.equal(args.p_chain_id,31337);
      return options.error?{data:null,error:{message:options.error}}:{data:fixture(),error:null};},
  });
  return{...res,headers,routed,authenticated,calls};
}
const path="/api/v1/athlete/rewards/programme-allocations-v3";
test("demo V3 route is private, authenticated and read-only",async()=>{
  const r=await request(path);assert.equal(r.status,200);assert.deepEqual(r.body,fixture());assert.match(r.headers["Cache-Control"],/no-store/);
  assert.equal((await request(path,{method:"POST"})).routed,false);
  const disabled=await request(path,{disabled:true});assert.equal(disabled.routed,false);assert.equal(disabled.authenticated,0);
  assert.equal((await request(path,{authError:true})).status,401);
  assert.equal((await request(path,{error:"reward_account_session_required"})).status,401);
  const hidden=await request(path,{error:"secret row detail"});assert.equal(hidden.status,503);assert.doesNotMatch(JSON.stringify(hidden),/secret row detail/);
});
test("recipient query cannot substitute chain, account, profile, operator or version",async()=>{
  for(const query of ["?chainId=10143","?userId="+id(9),"?profileId="+id(9),"?actor="+id(9),"?after="+id(5),"?after=invalid","?after=0x"+"0".repeat(64)+"&after=duplicate"]){
    const r=await request(path+query);assert.equal(r.status,400);assert.equal(r.calls,0);
  }
});

test("origin metadata is bounded, scoped to the pot and never an execution capability", () => {
  const data=fixture();
  data.items[0].origin={schema:"raceson-reward-origin-v1",programmeName:"Summer League · 2026",hostName:"Trail club",potKind:"race",
    roundId:id(20),eventName:"Forest Trail",eventEditionId:id(21),eventDate:"2026-09-01",sourceKind:"synthetic_rehearsal"};
  assert.deepEqual(decodeAthleteAllocationsV3(data),data);
  for(const change of [o=>o.programmeName="",o=>o.hostName="x".repeat(513),o=>o.potKind="league",o=>o.roundId=null,
    o=>o.eventEditionId=null,o=>o.eventName=null,o=>o.eventDate="2026-02-31",o=>o.eventDate="today",o=>o.sourceKind="minimized_source",
    o=>o.claimable=true,o=>o.wallet="private",o=>o.programmeName="name\nother"]){
    const bad=structuredClone(data);change(bad.items[0].origin);assert.throws(()=>decodeAthleteAllocationsV3(bad));
  }
  const league=structuredClone(data);Object.assign(league.items[0],{slot:6,sourceKind:"final_league"});
  Object.assign(league.items[0].origin,{potKind:"league",roundId:null,eventName:null,eventEditionId:null,eventDate:null});
  assert.deepEqual(decodeAthleteAllocationsV3(league),league);
  league.items[0].origin.eventName="Wrong event";assert.throws(()=>decodeAthleteAllocationsV3(league));
});
