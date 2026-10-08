import test from 'node:test';
import assert from 'node:assert/strict';
import {rewardReviewIssues} from '../../../packages/db/dist/rewards/operations.js';
import {hostedCopyRequestAllowed} from '../dist/features/rewards/hosted-copy-preview.js';
import {dispatchHostedCopyReviews} from '../dist/routes/rewards/hosted-copy-reviews.js';
const id=n=>`99000000-0000-4000-8000-${String(n).padStart(12,'0')}`,actor={userId:id(1),sessionId:id(2)},scope={chainId:10143,setupId:id(3),slot:1};
const empty={revision:0,contextHash:'a'.repeat(64),canReport:true,issues:[]};
test('hosted issue transport binds exact identity and scope without legacy RPC or browser source data',async()=>{
 const calls=[],rpc=async(name,args)=>{calls.push({name,args});return {data:empty,error:null};};
 assert.deepEqual(await rewardReviewIssues(actor,scope,undefined,rpc,true),empty);
 assert.deepEqual(calls[0],{name:'service_reward_demo_copy_review_issues',args:{p_actor_user_id:actor.userId,p_actor_session_id:actor.sessionId,p_chain_id:10143,p_setup_id:scope.setupId,p_slot:1,p_change:null}});
 const report={action:'report',requestId:id(4),expectedRevision:0,contextHash:empty.contextHash,description:'  Verify the official result  '};
 await rewardReviewIssues(actor,scope,report,rpc,true);assert.equal(calls[1].args.p_change.description,'Verify the official result');
 for(const changed of [{...scope,chainId:31337},{...scope,slot:6},{...scope,setupId:'bad'}])await assert.rejects(()=>rewardReviewIssues(actor,changed,undefined,rpc,true));
 await assert.rejects(()=>rewardReviewIssues(actor,scope,{...report,amountWei:'1'},rpc,true));assert.equal(calls.length,2);
});
test('hosted issue gate and HTTP fail closed, with explicit issue conflict codes',async()=>{
 const url=new URL(`https://podium.raceson.com/api/v1/rewards/demo-copy/reviews/${scope.setupId}/allocations/1/issues`);
 for(const method of ['GET','POST'])assert.equal(hostedCopyRequestAllowed(method,url,'sponsor-drafts-v1',true),true);
 for(const method of ['DELETE','PATCH'])assert.equal(hostedCopyRequestAllowed(method,url,'sponsor-drafts-v1',true),false);
 assert.equal(hostedCopyRequestAllowed('GET',url,'sponsor-drafts-v1',false),false);
 const query=new URL(url);query.search='?actor=other';assert.equal(hostedCopyRequestAllowed('POST',query,'sponsor-drafts-v1',true),false);
 const env={APP_BASE_URL:url.origin,API_CORS_ORIGIN:url.origin,SUPABASE_URL:'https://niklhlmljiikwbkrmapw.supabase.co',SUPABASE_ANON_KEY:'synthetic',SUPABASE_SERVICE_ROLE_KEY:'synthetic',RACESON_REWARD_PORTAL_MODE:'testnet',RACESON_REWARD_HOSTED_COPY_MODE:'sponsor-drafts-v1',RACESON_REWARD_HOSTED_OPERATIONS:'testnet-v1',RACESON_REWARD_DEMO_ORIGIN:url.origin,RACESON_REWARD_DEMO_SUPABASE_URL:'https://niklhlmljiikwbkrmapw.supabase.co'};
 const previous=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]]));Object.assign(process.env,env);
 try{
 let result,calls=0,identityError,sqlError;
 const deps={config:()=>({chainId:10143}),applyPrivateSessionHeaders:()=>{},requireIdentity:async()=>{if(identityError)throw Error(identityError);return actor;},rpc:async()=>{calls++;return{data:empty,error:sqlError?{message:sqlError}:null};},readJsonBody:async()=>({extra:true}),sendSuccess:(_res,data)=>result={status:200,data},sendError:(_res,status,code)=>result={status,code}};
 const req={method:'GET',headers:{}},res={setHeader:()=>{}};
 assert.equal(await dispatchHostedCopyReviews(req,res,url,deps),true);assert.equal(result.status,200);
 for(const [failure,status] of [['reward_demo_reviewer_required',403],['reward_account_session_required',401],['Untrusted browser origin',403]]){identityError=failure;await dispatchHostedCopyReviews(req,res,url,deps);assert.equal(result.status,status);}identityError=null;assert.equal(calls,1);
 for(const [failure,status] of [['reward_review_issue_not_owned',403],['reward_review_issue_open',409],['reward_review_issue_conflict',409]]){sqlError=failure;await dispatchHostedCopyReviews(req,res,url,deps);assert.deepEqual(result,{status,code:failure});}sqlError=null;
 const before=calls;await dispatchHostedCopyReviews({...req,method:'POST'},res,url,deps);assert.equal(result.status,400);assert.equal(calls,before);
 }finally{for(const [k,v] of Object.entries(previous))if(v===undefined)delete process.env[k];else process.env[k]=v;}
});
