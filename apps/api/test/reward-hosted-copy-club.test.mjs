import test from 'node:test';import assert from 'node:assert/strict';
import {toHex} from 'viem';
import {fixture,saved,id,setupId} from './fixtures/hosted-approval-fixture.mjs';
import {createSponsorExecutionPlan} from '../../../packages/domain/dist/rewards/sponsor-execution.js';
import {hostedCopyClubWalletRpc,hostedCopyClubClaimFacts,hostedCopyNativeClubClaimFacts,hostedCopyClubAwards,decodeSponsorClubClaimFactsV4,sponsorAllocationDocumentHashV4 as digest} from '../../../packages/db/dist/rewards/index.js';
import {sponsorClubClaimFromFactsV4} from '../dist/features/rewards/sponsor-club-claims-v4-service.js';
import {dispatchHostedCopyClubClaims} from '../dist/routes/rewards/hosted-copy-club-claims.js';
import {dispatchClubRewardRoutes} from '../dist/routes/rewards/clubs.js';
import {hostedCopyRequestAllowed} from '../dist/features/rewards/hosted-copy-preview.js';
const actor={userId:id(1),sessionId:id(2)},cid=id(4),a=n=>toHex(BigInt(n),{size:20}),origin='https://podium.raceson.com';
function facts(){const launch={id:id(9902),state:'prepared',configurationHash:'f'.repeat(64),createdAt:'2026-10-05T00:00:00Z',setup:saved(fixture())};
 const plan=createSponsorExecutionPlan(launch,a(100),{operator:a(101),treasury:a(102),reviewPeriods:[0,0,0,0,0,0]}),pkg={heldTest:true};
 return{claimId:cid,entitlementId:'0x'+'a'.repeat(64),approvalId:id(6),setupId,slot:0,current:false,sourceStamp:'b'.repeat(64),profileFingerprint:'c'.repeat(64),plan,
 nomination:{requestId:id(7),...actor,clubId:id(8),chainId:10143,candidate:{safeAddress:a(10),singletonAddress:a(11),fallbackHandlerAddress:a(12),owners:[a(20),a(21),a(22)]},requestedAt:'2026-10-06T01:00:00Z',withdrawnAt:null,status:'pending_review',idempotencyKey:'owned-club-choice'},package:pkg,packageHash:digest(pkg),publication:{},events:{}};}
test('club wallet transport freezes the ordinary session and permits only five exact testnet operations',async()=>{
 const calls=[],identity={...actor},rpc=hostedCopyClubWalletRpc(identity,async(n,args)=>{calls.push([n,args]);return{data:null,error:null};});identity.userId=id(9);
 const args={p_user_id:actor.userId,p_session_id:actor.sessionId,p_chain_id:10143,p_after_id:null};await rpc('service_list_reward_owned_clubs',args);
 assert.deepEqual(calls[0],['service_reward_demo_copy_club_wallet',{p_user_id:actor.userId,p_session_id:actor.sessionId,p_action:'clubs',p_input:{p_after_id:null}}]);
 for(const patch of [{p_user_id:id(9)},{p_chain_id:31337},{approved:true}])assert.throws(()=>rpc('service_list_reward_owned_clubs',{...args,...patch}));
 assert.throws(()=>rpc('service_sponsor_club_claim_v4',args));assert.equal(calls.length,1);
});
test('copied club facts bind recipient and Safe nomination, preserve held status and keep private documents out of HTTP',async()=>{
 const raw=facts(),calls=[],identity={...actor},read=hostedCopyClubClaimFacts(identity,cid,'recipient',async(n,args)=>{calls.push([n,args]);return{data:raw,error:null};});identity.userId=id(9);
 const view=await sponsorClubClaimFromFactsV4({chainId:10143,claimId:cid,role:'recipient'},undefined,{readFacts:read});
 assert.equal(view.status,'held');assert.equal(view.signing,null);assert.equal(view.transaction,null);assert.equal(view.address,raw.nomination.candidate.safeAddress);
 assert.equal(calls[0][0],'service_reward_demo_copy_club_claim');assert.equal(calls[0][1].p_actor_user_id,actor.userId);assert(!JSON.stringify(view).includes(actor.sessionId));assert(!JSON.stringify(view).includes('heldTest'));
 await assert.rejects(read({action:'operator',body:{}}));assert.equal(calls.length,2);
 for(const patch of [{claimId:id(9)},{slot:6},{slot:'0'},{entitlementId:'0x1234'},{packageHash:'d'.repeat(64)},{plan:{...raw.plan,chainId:31337}}])assert.throws(()=>decodeSponsorClubClaimFactsV4({...raw,...patch},{chainId:10143,claimId:cid,role:'recipient'},actor.userId));
 assert.throws(()=>decodeSponsorClubClaimFactsV4(raw,{chainId:10143,claimId:cid,role:'recipient'},id(9)));
});
test('native club facts use only verified DID and immutable operator; ordinary reviewers cannot expose or sign payment data',async()=>{
 const raw=facts(),calls=[],native={subject:'did:privy:synthetic_native_controller',wallet:raw.plan.operator};
 const read=hostedCopyNativeClubClaimFacts(native,cid,async(n,args)=>{calls.push([n,args]);return{data:raw,error:null};});native.subject='did:privy:changed';
 await read();assert.equal(calls[0][0],'service_reward_demo_copy_native_club_claim');assert.equal(calls[0][1].p_subject,'did:privy:synthetic_native_controller');assert.equal('p_actor_user_id'in calls[0][1],false);await assert.rejects(read({action:'intent',body:{}}));
 const reviewer=hostedCopyClubClaimFacts(actor,cid,'reviewer',async()=>({data:raw,error:null}));
 const v=await sponsorClubClaimFromFactsV4({chainId:10143,claimId:cid,role:'operator'},undefined,{readFacts:reviewer,signer:false});assert.equal(v.signing,null);assert.equal(v.transaction,null);
 await assert.rejects(sponsorClubClaimFromFactsV4({chainId:10143,claimId:cid,role:'operator'},{action:'operator',signature:'0x'+'a'.repeat(130)},{readFacts:reviewer,signer:false}));
 raw.plan.operator=a(99);await assert.rejects(read(),/controller_scope_required/);
});
test('club award pages reject duplicate/out-of-order entitlements, short-page cursors and impossible payment sequencing',async()=>{
 const row={approvalId:id(6),slot:0,entitlementId:'0x'+'a'.repeat(64),amountWei:'101',clubId:id(8),claims:[]};
 const rpc=async(n,args)=>{assert.equal(n,'service_reward_demo_copy_club_awards');assert.equal(args.p_user_id,actor.userId);return{data:{items:[row],nextCursor:null},error:null};};assert.equal((await hostedCopyClubAwards(actor,null,rpc)).items.length,1);
 for(const data of [{items:[row,row],nextCursor:null},{items:[row],nextCursor:row.entitlementId},{items:[{...row,claims:[{id:cid,prepared:true,consented:false,approved:false,paid:true}]}],nextCursor:null}])await assert.rejects(hostedCopyClubAwards(actor,null,async()=>({data,error:null})));
 await assert.rejects(hostedCopyClubAwards(actor,'wrong',rpc));
});
const envValues={APP_BASE_URL:origin,API_CORS_ORIGIN:origin,SUPABASE_URL:'https://niklhlmljiikwbkrmapw.supabase.co',SUPABASE_ANON_KEY:'synthetic-anon-key',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service-key',RACESON_REWARD_PORTAL_MODE:'testnet',RACESON_REWARD_HOSTED_COPY_MODE:'sponsor-drafts-v1',RACESON_REWARD_HOSTED_OPERATIONS:'testnet-v1',RACESON_REWARD_DEMO_ORIGIN:origin,RACESON_REWARD_DEMO_SUPABASE_URL:'https://niklhlmljiikwbkrmapw.supabase.co'};
test('copied club HTTP authenticates before private reads and refuses client identity, Safe approval and ordinary payment commands',async()=>{
 const old=Object.fromEntries(Object.keys(envValues).map(k=>[k,process.env[k]]));Object.assign(process.env,envValues);
 try{let body,response,calls=0,resolves=0;const deps={config:()=>({chainId:10143,origin}),applyPrivateSessionHeaders(){},requireIdentity:async()=>actor,readJsonBody:async()=>body,rpc:async()=>{calls++;throw Error('unexpected');},sendSuccess(_r,data){response={status:200,data};},sendError(_r,status,code){response={status,code};}};
 const recipient=new URL('/api/v1/athlete/rewards/sponsor-club-claims/'+cid,origin),reviewer=new URL('/api/v1/rewards/demo-copy/club-claim-reviews/'+cid,origin);
 for(const action of ['operator','receipt','prepare','revoke']){body={action};await dispatchHostedCopyClubClaims({method:'POST'},{},recipient,deps);assert.equal(response.status,400);}
 for(const action of ['request','recipient','operator','receipt']){body={action};await dispatchHostedCopyClubClaims({method:'POST'},{},reviewer,deps);assert.equal(response.status,400);}
 const valid={action:'request',approvalId:id(6),entitlementId:'0x'+'a'.repeat(64),requestId:id(7)};for(const patch of [{userId:id(9)},{chainId:1},{amountWei:'102'},{verified:true}]){body={...valid,...patch};await dispatchHostedCopyClubClaims({method:'POST'},{},recipient,deps);assert.equal(response.status,400);}
 await dispatchHostedCopyClubClaims({method:'GET'},{},recipient,{...deps,requireIdentity:async()=>{throw Error('Unauthorized');}});assert.equal(response.status,401);assert.equal(calls,0);
 const url=new URL('/api/v1/athlete/rewards/owned-clubs',origin);
 await dispatchClubRewardRoutes({method:'GET'},{},url,{...deps,rpc:async()=>assert.fail('generic club reader'),resolveRpc:identity=>{resolves++;assert.deepEqual(identity,actor);return hostedCopyClubWalletRpc(identity,async()=>({data:{chainId:10143,items:[{clubId:id(8),name:'Owned synthetic club'}],nextCursor:null},error:null}));}});assert.equal(response.status,200);assert.equal(resolves,1);
 await dispatchClubRewardRoutes({method:'GET'},{},url,{...deps,rpc:async()=>({data:null,error:{message:'reward_demo_account_required'}})});assert.equal(response.status,403);
 }finally{for(const[k,v]of Object.entries(old)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
});
test('hosted club gate permits bounded treasury/claim routes and retains legacy ledger closure',()=>{
 const allow=(m,p,op=true)=>hostedCopyRequestAllowed(m,new URL(p,origin),'sponsor-drafts-v1',op);
 for(const p of ['/api/v1/athlete/rewards/owned-clubs','/api/v1/athlete/rewards/club-treasury-requests','/api/v1/rewards/demo-copy/club-awards']){assert(allow('GET',p));assert(!allow('GET',p+'?userId='+id(9)));assert(!allow('GET',p,false));}
 for(const p of ['/api/v1/athlete/rewards/sponsor-club-claims/'+cid,'/api/v1/rewards/demo-copy/club-claim-reviews/'+cid,'/api/v1/rewards/control/club-claims/'+cid]){assert(allow('GET',p));assert(allow('POST',p));assert(!allow('DELETE',p));assert(!allow('GET',p+'?chainId=1'));}
 assert(!allow('GET','/api/v1/athlete/rewards/sponsor-club-claims'));assert(!allow('GET','/api/v1/athlete/rewards/club-ledger'));assert(!allow('GET','/api/v1/rewards/demo-copy/club-claim-reviews?approvalId='+id(6)+'&approvalId='+id(9)));
});
