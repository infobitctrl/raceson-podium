import {decodeBrandingChange,decodeCampaignBranding} from '@raceson/domain/rewards/campaign-branding';
import {setupId} from '@raceson/domain/rewards/distribution-setup';
import {createAdminSupabaseClient} from '../supabase.js';
import type {RewardLedgerRpc} from './programme-ledger.js';
import type {RewardAccountIdentity} from './athlete-wallets.js';
export async function rewardCampaignBranding(chainId:10143|31337,identity?:RewardAccountIdentity,id?:string,change?:unknown,rpc?:RewardLedgerRpc){
 if(![10143,31337].includes(chainId)||id!==undefined&&!setupId(id)||change!==undefined&&(!identity||!id))throw Error('invalid_campaign_branding');
 const body=change===undefined?null:decodeBrandingChange(change);
 const r=await(rpc??((name,args)=>createAdminSupabaseClient().rpc(name,args)))('service_reward_campaign_branding',{
  p_chain_id:chainId,p_actor_user_id:identity?.userId??null,p_actor_session_id:identity?.sessionId??null,p_setup_id:id??null,p_change:body,
 });
 if(r.error)throw Error((r.error as {message?:string}).message??'campaign_branding_unavailable');
 const records=decodeCampaignBranding(r.data);
 if(id&&records.some(r=>r.id!==id)||body&&(records.length!==1||records[0].revision!==body.expectedRevision+1||records[0].name!==body.name||records[0].logo!==body.logo))throw Error('invalid_campaign_branding');
 return records;
}
