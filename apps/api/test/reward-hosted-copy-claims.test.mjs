import test from 'node:test';
import assert from 'node:assert/strict';
import {privateKeyToAccount} from 'viem/accounts';
import {toHex,hashMessage} from 'viem';
import {generateKeyPair,exportSPKI,SignJWT} from 'jose';
import {fixture,saved,id,setupId} from './fixtures/hosted-approval-fixture.mjs';
import {createSponsorExecutionPlan} from '../../../packages/domain/dist/rewards/sponsor-execution.js';
import {decodeSponsorClaimFactsV4,hostedCopyClaimFacts,hostedCopyNativeClaimFacts,hostedCopyAthleteAwards,hostedCopyClaimReviews,hostedCopyNativeClaimQueue,sponsorAllocationDocumentHashV4 as digest} from '../../../packages/db/dist/rewards/index.js';
import {prepareAthleteWalletProof} from '../dist/features/rewards/athlete-wallet-service.js';
import {sponsorClaimFromFactsV4} from '../dist/features/rewards/sponsor-claims-v4-service.js';
import {dispatchHostedCopyClaims} from '../dist/routes/rewards/hosted-copy-claims.js';
import {dispatchRewardController} from '../dist/routes/rewards/controller.js';
import {hostedCopyRequestAllowed} from '../dist/features/rewards/hosted-copy-preview.js';
const origin='https://podium.raceson.com',actor={userId:id(1),sessionId:id(2)},cid=id(4);
// Owned synthetic signer, never a Privy key or real athlete consent.
const signer=privateKeyToAccount(toHex(1907n,{size:32}));
async function facts(){
 const launch={id:id(9902),state:'prepared',configurationHash:'f'.repeat(64),createdAt:'2026-10-05T00:00:00Z',setup:saved(fixture())};
 const plan=createSponsorExecutionPlan(launch,signer.address,{operator:'0x'+'2'.repeat(40),treasury:'0x'+'3'.repeat(40),reviewPeriods:[0,0,0,0,0,0]});
 const challenge={challengeId:id(3),...actor,chainId:10143,address:signer.address.toLowerCase(),origin,nonce:'e'.repeat(64),issuedAt:'2026-10-06T01:00:00Z',expiresAt:'2026-10-06T01:10:00Z',checkedAt:'2026-10-06T01:00:01Z',idempotencyKey:'owned-claim-wallet',proof:null};
 const prepared=await prepareAthleteWalletProof(actor,{address:signer.address,idempotencyKey:challenge.idempotencyKey},{chainId:10143,origin,rpc:async()=>({data:challenge,error:null})});
 challenge.proof={proofId:id(5),messageHash:hashMessage(prepared.message),signature:await signer.signMessage({message:prepared.message}),verifiedAt:'2026-10-06T01:00:02Z'};
 // No intent: deliberately synthetic held-facts package, never signing data.
 const pkg={heldTest:true};
 return{claimId:cid,entitlementId:'0x'+'a'.repeat(64),approvalId:id(6),setupId,slot:0,current:false,sourceStamp:'b'.repeat(64),profileFingerprint:'c'.repeat(64),plan,
  destination:{requestId:id(7),...actor,athleteProfileId:id(8),proofId:id(5),address:challenge.address,chainId:10143,requestedAt:'2026-10-06T01:00:03Z',idempotencyKey:'owned-claim-choice',withdrawnAt:null,status:'pending_review'},
  challenge,package:pkg,packageHash:digest(pkg),publication:{},events:{}};
}
test('copied claim closure retains immutable ordinary identity and preserves the unknown-age hold',async()=>{
 const raw=await facts(),calls=[],identity={...actor};
 const read=hostedCopyClaimFacts(identity,cid,'recipient',async(n,a)=>{calls.push([n,a]);return{data:raw,error:null};});identity.userId=id(9);
 const view=await sponsorClaimFromFactsV4({chainId:10143,claimId:cid,role:'recipient'},{action:'request',approvalId:raw.approvalId,entitlementId:raw.entitlementId,destinationId:raw.destination.requestId},{origin,readFacts:read});
 assert.equal(view.status,'held');assert.equal(view.signing,null);assert.equal(view.transaction,null);assert.equal(view.receipt,null);
 assert.equal(calls[0][0],'service_reward_demo_copy_claim');assert.equal(calls[0][1].p_actor_user_id,actor.userId);assert.equal(calls[0][1].p_action,'request');
 assert(!JSON.stringify(view).includes(actor.sessionId));assert(!JSON.stringify(view).includes('heldTest'));assert(!JSON.stringify(view).includes('signature'));
 await assert.rejects(read({action:'operator',body:{}}));assert.equal(calls.length,2);
});
test('bad stored wallet-control signature cannot become recipient consent or reviewer readiness',async()=>{
 const raw=await facts();raw.challenge.proof.signature=await signer.signMessage({message:'wrong proof context'});let writes=0;
 const read=hostedCopyClaimFacts(actor,cid,'recipient',async(_n,a)=>{if(a.p_action)writes++;return{data:raw,error:null};});
 await assert.rejects(sponsorClaimFromFactsV4({chainId:10143,claimId:cid,role:'recipient'},{action:'recipient',signature:'0x'+'a'.repeat(130)},{origin,readFacts:read}));assert.equal(writes,0);
});
test('native closure uses verified DID/wallet with no ordinary actor substitution or readiness write',async()=>{
 const raw=await facts(),calls=[],native={subject:'did:privy:synthetic_native_controller',wallet:raw.plan.operator};
 const read=hostedCopyNativeClaimFacts(native,cid,async(n,a)=>{calls.push([n,a]);return{data:raw,error:null};});native.subject='did:privy:changed';native.wallet='0x'+'3'.repeat(40);
 const view=await sponsorClaimFromFactsV4({chainId:10143,claimId:cid,role:'operator'},undefined,{origin,readFacts:read});assert.equal(view.status,'held');assert.equal(view.transaction,null);
 assert.equal(calls[0][0],'service_reward_demo_copy_native_claim');assert.equal(calls[0][1].p_subject,'did:privy:synthetic_native_controller');assert.equal('p_actor_user_id'in calls[0][1],false);
 await assert.rejects(read({action:'intent',body:{}}));assert.equal(calls.length,2);
 raw.plan.operator='0x'+'3'.repeat(40);await assert.rejects(read(),/controller_scope_required/);
});
test('facts decoder denies wrong recipient, network, malformed entitlement or disabled pool scope',async()=>{
 const raw=await facts(),scope={chainId:10143,claimId:cid,role:'recipient'};
 assert.equal(decodeSponsorClaimFactsV4(raw,scope,actor.userId).claimId,cid);
 for(const patch of [{claimId:id(9)},{slot:6},{slot:'0'},{entitlementId:'0x1234'},{packageHash:'d'.repeat(64)},{plan:{...raw.plan,chainId:31337}}])assert.throws(()=>decodeSponsorClaimFactsV4({...raw,...patch},scope,actor.userId));
 assert.throws(()=>decodeSponsorClaimFactsV4(raw,scope,id(9)));
});
test('awards page binds ordinary scope, exact cursor ordering and consent/receipt sequencing',async()=>{
 const row={approvalId:id(6),slot:0,entitlementId:'0x'+'a'.repeat(64),amountWei:'101',athleteProfileId:id(8),claims:[]};
 const rpc=async(n,a)=>{assert.equal(n,'service_reward_demo_copy_athlete_awards');assert.equal(a.p_user_id,actor.userId);assert.equal(a.p_after,null);return{data:{items:[row],nextCursor:null},error:null};};
 assert.equal((await hostedCopyAthleteAwards(actor,null,rpc)).items.length,1);
 for(const data of [{items:[row,row],nextCursor:null},{items:[row],nextCursor:row.entitlementId},{items:[{...row,claims:[{id:id(4),prepared:false,consented:false,approved:false,paid:true}]}],nextCursor:null}])await assert.rejects(hostedCopyAthleteAwards(actor,null,async()=>({data,error:null})));
 await assert.rejects(hostedCopyAthleteAwards(actor,'wrong',rpc));
});
const envValues={APP_BASE_URL:origin,API_CORS_ORIGIN:origin,SUPABASE_URL:'https://niklhlmljiikwbkrmapw.supabase.co',SUPABASE_ANON_KEY:'synthetic-anon-key',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service-key',RACESON_REWARD_PORTAL_MODE:'testnet',RACESON_REWARD_HOSTED_COPY_MODE:'sponsor-drafts-v1',RACESON_REWARD_HOSTED_OPERATIONS:'testnet-v1',RACESON_REWARD_DEMO_ORIGIN:origin,RACESON_REWARD_DEMO_SUPABASE_URL:'https://niklhlmljiikwbkrmapw.supabase.co'};
test('hosted claim routes authenticate first and separate recipient/reviewer commands before any private call',async()=>{
 const old=Object.fromEntries(Object.keys(envValues).map(k=>[k,process.env[k]]));Object.assign(process.env,envValues);
 try{let body,response,calls=0;const deps={config:()=>({chainId:10143,origin}),applyPrivateSessionHeaders(){},requireIdentity:async()=>actor,readJsonBody:async()=>body,rpc:async()=>{calls++;throw Error('unexpected');},sendSuccess(_r,data){response={status:200,data};},sendError(_r,status,code){response={status,code};}};
  const recipient=new URL('/api/v1/athlete/rewards/sponsor-claims/'+cid,origin),reviewer=new URL('/api/v1/rewards/demo-copy/claim-reviews/'+cid,origin),res={};
  for(const action of ['operator','receipt','prepare','revoke']){body={action};await dispatchHostedCopyClaims({method:'POST'},res,recipient,deps);assert.equal(response.status,400);}
  for(const action of ['request','recipient','operator','receipt']){body={action};await dispatchHostedCopyClaims({method:'POST'},res,reviewer,deps);assert.equal(response.status,400);}
  const valid={action:'request',approvalId:id(6),entitlementId:'0x'+'a'.repeat(64),destinationId:id(7)};
  for(const patch of [{actorUserId:id(9)},{chainId:1},{amountWei:'102'},{verifiedDateOfBirth:'1990-01-01'},{operatorAddress:'0x'+'a'.repeat(40)}]){body={...valid,...patch};await dispatchHostedCopyClaims({method:'POST'},res,recipient,deps);assert.equal(response.status,400);}
  await dispatchHostedCopyClaims({method:'GET'},res,recipient,{...deps,requireIdentity:async()=>{throw Error('Unauthorized');}});assert.equal(response.status,401);assert.equal(calls,0);
  const awards=new URL('/api/v1/rewards/demo-copy/athlete-awards?after=0x'+'a'.repeat(64)+'&after=0x'+'b'.repeat(64),origin);await dispatchHostedCopyClaims({method:'GET'},res,awards,deps);assert.equal(response.status,400);assert.equal(calls,0);
 }finally{for(const[k,v]of Object.entries(old)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
});
test('native claim route refuses ordinary/forged JWT and reviewer commands before constructing native facts',async()=>{
 const pair=await generateKeyPair('ES256'),policy={appId:'cmtx921we00fu0cifaab7exez',verificationKey:await exportSPKI(pair.publicKey),subject:'did:privy:synthetic_native_controller',wallet:'0x'+'2'.repeat(40)};
 const token=await new SignJWT({sid:'disposable'}).setProtectedHeader({alg:'ES256'}).setIssuer('privy.io').setAudience(policy.appId).setSubject(policy.subject).setIssuedAt().setExpirationTime('1h').sign(pair.privateKey);
 let response,constructed=0,body;const raw=await facts();const deps={config:()=>({chainId:10143,origin}),requireToken:async()=>token,controllerPolicy:()=>policy,applyPrivateSessionHeaders(){},readJsonBody:async()=>body,sendSuccess(_r,data){response={status:200,data};},sendError(_r,status,code){response={status,code};},
  resolveNativeClaimFacts:native=>{constructed++;assert.equal(native.subject,policy.subject);return hostedCopyNativeClaimFacts(native,cid,async()=>({data:raw,error:null}));}};
 const url=new URL('/api/v1/rewards/control/claims/'+cid,origin),res={setHeader(){}};
 await dispatchRewardController({method:'GET',headers:{}},res,url,{...deps,requireToken:async()=>'ordinary-or-forged'});assert.equal(response.status,401);assert.equal(constructed,0);
 for(const action of ['request','prepare','recipient','revoke']){body={action};await dispatchRewardController({method:'POST',headers:{}},res,url,deps);assert.equal(response.status,400);assert.equal(constructed,0);}
 await dispatchRewardController({method:'GET',headers:{}},res,url,deps);assert.equal(response.status,200);assert.equal(response.data.status,'held');assert.equal(constructed,1);
});
test('hosted gate permits exact bounded copied claim paths and closes legacy unbounded lists',()=>{
 const allowed=(method,path,active=true)=>hostedCopyRequestAllowed(method,new URL(path,origin),'sponsor-drafts-v1',active);
 for(const path of ['/api/v1/athlete/rewards/sponsor-claims/'+cid,'/api/v1/rewards/demo-copy/claim-reviews/'+cid,'/api/v1/rewards/control/claims/'+cid]){assert(allowed('GET',path));assert(allowed('POST',path));assert(!allowed('GET',path,false));assert(!allowed('GET',path+'?actor=wrong'));assert(!allowed('DELETE',path));}
 assert(allowed('GET','/api/v1/rewards/demo-copy/athlete-awards'));assert(allowed('GET','/api/v1/rewards/demo-copy/athlete-awards?after=0x'+'a'.repeat(64)));
 for(const path of ['/api/v1/athlete/rewards/sponsor-claims','/api/v1/organizer/rewards/sponsor-claims?approvalId='+id(6),'/api/v1/rewards/demo-copy/athlete-awards?after=wrong','/api/v1/rewards/demo-copy/athlete-awards?userId='+id(9)])assert(!allowed('GET',path));
});

test('claim queues bind exact approval, native/ordinary authority and ordered bounded rows',async()=>{
 const approvalId=id(6),row={id:cid,approvalId,slot:0,entitlementId:'0x'+'a'.repeat(64),amountWei:'101',address:'0x'+'2'.repeat(40),prepared:true,consented:false,approved:false,paid:false},calls=[];
 const rpc=async(n,a)=>{calls.push([n,a]);return{data:{items:[row],nextCursor:null},error:null};};
 assert.equal((await hostedCopyClaimReviews(actor,approvalId,null,rpc)).items.length,1);
 assert.equal(calls[0][0],'service_reward_demo_copy_claim_reviews');assert.equal(calls[0][1].p_user_id,actor.userId);
 const native={subject:'did:privy:synthetic_native_controller',wallet:'0x'+'2'.repeat(40)};
 assert.equal((await hostedCopyNativeClaimQueue(native,approvalId,null,rpc)).items.length,1);
 assert.equal(calls[1][0],'service_reward_demo_copy_native_claims');assert.equal(calls[1][1].p_subject,native.subject);assert.equal('p_user_id'in calls[1][1],false);
 for(const data of [{items:[row,row],nextCursor:null},{items:[{...row,approvalId:id(9)}],nextCursor:null},{items:[{...row,paid:true}],nextCursor:null},{items:[row],nextCursor:cid}])await assert.rejects(hostedCopyClaimReviews(actor,approvalId,null,async()=>({data,error:null})));
 await assert.rejects(hostedCopyClaimReviews(actor,approvalId,cid,rpc));
 await assert.rejects(hostedCopyNativeClaimQueue({...native,subject:actor.userId},approvalId,null,rpc));
});
test('reviewer read cannot expose signing data even when backed by the shared claim service',async()=>{
 const raw=await facts();const read=hostedCopyClaimFacts(actor,cid,'reviewer',async()=>({data:raw,error:null}));
 const view=await sponsorClaimFromFactsV4({chainId:10143,claimId:cid,role:'operator'},undefined,{origin,readFacts:read,signer:false});
 assert.equal(view.signing,null);assert.equal(view.transaction,null);
 await assert.rejects(sponsorClaimFromFactsV4({chainId:10143,claimId:cid,role:'operator'},{action:'operator',signature:'0x'+'a'.repeat(130)},{origin,readFacts:read,signer:false}));
});

test('demo rehearsal is a hosted server fact and never creates readiness, consent or payment by itself',async()=>{
 const raw=await facts();raw.rehearsalPolicy='podium-demo-alias-rehearsal-v1';let writes=0;
 const read=hostedCopyClaimFacts(actor,cid,'recipient',async(_n,a)=>{if(a.p_action)writes++;return{data:raw,error:null};});
 const v=await sponsorClaimFromFactsV4({chainId:10143,claimId:cid,role:'recipient'},undefined,{origin,readFacts:read});
 assert.equal(v.rehearsalPolicy,raw.rehearsalPolicy);assert.equal(v.status,'held');assert.equal(v.signing,null);assert.equal(v.transaction,null);assert.equal(writes,0);
 raw.rehearsalPolicy='anything';await assert.rejects(read(),/invalid_sponsor_claim/);
 delete raw.rehearsalPolicy;assert.equal((await read()).rehearsalPolicy,null);
});
test('rehearsal preparation refuses generic facts, wrong claim, chain, schema and fabricated evidence',async()=>{
 const f=await facts(),scope={chainId:10143,claimId:cid,role:'operator'};
 const attestation={schemaVersion:4,policy:'podium-demo-alias-rehearsal-v1',chainId:10143,claimId:cid};
 let writes=0;const deps={origin,readFacts:async write=>{if(write)writes++;return f;}};
 const change={action:'prepare',sourceStamp:f.sourceStamp,profileFingerprint:f.profileFingerprint,attestation};
 await assert.rejects(sponsorClaimFromFactsV4(scope,change,deps),/invalid_sponsor_claim/);
 f.rehearsalPolicy=attestation.policy;
 for(const patch of [{chainId:31337},{claimId:id(10)},{schemaVersion:2},{verifiedDateOfBirth:'1990-01-01'},{identityEvidenceRef:id(12)}])
  await assert.rejects(sponsorClaimFromFactsV4(scope,{...change,attestation:{...attestation,...patch}},deps),/invalid_sponsor_claim/);
 // Correct policy still cannot override a held source, missing reader or cryptographic proof.
 await assert.rejects(sponsorClaimFromFactsV4(scope,change,deps),/reward_sponsor_claim_not_ready/);assert.equal(writes,0);
});
