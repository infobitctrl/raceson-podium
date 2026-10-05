import {z} from 'zod';
import {PrivyClient} from '@privy-io/node';
import {rewardWalletSettings,rewardWalletRuntime,hostedCopyWalletRpc,type RewardAccountIdentity,type RewardLedgerRpc} from '@raceson/db/rewards';
import {createAdminSupabaseClient,loadServerEnv} from '@raceson/db';
import {hostedCopyOperationsEnabled} from './hosted-copy-preview.js';
import {controllerDeploymentConfig,controllerDeploymentFromEnv,controllerDeploymentDigest,verifyControllerDelegation,sponsorCreationSignerFromEnv} from './sponsor-creation-privy.js';
import {controllerPolicyFromEnv,authenticateController,type ControllerPolicy} from './controller-auth.js';
import {verifySponsorFactory} from '@raceson/rewards-chain/sponsor-v4';
import {canaryPublicClient} from '@raceson/rewards-chain/canary-public-client';
import type {Hex} from 'viem';
import {createHash} from 'node:crypto';
import {canonicalRewardJson as canonical} from '@raceson/rewards-chain';
const address=z.string().regex(/^0x[0-9a-f]{40}$/).refine(v=>BigInt(v)!==0n);
const id=z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
export const controllerWalletSchema=z.object({subject:z.string().regex(/^did:privy:[a-zA-Z0-9_-]{1,100}$/),wallet:address,walletId:id.optional(),ownerId:id.optional()}).strict();
export const walletSettingsSchema=z.object({deployment:controllerDeploymentConfig,controller:controllerWalletSchema}).strict();
export type WalletSettings=z.infer<typeof walletSettingsSchema>;
const stored=z.object({revision:z.number().int().min(0),settings:walletSettingsSchema.nullable(),history:z.array(z.object({revision:z.number().int(),settings:walletSettingsSchema,changed_by:z.string().uuid(),reason:z.string(),changed_at:z.string()}))});
const runtimeSchema=z.object({revision:z.number().int().min(0),settings:walletSettingsSchema.nullable(),controllers:z.array(controllerWalletSchema),deployments:z.array(controllerDeploymentConfig)}).strict();
type Env=Record<string,string|undefined>;
export function hostedWalletEnvironment(env:Env){
 return hostedCopyOperationsEnabled(env,{supabaseUrl:env.SUPABASE_URL??''});
}
const walletRpc=(env:Env,rpc?:RewardLedgerRpc)=>hostedWalletEnvironment(env)?hostedCopyWalletRpc(rpc??((name,args)=>createAdminSupabaseClient(loadServerEnv(env)).rpc(name,args))):rpc;
export function initialWalletSettings(env:Env):WalletSettings|null{
 const deployment=controllerDeploymentFromEnv(env),controller=controllerPolicyFromEnv(env);
 return deployment&&controller?{deployment,controller:{subject:controller.subject,wallet:controller.wallet,...(deployment.address===controller.wallet?{walletId:deployment.walletId,ownerId:deployment.ownerId}:{})}}:null;
}
export async function walletRuntime(env:Env,rpc?:RewardLedgerRpc){
 const r=runtimeSchema.parse(await rewardWalletRuntime(walletRpc(env,rpc))),initial=initialWalletSettings(env),base=controllerPolicyFromEnv(env);
 return {...r,settings:r.settings??initial,controllers:[...(r.settings?[r.settings.controller]:[]),...r.controllers,...(initial?[initial.controller]:base?[{subject:base.subject,wallet:base.wallet}]:[])],deployments:[...(r.settings?[r.settings.deployment]:[]),...r.deployments,...(initial?[initial.deployment]:[])]};
}
export async function readWalletAdministration(identity:RewardAccountIdentity,env:Env,rpc?:RewardLedgerRpc){
 const r=stored.parse(await rewardWalletSettings(identity,undefined,walletRpc(env,rpc))),settings=r.settings??initialWalletSettings(env);return {...r,settings,fingerprint:walletSettingsFingerprint(settings)};
}
export const walletSettingsFingerprint=(v:WalletSettings|null)=>createHash('sha256').update(canonical(v)).digest('hex');
export type WalletCandidateVerifier=(role:'deployment'|'controller',walletId:string,current:WalletSettings)=>Promise<WalletSettings['deployment']|WalletSettings['controller']>;
export function verifyControllerOwner(user:unknown,walletId:string,walletAddress:string){
 const value=z.object({id:z.string(),linked_accounts:z.array(z.object({type:z.string()}).passthrough())}).parse(user);
 if(value.linked_accounts.some(a=>a.type==='custom_auth')||!value.linked_accounts.some(a=>a.type==='wallet'&&a.id===walletId&&typeof a.address==='string'&&a.address.toLowerCase()===walletAddress.toLowerCase()&&a.chain_type==='ethereum'&&a.connector_type==='embedded'&&a.wallet_client_type==='privy'&&a.imported===false&&a.user_can_sign!==false))throw Error('reward_wallet_unverified');
 return value.id;
}
export function privyWalletVerifier(env:Env):WalletCandidateVerifier{return async(role,walletId,current)=>{
 if(env.RACESON_REWARD_PORTAL_MODE!=='local-testnet'&&!hostedWalletEnvironment(env)||!env.RACESON_REWARD_PRIVY_APP_ID||!env.RACESON_SPONSOR_DEPLOYMENT_APP_SECRET)throw Error('reward_wallet_provider_unavailable');
 const client=new PrivyClient({appId:env.RACESON_REWARD_PRIVY_APP_ID,appSecret:env.RACESON_SPONSOR_DEPLOYMENT_APP_SECRET,maxRetries:0,timeout:15000});
 const w=await client.wallets().get(walletId);
 if(w.chain_type!=='ethereum'||!w.owner_id||w.archived_at||w.imported_at||w.exported_at)throw Error('reward_wallet_unverified');
 // Native user-controlled ownership only. The app signing key cannot own either wallet.
 const owner=await client.keyQuorums().get(w.owner_id);
 if(owner.authorization_threshold!==1||owner.authorization_keys.length||owner.user_ids?.length!==1||owner.key_quorum_ids?.length)throw Error('reward_wallet_unverified');
 const subject=verifyControllerOwner(await client.users()._get(owner.user_ids[0]!),w.id,w.address);
 if(subject!==owner.user_ids[0])throw Error('reward_wallet_unverified');
 if(role==='controller'){
  return controllerWalletSchema.parse({subject,wallet:w.address.toLowerCase(),walletId:w.id,ownerId:w.owner_id});
 }
 const c=controllerDeploymentConfig.parse({...current.deployment,appId:env.RACESON_REWARD_PRIVY_APP_ID,walletId:w.id,address:w.address.toLowerCase(),ownerId:w.owner_id});
 if(!env.RACESON_CONTROLLER_DEPLOYMENT_AUTH_KEY)throw Error('reward_wallet_provider_unavailable');
 await verifyControllerDelegation(client,c,env.RACESON_CONTROLLER_DEPLOYMENT_AUTH_KEY);await verifySponsorFactory(canaryPublicClient,c.factory as Hex);
 return c;
};}
// Read-only preparation. Creation and granting happen in the native owner's SDK;
// the master session cannot create a service-owned substitute wallet.
export const walletCreationCommand=z.object({expectedRevision:z.number().int().min(0),expectedFingerprint:z.string().regex(/^[0-9a-f]{64}$/)}).strict();
export async function prepareWalletCreation(identity:RewardAccountIdentity,input:unknown,env:Env,resolveOwner:(current:WalletSettings)=>Promise<string>,rpc?:RewardLedgerRpc){
 const command=walletCreationCommand.parse(input),before=await readWalletAdministration(identity,env,rpc);
 if(!before.settings)throw Error('reward_wallet_provider_unavailable');
 if(before.revision!==command.expectedRevision||before.fingerprint!==command.expectedFingerprint)throw Error('reward_wallet_settings_conflict');
 const ownerSubject=await resolveOwner(before.settings);
 if(!/^did:privy:[a-zA-Z0-9_-]{1,100}$/.test(ownerSubject))throw Error('reward_wallet_unverified');
 const after=await readWalletAdministration(identity,env,rpc);
 if(after.revision!==before.revision||after.fingerprint!==before.fingerprint)throw Error('reward_wallet_settings_conflict');
 return {ownerSubject,deployment:before.settings.deployment,revision:before.revision,fingerprint:before.fingerprint};
}
export const privyCreationOwner=(env:Env)=>async(current:WalletSettings)=>{
 await privyWalletVerifier(env)('deployment',current.deployment.walletId,current);
 const client=new PrivyClient({appId:env.RACESON_REWARD_PRIVY_APP_ID!,appSecret:env.RACESON_SPONSOR_DEPLOYMENT_APP_SECRET!,maxRetries:0,timeout:15000});
 const owner=await client.keyQuorums().get(current.deployment.ownerId);
 if(owner.user_ids?.length!==1)throw Error('reward_wallet_unverified');
 return owner.user_ids[0]!;
};
export const walletAdministrationCommand=z.object({action:z.enum(['review','activate']),role:z.enum(['deployment','controller']),walletId:id,
 expectedRevision:z.number().int().min(0),expectedFingerprint:z.string().regex(/^[0-9a-f]{64}$/),
 candidateFingerprint:z.string().regex(/^[0-9a-f]{64}$/).optional(),reason:z.string().trim().min(8).max(500).optional()}).strict();
export async function changeWalletAdministration(identity:RewardAccountIdentity,input:unknown,env:Env,verify:WalletCandidateVerifier,rpc?:RewardLedgerRpc){
 const r=walletAdministrationCommand.parse(input),before=await readWalletAdministration(identity,env,rpc);
 if(!before.settings)throw Error('reward_wallet_provider_unavailable');
 if(before.revision!==r.expectedRevision||walletSettingsFingerprint(before.settings)!==r.expectedFingerprint)throw Error('reward_wallet_settings_conflict');
 const candidate=await verify(r.role,r.walletId,before.settings);
 const next=walletSettingsSchema.parse({...before.settings,[r.role]:candidate});
 if(next.deployment.address===next.controller.wallet)throw Error('reward_wallet_roles_must_differ');
 const history=await walletRuntime(env,rpc);
 if(r.role==='deployment'?history.controllers.some(c=>c.wallet===next.deployment.address):history.deployments.some(d=>d.address===next.controller.wallet))throw Error('reward_wallet_previous_role_conflict');
 const fingerprint=walletSettingsFingerprint(next);
 // Recheck session/master role after provider I/O, before returning facts or writing.
 const fresh=await readWalletAdministration(identity,env,rpc);
 if(fresh.revision!==before.revision||walletSettingsFingerprint(fresh.settings)!==r.expectedFingerprint)throw Error('reward_wallet_settings_conflict');
 if(r.action==='review')return {candidate:next,fingerprint,revision:before.revision};
 if(!r.reason||r.candidateFingerprint!==fingerprint)throw Error('reward_wallet_review_required');
 const verifiedDeployment=await verify('deployment',next.deployment.walletId,next);
 if(canonical(verifiedDeployment)!==canonical(next.deployment))throw Error('reward_wallet_unverified');
 const saved=stored.parse(await rewardWalletSettings(identity,{expectedRevision:r.expectedRevision,settings:next,previousSettings:before.settings,reason:r.reason},walletRpc(env,rpc)));return {...saved,fingerprint:walletSettingsFingerprint(saved.settings)};
}
export async function resolveControllerPolicy(env:Env,token:string,requestedWallet?:string,rpc?:RewardLedgerRpc):Promise<ControllerPolicy|null>{
 const base=controllerPolicyFromEnv(env);if(!base)return null;
 if(requestedWallet&&!address.safeParse(requestedWallet).success)throw Error('controller_auth_required');
 const runtime=await walletRuntime(env,rpc);
 for(const c of runtime.controllers){if(requestedWallet&&c.wallet!==requestedWallet)continue;
  const p={...base,subject:c.subject,wallet:c.wallet};try{await authenticateController(token,p);return p;}catch{/* Try another retained controller belonging to this verified token subject. */}
 }
 throw Error('controller_auth_required');
}
export function deploymentSignerFor(env:Env,settings:WalletSettings['deployment']){
 // A persisted, master-reviewed provider configuration is still verified against Privy on every use.
 return sponsorCreationSignerFromEnv({...env,RACESON_CONTROLLER_DEPLOYMENT:JSON.stringify(settings),RACESON_CONTROLLER_DEPLOYMENT_VERIFIED:controllerDeploymentDigest(settings)});
}
