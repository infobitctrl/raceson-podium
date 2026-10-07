import {z} from 'zod';
import {sponsorLifecycleFactsV4,hostedCopyLifecycleRpc,type RewardAccountIdentity,type RewardLedgerRpc,type SponsorUploadScopeV4} from '@raceson/db/rewards';
import {canonicalRewardJson as canonical} from '@raceson/rewards-chain';
import {createHash} from 'node:crypto';
import {reviewWalletFromEnv,inspectReviewWallet} from './review-publication-privy.js';
import {authenticateController,controllerPolicyFromEnv} from './controller-auth.js';
const hash=z.string().regex(/^[0-9a-f]{64}$/);
export const reviewWalletHandoverCommand=z.discriminatedUnion('action',[z.object({action:z.literal('transfer'),requestId:z.string().uuid(),expectedFingerprint:hash,ownerToken:z.string().min(1).max(8192),authorizationSignature:z.string().min(40).max(2048),requestExpiry:z.number().int().positive()}).strict(),z.object({action:z.literal('acknowledge'),requestId:z.string().uuid(),expectedFingerprint:hash}).strict()]);
/** One-time current-owner approval; the recipient is derived from the live reviewer,
 * never a browser-supplied DID. No wallet export, balance transfer or new wallet. */
export async function reviewWalletHandover(identity:RewardAccountIdentity,scope:SponsorUploadScopeV4,command:unknown|undefined,env:Record<string,string|undefined>,rpc:RewardLedgerRpc,readWallet=reviewWalletFromEnv){
 const read=()=>sponsorLifecycleFactsV4(identity,scope,undefined,hostedCopyLifecycleRpc(identity,rpc));
 const facts=await read();if(!facts.upload.current||!facts.publication?.current)throw Error('controller_source_not_ready');
 const source=canonical({upload:facts.upload,publication:facts.publication}),operator=facts.upload.execution.plan.operator;
 const {client,access,registered,revision}=await readWallet(identity,operator,env,rpc);
 const assertCurrent=async()=>{const fresh=await read();if(canonical({upload:fresh.upload,publication:fresh.publication})!==source)throw Error('controller_source_not_ready');};
 await assertCurrent();
 const fingerprint=createHash('sha256').update(canonical({scope,documentHash:facts.upload.documentHash,operator,walletId:access.walletId,reviewerSubject:access.reviewerSubject,registered,revision})).digest('hex');
 const body=access.reviewerSubject?{owner:{user_id:access.reviewerSubject},additional_signers:[]}:null;
 const status=access.reviewerSubject?await rpc('service_reward_demo_copy_review_wallet_handover',{p_actor_user_id:identity.userId,p_actor_session_id:identity.sessionId,p_setup_id:scope.setupId,p_slot:scope.slot,p_approval_id:scope.approvalId,p_request_id:null,p_wallet:operator,p_wallet_id:access.walletId,p_reviewer_subject:access.reviewerSubject,p_previous_subject:registered.subject,p_previous_owner_id:registered.ownerId!,p_expected_revision:revision,p_action:'read',p_owner_id:null}):{data:null,error:null};
 if(status.error)throw Error('review_wallet_handover_conflict');
 const pending=z.object({requestId:z.string().uuid()}).nullable().parse(status.data);
 const view=()=>({requestId:pending?.requestId??null,acknowledgementRequired:access.status==='owned'&&!!pending,schema:'podium-review-wallet-handover-v1',...access,reviewerUserId:identity.userId,fingerprint,body});
 if(command===undefined)return view();
 const c=reviewWalletHandoverCommand.parse(command);
 if(!access.reviewerSubject||c.expectedFingerprint!==fingerprint||c.action==='transfer'&&(c.requestExpiry<=Date.now()||c.requestExpiry>Date.now()+120000)||c.action==='acknowledge'&&(access.status!=='owned'||pending?.requestId!==c.requestId))throw Error('review_wallet_handover_conflict');
 const base=controllerPolicyFromEnv(env);if(!base)throw Error('review_wallet_unavailable');
 // Replays after an uncertain provider response acknowledge the already-owned
 // wallet, without using the retired owner's token or attempting another update.
 if(access.status!=='owned'){if(c.action!=='transfer')throw Error('review_wallet_ownership_required');await authenticateController(c.ownerToken,{...base,subject:access.ownerSubject,wallet:operator});}
 await assertCurrent();
 const args={p_actor_user_id:identity.userId,p_actor_session_id:identity.sessionId,p_setup_id:scope.setupId,p_slot:scope.slot,p_approval_id:scope.approvalId,p_request_id:c.requestId,p_wallet:operator,p_wallet_id:access.walletId,p_reviewer_subject:access.reviewerSubject,p_previous_subject:registered.subject,p_previous_owner_id:registered.ownerId!,p_expected_revision:revision};
 const journal=async(action:string,ownerId:string|null)=>{const v=await rpc('service_reward_demo_copy_review_wallet_handover',{...args,p_action:action,p_owner_id:ownerId});if(v.error)throw Error(String((v.error as {message?:string}).message??'review_wallet_handover_conflict'));};
 await journal('prepare',null);await assertCurrent();
 if(access.status!=='owned'&&c.action==='transfer'){
  // The native owner's SDK signs this exact PATCH payload. App credentials
  // alone cannot satisfy the wallet owner's authorization threshold.
  await client.wallets().update(access.walletId,{...body!,authorization_context:{signatures:[c.authorizationSignature]},request_expiry:c.requestExpiry});
 }
 const owned=await inspectReviewWallet(client,identity,operator,registered,access.appId);
 if(owned.status!=='owned'||owned.reviewerSubject!==access.reviewerSubject)throw Error('review_wallet_unverified');
 await assertCurrent();await journal('confirm',owned.ownerId);
 return {...view(),...owned,acknowledgementRequired:false,requestId:c.requestId};
}
