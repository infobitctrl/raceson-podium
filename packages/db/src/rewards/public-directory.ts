import {decodePublicSponsorCampaign} from '@raceson/domain/rewards/public-campaign';
import {decodeRewardSponsorSelection} from '@raceson/domain/rewards/distribution-setup';
import {decodeSponsorExecutionRecord} from '@raceson/domain/rewards/sponsor-execution';
import {createAdminSupabaseClient} from '../supabase.js';
import type {RewardLedgerRpc} from './programme-ledger.js';
export async function rewardPublicDirectory(chainId:10143|31337,rpc?:RewardLedgerRpc){
 if(![10143,31337].includes(chainId))throw Error('invalid_public_directory');
 const result=await(rpc??((name,args)=>createAdminSupabaseClient().rpc(name,args)))('service_reward_public_directory',{p_chain_id:chainId});
 if(result.error)throw Error('public_directory_unavailable');
 const raw=result.data as {sponsors:number;items:{campaign:unknown;record:unknown;selection:unknown;publishedAt:string}[]};
 if(!raw||!Number.isSafeInteger(raw.sponsors)||raw.sponsors<0||!Array.isArray(raw.items)||raw.sponsors>raw.items.length)throw Error('invalid_public_directory');
 const ids=new Set<string>();
 const items=raw.items.map(item=>{
  const campaign=decodePublicSponsorCampaign(item.campaign),record=decodeSponsorExecutionRecord(item.record);
  if(!record||campaign.chainId!==chainId||record.plan.chainId!==chainId||record.plan.budgetWei!==campaign.budgetWei||record.fundingHash!==campaign.fundingHash||!record.deploymentHash||ids.has(campaign.id)||!Number.isFinite(Date.parse(item.publishedAt)))throw Error('invalid_public_directory');
  ids.add(campaign.id);
  return {campaign,record,selection:item.selection==null?null:decodeRewardSponsorSelection(item.selection),publishedAt:item.publishedAt};
 });
 return {sponsors:raw.sponsors,items};
}
