import {decodePublicSponsorCampaign, type PublicSponsorCampaign} from '@raceson/domain/rewards/public-campaign';
import {decodeSponsorExecutionRecord} from '@raceson/domain/rewards/sponsor-execution';
import {setupId} from '@raceson/domain/rewards/distribution-setup';
import {createAdminSupabaseClient} from '../supabase.js';
import type {RewardLedgerRpc} from './programme-ledger.js';
import type {RewardAccountIdentity} from './athlete-wallets.js';

export async function rewardPublicCampaign(chainId: 10143 | 31337, id: string,
 publish?: {identity: RewardAccountIdentity; campaign: PublicSponsorCampaign}, rpc?: RewardLedgerRpc) {
 if (!setupId(id) || ![10143,31337].includes(chainId)) throw Error('invalid_public_campaign');
 const campaign = publish ? decodePublicSponsorCampaign(publish.campaign) : null;
 const result = await (rpc ?? ((name,args)=>createAdminSupabaseClient().rpc(name,args)))('service_reward_public_campaign', {
  p_chain_id:chainId,p_setup_id:id,p_actor_user_id:publish?.identity.userId??null,
  p_actor_session_id:publish?.identity.sessionId??null,p_campaign:campaign,
 });
 if (result.error) throw Error((result.error as {message?:string}).message ?? 'public_campaign_unavailable');
 if (result.data === null) return null;
 const raw = result.data as {campaign: unknown;record:unknown};
 const view = decodePublicSponsorCampaign(raw.campaign), record = decodeSponsorExecutionRecord(raw.record);
 if (view.id!==id || view.chainId!==chainId || !record || record.plan.chainId!==chainId || record.fundingHash!==view.fundingHash || record.plan.budgetWei!==view.budgetWei) throw Error('invalid_public_campaign');
 return {campaign:view,record};
}

/** Internal public-input projection. The chain service validates commitments
 * before reducing it to the public reward page. */
export async function rewardPublicAwards(chainId:10143|31337,id:string,slot:number,rpc?:RewardLedgerRpc):Promise<unknown> {
 if(!setupId(id) || ![10143,31337].includes(chainId) || !Number.isInteger(slot) || slot<0 || slot>5)throw Error('invalid_public_awards');
 const result=await (rpc??((name,args)=>createAdminSupabaseClient().rpc(name,args)))('service_reward_public_awards_v4',{p_chain_id:chainId,p_setup_id:id,p_slot:slot});
 if(result.error)throw Error('public_awards_unavailable');
 return result.data;
}
