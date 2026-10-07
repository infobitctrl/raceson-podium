import test from 'node:test';
import assert from 'node:assert/strict';
import {hostedCopyReviewBranding} from '../../../packages/db/dist/rewards/hosted-copy-review-branding.js';
const id=n=>`72000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const actor={userId:id(1),sessionId:id(2)},brand={id:id(3),name:'Fictional sponsor',logo:null,website:'https://example.com',promotion:'Trail promotion',revision:1};
test('review presentation binds the session and exact authorized campaign set',async()=>{
 const rpc=async(name,args)=>{assert.equal(name,'service_reward_demo_copy_review_branding');assert.deepEqual(args,{p_actor_user_id:actor.userId,p_actor_session_id:actor.sessionId,p_setup_id:brand.id});return {data:[brand],error:null};};
 assert.deepEqual(await hostedCopyReviewBranding(actor,brand.id,[brand.id],rpc),[brand]);
});
test('rejects revocation, missing/foreign/duplicate brands and unsafe website content',async()=>{
 await assert.rejects(()=>hostedCopyReviewBranding(actor,null,[brand.id],async()=>({error:{message:'reward_demo_reviewer_required'}})),/reviewer_required/);
 for(const data of [[],[{...brand,id:id(4)}]])await assert.rejects(()=>hostedCopyReviewBranding(actor,null,[brand.id],async()=>({data,error:null})),/reward_setup_conflict/);
 for(const data of [[brand,brand],[{...brand,website:'javascript:alert(1)'}]])await assert.rejects(()=>hostedCopyReviewBranding(actor,null,[brand.id],async()=>({data,error:null})),/invalid_campaign_branding/);
});
