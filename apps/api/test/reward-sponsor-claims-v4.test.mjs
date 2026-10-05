import test from 'node:test';
import assert from 'node:assert/strict';
import {dispatchSponsorClaimsV4} from '../dist/routes/rewards/sponsor-claims-v4.js';
const id='ad000000-0000-4000-8000-000000000001';
test('V4 claim HTTP keeps identities, chain, amounts and private operator commands out of recipient input',async()=>{
 let response,body,calls=0,headers=0;
 const deps={config:()=>({chainId:31337,origin:'http://localhost:3101'}),requireIdentity:async()=>({userId:id,sessionId:id}),rpc:async()=>{calls++;throw Error('unexpected');},
 readJsonBody:async()=>body,applyPrivateSessionHeaders:()=>headers++,sendSuccess:(_r,data)=>response={status:200,data},sendError:(_r,status,code)=>response={status,code}};
 const route=role=>new URL(`http://localhost/api/v1/${role}/rewards/sponsor-claims/${id}`),res={};
 const valid={action:'request',approvalId:id,entitlementId:'0x'+'1'.repeat(64),destinationId:id};
 for(const extra of [{chainId:1},{actorUserId:id},{amountWei:'1'},{privateKey:'no'},{recipient:'0x'+'1'.repeat(40)}]){
  body={...valid,...extra};await dispatchSponsorClaimsV4({method:'POST'},res,route('athlete'),deps);assert.equal(response.status,400);
 }
 for(const c of [{action:'operator',signature:'0x'+'1'.repeat(130)},{action:'receipt',transactionHash:'0x'+'1'.repeat(64)},{action:'revoke'},{action:'prepare',sourceStamp:'1'.repeat(64),profileFingerprint:'2'.repeat(64),attestation:{}}]){
  body=c;await dispatchSponsorClaimsV4({method:'POST'},res,route('athlete'),deps);assert.equal(response.status,400);
 }
 body=valid;await dispatchSponsorClaimsV4({method:'POST'},res,route('organizer'),deps);assert.equal(response.status,400);
 await dispatchSponsorClaimsV4({method:'GET'},res,new URL(route('athlete')+'?chainId=1'),deps);assert.equal(response.status,400);
 await dispatchSponsorClaimsV4({method:'GET'},res,route('athlete'),{...deps,requireIdentity:async()=>{throw Error('Unauthorized');}});assert.equal(response.status,401);
 assert.equal(calls,0);assert.equal(headers,12);
});
test('V4 operator lists require an exact approval, while athlete lists cannot request someone else’s approval',async()=>{
 let response,calls=0;
 const deps={config:()=>({chainId:31337}),requireIdentity:async()=>({userId:id,sessionId:id}),rpc:async()=>{calls++;throw Error('unexpected');},applyPrivateSessionHeaders(){},sendError:(_r,status)=>response=status};
 for(const path of ['organizer/rewards/sponsor-claims',`athlete/rewards/sponsor-claims?approvalId=${id}`]){
  await dispatchSponsorClaimsV4({method:'GET'},{},new URL(`http://localhost/api/v1/${path}`),deps);assert.equal(response,400);
 }assert.equal(calls,0);
});
