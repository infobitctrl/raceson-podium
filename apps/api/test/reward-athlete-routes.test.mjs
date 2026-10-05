import assert from "node:assert/strict";
import test from "node:test";
import { toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { dispatchAthleteRewardRoutes } from "../dist/routes/rewards/athlete.js";
import { authenticateRewardRequest,rewardPortalConfig } from "../dist/features/rewards/request-identity.js";
import { applyPrivateSessionHeaders } from "../dist/browser-session.js";

const id=n=>`79000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const config={chainId:31337,origin:"http://127.0.0.1:5173"};
const signer=privateKeyToAccount(toHex(904n,{size:32}));
const env={supabaseUrl:"https://synthetic-project.supabase.co",supabaseAnonKey:"synthetic-nonusable-publishable-key"};
const claims={iss:"https://synthetic-project.supabase.co/auth/v1",aud:"authenticated",role:"authenticated",sub:id(1),session_id:id(2),is_anonymous:false};
test("reward authentication calls the trusted verifier and rejects foreign/missing/anonymous claims without metadata authorization",async()=>{
  let count=0;const verifier=async token=>{assert.equal(token,"synthetic-token");count++;return{data:{claims},error:null};};
  assert.deepEqual(await authenticateRewardRequest("synthetic-token",env,verifier),{userId:id(1),sessionId:id(2)});assert.equal(count,1);
  for(const patch of [{iss:"https://foreign.supabase.co/auth/v1"},{aud:"service_role"},{role:"anon"},{sub:"bad"},{session_id:undefined},{is_anonymous:true},{is_anonymous:undefined}])
    await assert.rejects(authenticateRewardRequest("synthetic-token",env,async()=>({data:{claims:{...claims,...patch,user_metadata:{role:"owner",userId:id(999)}}},error:null})),/Unauthorized/);
  await assert.rejects(authenticateRewardRequest("synthetic-token",env,async()=>({data:{claims},error:{message:"synthetic credential detail"}})),/Unauthorized/);
  await assert.rejects(authenticateRewardRequest("synthetic-token",env,async()=>{throw new Error("synthetic credential detail");}),{code:"reward_auth_unavailable"});
});
test("reward portal is disabled by default and requires a matching isolated target before any access",()=>{
  const actual={appBaseUrl:config.origin,supabaseUrl:"http://127.0.0.1:54321"};
  const values={RACESON_REWARD_PORTAL_MODE:"local",NODE_ENV:"development",RACESON_REWARD_DEMO_ORIGIN:actual.appBaseUrl,RACESON_REWARD_DEMO_SUPABASE_URL:actual.supabaseUrl};
  assert.equal(rewardPortalConfig({},actual),null);assert.equal(rewardPortalConfig({RACESON_REWARD_PORTAL_MODE:"disabled"},actual),null);
  assert.deepEqual(rewardPortalConfig(values,actual),config);
  for(const [mode,origin,nodeEnv] of [["local",config.origin,"production"],["testnet",config.origin,"development"],["mainnet","https://www.raceson.com","production"],
    ["testnet","https://www.raceson.com.evil.example","production"],["local","http://127.0.0.1:5173/path","development"]])
    assert.throws(()=>rewardPortalConfig({...values,RACESON_REWARD_PORTAL_MODE:mode,NODE_ENV:nodeEnv},{...actual,appBaseUrl:origin}));
});
function fixture(){
  const calls=[];const c={challengeId:id(3),userId:id(1),sessionId:id(2),chainId:31337,address:signer.address.toLowerCase(),origin:config.origin,nonce:"e".repeat(64),
    issuedAt:"2026-09-08T07:00:00Z",expiresAt:"2026-09-08T07:10:00Z",checkedAt:"2026-09-08T07:00:01Z",idempotencyKey:"route-wallet-test",proof:null};
  const rpc=async(name,args)=>{
    calls.push({name,args:structuredClone(args)});assert.equal(args.p_user_id,id(1));assert.equal(args.p_session_id,id(2));
    if(name==="service_read_own_reward_awards")return{data:{items:[{entitlementId:id(10),campaignId:id(20),pot:"race",scopeKey:id(30),chainId:31337,environment:"local_simulation",
      athleteProfileId:id(40),identityChanged:false,amountWei:"999999999999999999",ageStatus:"unverified_adult"}],nextCursor:null},error:null};
    if(name==="service_confirm_reward_wallet_proof")c.proof={proofId:id(4),signature:args.p_signature,messageHash:args.p_message_hash,verifiedAt:"2026-09-08T07:00:02Z"};
    return{data:structuredClone(c),error:null};
  };
  async function request(method,path,body=null,overrides={}){
    const res={statusCode:200,headers:{},setHeader(name,value){this.headers[name]=value;},end(value){this.body=JSON.parse(value);}};
    const req={method,headers:{},url:path};let auth=0;
    const deps={config:()=>config,requireIdentity:async()=>{auth++;return authenticateRewardRequest("synthetic-token",env,async()=>({data:{claims},error:null}));},
      readJsonBody:async()=>body,sendSuccess:(r,data)=>r.end(JSON.stringify({data})),sendError:(r,status,code,message)=>{r.statusCode=status;r.end(JSON.stringify({error:{code,message}}));},
      applyPrivateSessionHeaders,rpc,...overrides};
    const routed=await dispatchAthleteRewardRoutes(req,res,new URL(path,"https://untrusted-host.example"),deps);return{...res,routed,auth};
  }
  return{request,calls,c};
}
test("authenticated route sequence reads exact own amounts and verifies wallet control without returning private proof fields",async()=>{
  const f=fixture();const list=await f.request("GET","/api/v1/athlete/rewards/allocations");
  assert.equal(list.body.data.items[0].amountWei,"999999999999999999");assert.equal(list.auth,1);assert.equal(list.headers["Cache-Control"],"private, no-store");
  const challenge=await f.request("POST","/api/v1/athlete/rewards/wallet-challenges",{address:signer.address,idempotencyKey:"route-wallet-test"});
  assert.equal(challenge.statusCode,200);assert.match(challenge.body.data.message,/127\.0\.0\.1:5173/);
  assert.doesNotMatch(challenge.body.data.message,/untrusted-host/);
  const signature=await signer.signMessage({message:challenge.body.data.message});
  const verified=await f.request("POST","/api/v1/athlete/rewards/wallet-proofs",{challengeId:id(3),signature});
  assert.equal(verified.body.data.proofId,id(4));assert.equal(verified.body.data.proofKind,"eip191_address_control");
  assert.doesNotMatch(JSON.stringify(verified.body),/sessionId|userId|signature|messageHash|privateKey/);
});
test("routes refuse body-supplied identity/network/origin and malformed pagination before private reads or writes",async()=>{
  const f=fixture();
  for(const extra of [{userId:id(9)},{sessionId:id(9)},{chainId:143},{origin:"https://evil.example"}]){
    const r=await f.request("POST","/api/v1/athlete/rewards/wallet-challenges",{address:signer.address,idempotencyKey:"route-wallet-test",...extra});
    assert.equal(r.statusCode,400);
  }
  for(const query of ["?userId=other","?after=bad","?after=one&after=two"])
    assert.equal((await f.request("GET",`/api/v1/athlete/rewards/allocations${query}`)).statusCode,400);
  assert.equal(f.calls.length,0);
});
test("disabled, unauthorized and cross-origin requests do not reach the reward repository",async()=>{
  const f=fixture();const disabled=await f.request("GET","/api/v1/athlete/rewards/allocations",null,{config:()=>null});
  assert.equal(disabled.routed,false);assert.equal(disabled.auth,0);
  for(const [message,status] of [["Unauthorized",401],["Missing bearer token",401],["Untrusted browser origin",403]]){
    const r=await f.request("GET","/api/v1/athlete/rewards/allocations",null,{requireIdentity:async()=>{throw new Error(message);}});
    assert.equal(r.statusCode,status);assert.equal(r.headers["Cache-Control"],"private, no-store");
  }
  assert.equal(f.calls.length,0);
});
test("session revocation, foreign challenges, rate limits and unexpected database failures return safe errors",async()=>{
  const f=fixture();
  for(const [message,status] of [["reward_account_session_required",401],["reward_wallet_challenge_not_found",404],["reward_wallet_rate_limited",429],["synthetic private database endpoint",503]]){
    const r=await f.request("POST","/api/v1/athlete/rewards/wallet-proofs",{challengeId:id(3),signature:`0x${"11".repeat(65)}`},
      {rpc:async()=>({data:null,error:{message}})});
    assert.equal(r.statusCode,status);assert.doesNotMatch(JSON.stringify(r.body),/private database endpoint|signature|sessionId/);
  }
});
test("a valid proof for another configured site/network cannot be consumed on this endpoint",async()=>{
  const f=fixture();const challenge=await f.request("POST","/api/v1/athlete/rewards/wallet-challenges",{address:signer.address,idempotencyKey:"route-wallet-test"});
  const signature=await signer.signMessage({message:challenge.body.data.message});
  const response=await f.request("POST","/api/v1/athlete/rewards/wallet-proofs",{challengeId:id(3),signature},{config:()=>({chainId:10143,origin:"https://www.raceson.com"})});
  assert.equal(response.statusCode,400);assert.equal(response.body.error.code,"reward_wallet_context_mismatch");
  assert(!f.calls.some(c=>c.name==="service_confirm_reward_wallet_proof"));
});
