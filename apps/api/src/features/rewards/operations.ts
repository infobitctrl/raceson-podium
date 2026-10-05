import {createHash} from 'node:crypto';
import {z} from 'zod';
import {rewardSupportSettings,type RewardAccountIdentity,type RewardLedgerRpc} from '@raceson/db/rewards';
import {decodeSupportSettings,type SupportSettings} from '@raceson/domain/rewards/operations';
import {canonicalRewardJson} from '@raceson/rewards-chain';
import {walletRuntime} from './wallet-administration.js';
import {controllerPublicClient} from '@raceson/rewards-chain/canary-public-client';

const common={expectedRevision:z.number().int().min(0).max(999999999),settings:z.unknown()};
const command=z.discriminatedUnion('action',[
 z.object({...common,action:z.literal('review')}).strict(),
 z.object({...common,action:z.literal('save'),requestId:z.string().uuid(),reviewFingerprint:z.string().regex(/^[0-9a-f]{64}$/),reason:z.string().trim().min(8).max(500)}).strict(),
]);
export const supportFingerprint=(revision:number,settings:SupportSettings)=>createHash('sha256').update(canonicalRewardJson({revision,settings})).digest('hex');
export async function changeSupportSettings(identity:RewardAccountIdentity,input:unknown,rpc?:RewardLedgerRpc){
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
export async function readSupportSettings(identity:RewardAccountIdentity,rpc?:RewardLedgerRpc,readGas:()=>Promise<{address:string;balanceWei:string}|null>=async()=>{
 const runtime=await walletRuntime(process.env,rpc),address=runtime.settings?.deployment.address;
 if(!address)return null;
 return {address,balanceWei:(await controllerPublicClient.getBalance({address:address as `0x${string}`,blockTag:'latest'})).toString()};
}){
 await rewardSupportSettings(identity,undefined,rpc);
 let gas:{address:string;balanceWei:string}|null=null;
 try{gas=await readGas();}catch{/* Settings remain readable when the chain is unavailable. */}
 // Recheck the session/authority and settings after the chain read.
 const fresh=await rewardSupportSettings(identity,undefined,rpc);
 return {...fresh,gas:gas?{...gas,low:fresh.settings.gasAlertWei===null?null:BigInt(gas.balanceWei)<BigInt(fresh.settings.gasAlertWei)}:null};
}
