import test from 'node:test';
import assert from 'node:assert/strict';
import {toHex} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {hostedCopyBeneficiaryWalletRpc} from '../../../packages/db/dist/rewards/index.js';
import {prepareAthleteWalletProof,verifyAthleteWalletProof} from '../dist/features/rewards/athlete-wallet-service.js';
import {submitAthleteRewardDestination} from '../dist/features/rewards/athlete-destination-service.js';
import {hostedCopyRequestAllowed} from '../dist/features/rewards/hosted-copy-preview.js';
import {dispatchAthleteRewardRoutes} from '../dist/routes/rewards/athlete.js';
const id=n=>`7d000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const identity={userId:id(1),sessionId:id(2)},origin='https://podium.raceson.com';
// Owned synthetic signer only. This is cryptographic service verification,
// never a Privy wallet, hosted athlete signature or transaction.
const signer=privateKeyToAccount(toHex(1147n,{size:32}));
function fixture(){
 const challenge={challengeId:id(3),...identity,chainId:10143,address:signer.address.toLowerCase(),origin,nonce:'e'.repeat(64),issuedAt:'2026-10-06T01:00:00Z',expiresAt:'2026-10-06T01:10:00Z',checkedAt:'2026-10-06T01:00:01Z',idempotencyKey:'owned-wallet-test',proof:null};
 const calls=[];
 const rpc=hostedCopyBeneficiaryWalletRpc(identity,async(name,args)=>{
  assert.equal(name,'service_reward_demo_copy_beneficiary_wallet');assert.equal(args.p_user_id,identity.userId);assert.equal(args.p_session_id,identity.sessionId);calls.push(structuredClone(args));
  if(args.p_action==='proof')challenge.proof={proofId:id(4),messageHash:args.p_input.p_message_hash,signature:args.p_input.p_signature,verifiedAt:'2026-10-06T01:00:02Z'};
  if(args.p_action==='destination')return {data:{requestId:id(5),...identity,athleteProfileId:id(6),proofId:id(4),address:challenge.address,chainId:10143,requestedAt:'2026-10-06T01:00:03Z',idempotencyKey:'owned-destination-test',withdrawnAt:null,status:'pending_review'},error:null};
  return {data:structuredClone(challenge),error:null};
 });
 return {challenge,calls,rpc,config:{chainId:10143,origin,rpc}};
}
test('copied hosted proof and destination reverify exact EIP191 control without claim consent',async()=>{
 const f=fixture();const prepared=await prepareAthleteWalletProof(identity,{address:signer.address,idempotencyKey:'owned-wallet-test'},f.config);
 assert.match(prepared.message,/podium\.raceson\.com/);assert.match(prepared.message,/does not authorize a payment/);
 const signature=await signer.signMessage({message:prepared.message});
 const proof=await verifyAthleteWalletProof(identity,{challengeId:id(3),signature},f.config);
 assert.equal(proof.proofKind,'eip191_address_control');
 const destination=await submitAthleteRewardDestination(identity,{challengeId:id(3),athleteProfileId:id(6),idempotencyKey:'owned-destination-test'},f.config);
 assert.equal(destination.status,'pending_review');assert.doesNotMatch(JSON.stringify(destination),/signature|sessionId|amount|nonce|approved/);
 assert.deepEqual(f.calls.map(x=>x.p_action),['challenge','readChallenge','proof','readChallenge','destination']);
});
test('wrong signature never reaches copied proof writer',async()=>{
 const f=fixture();const prepared=await prepareAthleteWalletProof(identity,{address:signer.address,idempotencyKey:'owned-wallet-test'},f.config);
 const wrong=privateKeyToAccount(toHex(1148n,{size:32}));
 await assert.rejects(verifyAthleteWalletProof(identity,{challengeId:id(3),signature:await wrong.signMessage({message:prepared.message})},f.config),{code:'reward_wallet_signature_mismatch'});
 assert(!f.calls.some(x=>x.p_action==='proof'));
});
test('fixed transport refuses foreign identity/network/origin and unrelated RPCs before any call',async()=>{
 let count=0;const actor={...identity};const rpc=hostedCopyBeneficiaryWalletRpc(actor,async()=>{count++;return {data:null,error:null};});actor.userId=id(9);
 const input={p_user_id:identity.userId,p_session_id:identity.sessionId,p_chain_id:10143,p_address:signer.address.toLowerCase(),p_origin:origin,p_idempotency_key:'owned-wallet-test'};
 for(const patch of [{p_user_id:id(9)},{p_session_id:id(9)},{p_chain_id:31337},{p_origin:'https://www.raceson.com'},{p_amount_wei:'100'},{p_chain_id:undefined}])await assert.rejects(rpc('service_create_reward_wallet_challenge',{...input,...patch}));
 await assert.rejects(rpc('service_read_own_reward_awards',{p_user_id:identity.userId,p_session_id:identity.sessionId,p_after_id:null}));
 assert.equal(count,0);await rpc('service_create_reward_wallet_challenge',input);assert.equal(count,1);
});
test('hosted gate opens only exact wallet paths and bounded destination history cursor',()=>{
 const path='/api/v1/athlete/rewards/';const allowed=(method,suffix,active=true,mode='sponsor-drafts-v1')=>hostedCopyRequestAllowed(method,new URL(path+suffix,origin),mode,active);
 for(const suffix of ['wallet-challenges','wallet-proofs','destination-requests']){assert(allowed('POST',suffix));assert(!allowed('POST',suffix,false));assert(!allowed('POST',suffix,true,'preview-v1'));assert(!allowed('POST',suffix+'?chainId=143'));}
 assert(allowed('GET','destination-requests'));assert(allowed('GET','destination-requests?after='+id(5)));assert(!allowed('GET','destination-requests?after='+id(5)+'&after='+id(6)));
 assert(allowed('GET','destination-requests/'+id(5)));assert(allowed('POST','destination-requests/'+id(5)+'/withdraw'));
 for(const suffix of ['allocations','claims','programme-allocations-v3','destination-requests?userId='+id(9),'wallet-proofs/'+id(5),'destination-requests?after=invalid'])assert(!allowed('GET',suffix));
});
test('route authenticates before constructing transport and refuses browser scope fields',async()=>{
 let constructed=0;const f=fixture();
 const run=async(body,denied=false)=>{
  const res={status:200};
  await dispatchAthleteRewardRoutes({method:'POST',headers:{}},res,new URL('/api/v1/athlete/rewards/wallet-challenges',origin),{
   config:()=>f.config,requireIdentity:async()=>{if(denied)throw Error('Unauthorized');return identity;},resolveRpc:()=>{constructed++;return f.rpc;},readJsonBody:async()=>body,applyPrivateSessionHeaders:()=>{},sendSuccess:(r,data)=>{r.data=data;},sendError:(r,status,code)=>{r.status=status;r.code=code;}
  });return res;
 };
 assert.equal((await run({},true)).status,401);assert.equal(constructed,0);
 const body={address:signer.address,idempotencyKey:'owned-wallet-test'};
 assert.equal((await run({...body,userId:id(9),chainId:143,origin:'https://untrusted.invalid'})).status,400);assert.equal(f.calls.length,0);
 assert.equal((await run(body)).status,200);
});
