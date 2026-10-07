import {PrivyClient} from '@privy-io/node';
import {createViemAccount} from '@privy-io/node/viem';
import {decodeFunctionData,type Hex} from 'viem';
import {sponsorLifecycleAbi} from '@raceson/rewards-chain/sponsor-lifecycle-v4';
import type {RewardAccountIdentity,RewardLedgerRpc} from '@raceson/db/rewards';
import {walletRuntime,hostedWalletEnvironment,type WalletSettings} from './wallet-administration.js';
export type PublicationTransaction={chainId:10143;to?:string;data:string;value:'0';nonce:string;gas:string;gasPrice:string};
export type ReviewPublicationSigner={address:string;verifyReady:()=>Promise<void>;sign:(tx:PublicationTransaction)=>Promise<string>};
export type ReviewWalletAccess={status:'owned'|'transfer_required'|'connect_required';operator:string;walletId:string;ownerId:string;ownerSubject:string;reviewerSubject:string|null;appId:string};
type Registration=WalletSettings['controller'];
export function reviewerPrivyClient(env:Record<string,string|undefined>){
 if(!hostedWalletEnvironment(env)||!env.RACESON_REWARD_PRIVY_APP_ID||!env.RACESON_SPONSOR_DEPLOYMENT_APP_SECRET)throw Error('review_wallet_unavailable');
 return new PrivyClient({appId:env.RACESON_REWARD_PRIVY_APP_ID,appSecret:env.RACESON_SPONSOR_DEPLOYMENT_APP_SECRET,maxRetries:0,timeout:15000});
}
/** Read actual provider ownership. Platform permission alone cannot sign for a wallet. */
export async function inspectReviewWallet(client:PrivyClient,identity:Pick<RewardAccountIdentity,'userId'>,operator:string,registered:Registration,appId:string):Promise<ReviewWalletAccess>{
 if(registered.reviewerUserId&&registered.reviewerUserId!==identity.userId)throw Error('review_wallet_unverified');
 if(registered.wallet!==operator||!registered.walletId||!registered.ownerId)throw Error('review_wallet_unavailable');
 const wallet=await client.wallets().get(registered.walletId);
 if(wallet.id!==registered.walletId||wallet.address.toLowerCase()!==operator||wallet.chain_type!=='ethereum'||!wallet.owner_id
  ||wallet.archived_at||wallet.imported_at||wallet.exported_at||wallet.additional_signers.length||wallet.policy_ids.length)throw Error('review_wallet_unverified');
 const owner=await client.keyQuorums().get(wallet.owner_id);
 if(owner.authorization_threshold!==1||owner.authorization_keys.length||owner.user_ids?.length!==1||owner.key_quorum_ids?.length)throw Error('review_wallet_unverified');
 let user;
 try{user=await client.users().getByCustomAuthID({custom_user_id:identity.userId});}
 catch(error){if(!(error&&typeof error==='object'&&'status' in error&&error.status===404))throw Error('review_wallet_unavailable');}
 if(user&&!user.linked_accounts.some(a=>a.type==='custom_auth'&&a.custom_user_id===identity.userId))throw Error('review_wallet_unverified');
 const subject=user?.id??null,ownerSubject=owner.user_ids[0]!;
 // A provider update may have succeeded before its database acknowledgement.
 // Allow only the exact requested reviewer to recover that handover.
 if(ownerSubject!==registered.subject&&ownerSubject!==subject)throw Error('review_wallet_unverified');
 return {status:subject===ownerSubject?'owned':subject?'transfer_required':'connect_required',operator,walletId:wallet.id,ownerId:wallet.owner_id,ownerSubject,reviewerSubject:subject,appId};
}
export async function reviewWalletFromEnv(identity:RewardAccountIdentity,operator:string,env:Record<string,string|undefined>,rpc?:RewardLedgerRpc){
 const runtime=await walletRuntime(env,rpc),registered=[runtime.settings?.controller,...runtime.controllers].find(c=>c?.wallet===operator&&c.walletId&&c.ownerId);
 if(!registered||runtime.deployments.some(d=>d.address===operator))throw Error('review_wallet_unavailable');
 const client=reviewerPrivyClient(env),access=await inspectReviewWallet(client,identity,operator,registered,env.RACESON_REWARD_PRIVY_APP_ID!);
 return {client,access,registered,revision:runtime.revision};
}
/** The current reviewer's verified custom-auth JWT authorizes this request.
 * No controller login, delegated signer, application ownership or service key. */
export async function reviewPublicationAccessFromEnv(identity:RewardAccountIdentity,operator:string,campaign:string,token:string|undefined,env:Record<string,string|undefined>,rpc?:RewardLedgerRpc){
 const {client,access,registered}=await reviewWalletFromEnv(identity,operator,env,rpc);
 let signer:ReviewPublicationSigner|null=null;
 if(access.status==='owned'&&token){
  const verifyReady=async()=>{const latest=await inspectReviewWallet(client,identity,operator,registered,access.appId);
   if(latest.status!=='owned'||latest.reviewerSubject!==access.reviewerSubject||latest.ownerId!==access.ownerId)throw Error('review_wallet_unverified');};
  signer={address:operator,verifyReady,async sign(tx){
   if(tx.chainId!==10143||tx.value!=='0'||tx.to!==campaign||BigInt(tx.gas)*BigInt(tx.gasPrice)>500_000_000_000_000_000n)throw Error('review_publication_scope_required');
   const decoded=decodeFunctionData({abi:sponsorLifecycleAbi,data:tx.data as Hex});
   if(!['uploadAwards','stageAllocation','activate'].includes(decoded.functionName))throw Error('review_publication_scope_required');
   await verifyReady();
   const account=createViemAccount(client,{walletId:access.walletId,address:operator as Hex,authorizationContext:{user_jwts:[token]}});
   return account.signTransaction({type:'legacy',chainId:10143,to:campaign as Hex,data:tx.data as Hex,value:0n,nonce:Number(tx.nonce),gas:BigInt(tx.gas),gasPrice:BigInt(tx.gasPrice)});
  }};
 }
 return {status:access.status,signer};
}
