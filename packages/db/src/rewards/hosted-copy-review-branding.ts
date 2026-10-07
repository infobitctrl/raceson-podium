import {decodeCampaignBranding} from '@raceson/domain/rewards/campaign-branding';
import {setupId} from '@raceson/domain/rewards/distribution-setup';
import type {RewardAccountIdentity} from './athlete-wallets.js';
import type {RewardLedgerRpc} from './programme-ledger.js';
export async function hostedCopyReviewBranding(identity:RewardAccountIdentity,id:string|null,ids:readonly string[],rpc:RewardLedgerRpc){
 if(![identity.userId,identity.sessionId].every(setupId)||id!==null&&!setupId(id))throw Error('invalid_reward_setup');
 const response=await rpc('service_reward_demo_copy_review_branding',{p_actor_user_id:identity.userId,p_actor_session_id:identity.sessionId,p_setup_id:id});
 if(response.error)throw Error((response.error as {message?:string}).message??'hosted_copy_unavailable');
 const records=decodeCampaignBranding(response.data);
 if(records.length!==ids.length||records.some(record=>!ids.includes(record.id)))throw Error('reward_setup_conflict');
 return records;
}
