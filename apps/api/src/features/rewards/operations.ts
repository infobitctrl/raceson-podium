import {createHash} from 'node:crypto';
import {z} from 'zod';
import {rewardSupportSettings,hostedCopySupportRpc,type RewardAccountIdentity,type RewardLedgerRpc} from '@raceson/db/rewards';
import {createAdminSupabaseClient,loadServerEnv} from '@raceson/db';
import {decodeSupportSettings,type SupportSettings} from '@raceson/domain/rewards/operations';
import {canonicalRewardJson} from '@raceson/rewards-chain';
import {walletRuntime,hostedWalletEnvironment,initialWalletSettings} from './wallet-administration.js';
import {controllerPublicClient} from '@raceson/rewards-chain/canary-public-client';

const common={expectedRevision:z.number().int().min(0).max(999999999),settings:z.unknown()};
const command=z.discriminatedUnion('action',[
 z.object({...common,action:z.literal('review')}).strict(),
 z.object({...common,action:z.literal('save'),requestId:z.string().uuid(),reviewFingerprint:z.string().regex(/^[0-9a-f]{64}$/),reason:z.string().trim().min(8).max(500)}).strict(),
]);
export const supportFingerprint=(revision:number,settings:SupportSettings)=>createHash('sha256').update(canonicalRewardJson({revision,settings})).digest('hex');
function supportRpc(identity:RewardAccountIdentity,rpc?:RewardLedgerRpc){
 return hostedWalletEnvironment(process.env)?hostedCopySupportRpc(identity,rpc??((name,args)=>createAdminSupabaseClient(loadServerEnv(process.env)).rpc(name,args))):rpc;
}
export async function changeSupportSettings(identity:RewardAccountIdentity,input:unknown,rpc?:RewardLedgerRpc){
 rpc=supportRpc(identity,rpc);
 const c=command.parse(input),settings=decodeSupportSettings(c.settings);
 // The repository owns CAS and exact retry semantics for writes.
 if(c.action==='save'){
  if(c.reviewFingerprint!==supportFingerprint(c.expectedRevision,settings))throw Error('reward_support_review_required');
  return rewardSupportSettings(identity,{expectedRevision:c.expectedRevision,settings,reason:c.reason,requestId:c.requestId},rpc);
 }
 const current=await rewardSupportSettings(identity,undefined,rpc);
 if(current.revision!==c.expectedRevision)throw Error('reward_support_settings_conflict');
 return {revision:current.revision,settings,fingerprint:supportFingerprint(current.revision,settings)};
}
export async function readConfiguredSupportGas(env:Record<string,string|undefined>,rpc?:RewardLedgerRpc,
 reader:{getBalance:(input:{address:`0x${string}`;blockTag:'latest'})=>Promise<bigint>}=controllerPublicClient){
 const runtime=await walletRuntime(env,rpc),address=runtime.settings?.deployment.address;
 if(!address||hostedWalletEnvironment(env)&&(runtime.revision===0||address===initialWalletSettings(env)?.deployment.address))return null;
 return {address,balanceWei:(await reader.getBalance({address:address as `0x${string}`,blockTag:'latest'})).toString()};
}
export async function readSupportSettings(identity:RewardAccountIdentity,rpc?:RewardLedgerRpc,readGas:()=>Promise<{address:string;balanceWei:string}|null>=()=>readConfiguredSupportGas(process.env,rpc)){
 const scoped=supportRpc(identity,rpc);
 await rewardSupportSettings(identity,undefined,scoped);
 let gas:{address:string;balanceWei:string}|null=null;
 try{gas=await readGas();}catch{/* Settings remain readable when the chain is unavailable. */}
 // Recheck the session/authority and settings after the chain read.
 const fresh=await rewardSupportSettings(identity,undefined,scoped);
 return {...fresh,gas:gas?{...gas,low:fresh.settings.gasAlertWei===null?null:BigInt(gas.balanceWei)<BigInt(fresh.settings.gasAlertWei)}:null};
}
