import assert from "node:assert/strict";
import test from "node:test";
import { toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { parseSiweMessage } from "viem/siwe";
import { createRewardWalletChallenge,readRewardWalletChallenge,readOwnRewardAwards } from "../../../packages/db/dist/rewards/index.js";
import { rewardWalletControlMessage,verifyRewardWalletControl } from "../../../packages/rewards-chain/dist/index.js";
import { validateRewardWalletControlMessage } from "../../../packages/rewards-chain/dist/wallet-control.js";
import { prepareAthleteWalletProof,verifyAthleteWalletProof as verifyService,getAthleteRewardAllocations } from "../dist/features/rewards/athlete-wallet-service.js";
const verifyAthleteWalletProof=(identity,input,rpc)=>verifyService(identity,input,{chainId:31337,origin:"http://127.0.0.1:5173",rpc});

const id=n=>`79000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
// Predictable synthetic signers only; no real account/provider/wallet activation.
const signer=privateKeyToAccount(toHex(901n,{size:32}));const stranger=privateKeyToAccount(toHex(902n,{size:32}));
function fixture(){
  const identity={userId:id(1),sessionId:id(2)};const calls=[];
  const c={challengeId:id(3),...identity,chainId:31337,address:signer.address.toLowerCase(),origin:"http://127.0.0.1:5173",nonce:"b".repeat(64),
    issuedAt:"2026-09-08T07:00:00Z",expiresAt:"2026-09-08T07:10:00Z",checkedAt:"2026-09-08T07:00:01Z",idempotencyKey:"wallet-test-key",proof:null};
  const rpc=async(name,args)=>{calls.push({name,args:structuredClone(args)});
    assert.equal(args.p_user_id,id(1));assert.equal(args.p_session_id,id(2));
    if(name==="service_confirm_reward_wallet_proof")c.proof={proofId:id(4),messageHash:args.p_message_hash,signature:args.p_signature,verifiedAt:"2026-09-08T07:00:02Z"};
    return{data:structuredClone(c),error:null};};
  return{identity,c,calls,rpc};
}
test("wallet challenge is standard SIWE scoped to server origin/network, with no account identifiers or payment consent",async()=>{
  const f=fixture();const result=await prepareAthleteWalletProof(f.identity,{address:signer.address,idempotencyKey:"wallet-test-key"},{rpc:f.rpc,chainId:31337,origin:f.c.origin});
  const parsed=parseSiweMessage(result.message);assert.equal(parsed.address,signer.address);assert.equal(parsed.chainId,31337);
  assert.equal(parsed.domain,"127.0.0.1:5173");assert.equal(parsed.uri,"http://127.0.0.1:5173/athlete/rewards");assert.equal(parsed.requestId,id(3));
  assert.equal(parsed.nonce,f.c.nonce);assert.equal(parsed.expirationTime.getTime()-parsed.issuedAt.getTime(),600000);
  assert.doesNotMatch(JSON.stringify(result),new RegExp(`${id(1)}|${id(2)}|sessionId|userId|privateKey`));
  assert.match(result.message,/does not authorize a payment/);assert.equal(result.alreadyVerified,false);
});
test("real address-control signatures are reverified and only metadata leaves the service",async()=>{
  const f=fixture();const signature=await signer.signMessage({message:rewardWalletControlMessage(f.c)});
  const result=await verifyAthleteWalletProof(f.identity,{challengeId:id(3),signature},f.rpc);
  assert.deepEqual(Object.keys(result).sort(),["address","chainId","proofId","proofKind","verifiedAt"]);
  assert.equal(result.address,signer.address.toLowerCase());assert.equal(result.proofKind,"eip191_address_control");
  f.c.checkedAt="2026-09-08T08:00:00Z";
  assert.deepEqual(await verifyAthleteWalletProof(f.identity,{challengeId:id(3),signature},f.rpc),result,"Exact consumed proof retry is history, not a new authorization");
});
test("wrong signer/message/context and noncanonical signatures never consume a challenge",async()=>{
  for(const mutate of [c=>{c.nonce="c".repeat(64);},c=>{c.challengeId=id(30);},c=>{c.chainId=10143;c.origin="https://www.raceson.com";}]){
    const f=fixture();const altered=structuredClone(f.c);mutate(altered);
    const signature=await signer.signMessage({message:rewardWalletControlMessage(altered)});
    await assert.rejects(verifyAthleteWalletProof(f.identity,{challengeId:id(3),signature},f.rpc),{code:"reward_wallet_signature_mismatch"});
    assert(!f.calls.some(c=>c.name==="service_confirm_reward_wallet_proof"));
  }
  const f=fixture();const message=rewardWalletControlMessage(f.c);
  for(const signature of ["0x",`0x${"00".repeat(65)}`,await stranger.signMessage({message}),`0x${"ff".repeat(65)}`])
    await assert.rejects(verifyAthleteWalletProof(f.identity,{challengeId:id(3),signature},f.rpc));
  assert(!f.calls.some(c=>c.name==="service_confirm_reward_wallet_proof"));
});
test("invalid origins, mainnet, clocks and malformed wire scope are refused",async()=>{
  const f=fixture();
  for(const patch of [{origin:"https://evil.example"},{origin:"https://*.raceson.com",chainId:10143},{origin:"https://www.raceson.com",chainId:143},
    {origin:"http://127.0.0.1:5173/path"},{origin:"http://127.0.0.1:65536"},{nonce:"short"},{expiresAt:"2026-09-08T07:11:00Z"},{issuedAt:"invalid"}])
    assert.throws(()=>rewardWalletControlMessage({...f.c,...patch}));
  for(const patch of [{userId:id(9)},{sessionId:id(9)},{challengeId:id(9)},{nonce:"x"},{extra:true},{proof:{proofId:id(4)}}])
    await assert.rejects(readRewardWalletChallenge(f.identity,id(3),async()=>({data:{...f.c,...patch},error:null})));
});

test("testnet demo proofs verify at their exact origin, while legacy proof history cannot authorize new production linking",async()=>{
  for(const origin of ["http://127.0.0.1:3102","https://reward-demo.invalid"]){
    const f=fixture();Object.assign(f.c,{chainId:10143,origin});
    const context={chainId:10143,origin,rpc:f.rpc};
    const prepared=await prepareAthleteWalletProof(f.identity,{address:signer.address,idempotencyKey:"wallet-test-key"},context);
    validateRewardWalletControlMessage(prepared,origin);
    assert.throws(()=>validateRewardWalletControlMessage(prepared,"http://127.0.0.1:3101"));
    const signature=await signer.signMessage({message:prepared.message});
    assert.equal((await verifyService(f.identity,{challengeId:id(3),signature},context)).chainId,10143);
    await assert.rejects(verifyService(f.identity,{challengeId:id(3),signature},{...context,origin:"https://other-demo.invalid"}));
  }
  const f=fixture();Object.assign(f.c,{chainId:10143,origin:"https://www.raceson.com"});
  const message=rewardWalletControlMessage(f.c),signature=await signer.signMessage({message});
  await verifyRewardWalletControl(f.c,signature);
  await readRewardWalletChallenge(f.identity,id(3),f.rpc);
  assert.throws(()=>validateRewardWalletControlMessage({...f.c,message},f.c.origin));
  f.calls.length=0;
  await assert.rejects(prepareAthleteWalletProof(f.identity,{address:signer.address,idempotencyKey:"wallet-test-key"},{chainId:10143,origin:f.c.origin,rpc:f.rpc}));
  await assert.rejects(createRewardWalletChallenge(f.identity,{...f.c},f.rpc));
  assert.equal(f.calls.length,0,"Production creation fails before any RPC");
});
test("new proofs expire at the exact database deadline and session/transport errors stay sanitized",async()=>{
  const f=fixture();const signature=await signer.signMessage({message:rewardWalletControlMessage(f.c)});f.c.checkedAt=f.c.expiresAt;
  await assert.rejects(verifyAthleteWalletProof(f.identity,{challengeId:id(3),signature},f.rpc),{code:"reward_wallet_challenge_expired"});
  assert(!f.calls.some(c=>c.name==="service_confirm_reward_wallet_proof"));
  for(const [message,code] of [["reward_account_session_required","reward_account_session_required"],["reward_wallet_rate_limited","reward_wallet_rate_limited"],["synthetic secret transport detail","reward_ledger_store_failed"]])
    await assert.rejects(readRewardWalletChallenge(f.identity,id(3),async()=>({data:null,error:{message}})),{code});
});
test("wallet writes preserve captured identity and input across asynchronous repository work",async()=>{
  const f=fixture();const input={address:signer.address,idempotencyKey:"wallet-test-key"};
  const rpc=async(name,args)=>{const result=await f.rpc(name,args);f.identity.userId=id(9);input.address=stranger.address;return result;};
  const prepared=await prepareAthleteWalletProof(f.identity,input,{chainId:31337,origin:f.c.origin,rpc});assert.equal(prepared.address,signer.address.toLowerCase());
  const g=fixture();const signature=await signer.signMessage({message:rewardWalletControlMessage(g.c)});
  await verifyAthleteWalletProof(g.identity,{challengeId:id(3),signature},async(name,args)=>{const result=await g.rpc(name,args);g.identity.sessionId=id(9);return result;});
});
test("own awards contain only allocation metadata, with bounded ordered pagination and no fabricated adult verification",async()=>{
  const identity={userId:id(1),sessionId:id(2)};
  const award=n=>({entitlementId:id(n),campaignId:id(500),pot:"race",scopeKey:id(600),chainId:31337,environment:"local_simulation",
    athleteProfileId:id(700),identityChanged:false,amountWei:"123",ageStatus:"unverified_adult"});
  const rows=Array.from({length:50},(_,n)=>award(100+n));
  const result=await getAthleteRewardAllocations(identity,null,async(name,args)=>{
    assert.equal(name,"service_read_own_reward_awards");assert.deepEqual(args,{p_user_id:id(1),p_session_id:id(2),p_after_id:null});
    return{data:{items:rows,nextCursor:id(149)},error:null};});
  assert.equal(result.items[0].amountWei,123n);assert.equal(result.nextCursor,id(149));
  for(const data of [{items:[{...award(100),ageStatus:"adult_verified"}],nextCursor:null},{items:[{...award(100),dateOfBirth:"1990-01-01"}],nextCursor:null},
    {items:[award(100),award(100)],nextCursor:null},{items:rows,nextCursor:id(999)},{items:[award(100)],nextCursor:id(100)}])
    await assert.rejects(readOwnRewardAwards(identity,null,async()=>({data,error:null})));
});
