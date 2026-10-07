import type {PrivyClient} from '@privy-io/node';
import type {SponsorExecutionPolicy} from '@raceson/domain/rewards/sponsor-execution';
import type {RewardAccountIdentity,RewardLedgerRpc} from '@raceson/db/rewards';
import {createAdminSupabaseClient,loadServerEnv} from '@raceson/db';
import {walletRuntime,hostedWalletEnvironment,type WalletSettings} from './wallet-administration.js';
import {inspectReviewWallet,reviewerPrivyClient} from './review-publication-privy.js';
type Env=Record<string,string|undefined>;
type Registration=WalletSettings['controller'];
export async function verifyReviewerOperator(client:PrivyClient,registered:Registration,appId:string,rpc:RewardLedgerRpc){
 if(!registered.reviewerUserId||!registered.walletId||!registered.ownerId)throw Error('review_wallet_unavailable');
 const allowed=async()=>{const r=await rpc('service_reward_demo_copy_reviewer_operator',{p_user_id:registered.reviewerUserId,p_operator:registered.wallet,p_subject:registered.subject});if(r.error||r.data!==true)throw Error('review_wallet_unverified');};
 await allowed();
 const access=await inspectReviewWallet(client,{userId:registered.reviewerUserId},registered.wallet,registered,appId);
 if(access.status!=='owned'||access.ownerId!==registered.ownerId||access.ownerSubject!==registered.subject)throw Error('review_wallet_unverified');
 await allowed();return access;
}
export async function reviewerSponsorPolicy(base:SponsorExecutionPolicy|null,env:Env,rpc?:RewardLedgerRpc,client?:PrivyClient){
 if(!base)return null;
 const db=rpc??((name,args)=>createAdminSupabaseClient(loadServerEnv(env)).rpc(name,args));
 const r=await walletRuntime(env,db);
 if(!hostedWalletEnvironment(env))return r.settings?{...base,operator:r.settings.controller.wallet}:base;
 if(!r.revision||!r.settings||r.settings.controller.wallet===base.operator||r.settings.controller.wallet===r.settings.deployment.address)return null;
 try{await verifyReviewerOperator(client??reviewerPrivyClient(env),r.settings.controller,env.RACESON_REWARD_PRIVY_APP_ID!,db);}
 catch{return null;}
 const fresh=await walletRuntime(env,db);
 if(fresh.revision!==r.revision||JSON.stringify(fresh.settings)!==JSON.stringify(r.settings))return null;
 return {...base,operator:r.settings.controller.wallet};
}
export async function reviewerWalletSummary(identity:RewardAccountIdentity,env:Env,readBalance:(address:string)=>Promise<bigint>,rpc?:RewardLedgerRpc){
 const db=rpc??((name,args)=>createAdminSupabaseClient(loadServerEnv(env)).rpc(name,args)),r=await walletRuntime(env,db);
 const registered=r.settings?.controller;if(!registered||registered.reviewerUserId!==identity.userId)return null;
 await verifyReviewerOperator(reviewerPrivyClient(env),registered,env.RACESON_REWARD_PRIVY_APP_ID!,db);
 return {address:registered.wallet,owned:true as const,balanceWei:(await readBalance(registered.wallet)).toString()};
}
