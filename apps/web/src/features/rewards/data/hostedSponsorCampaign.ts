import {apiRequest} from '@/lib/api';
import {decodeSavedRewardSetup,setupId} from '@raceson/domain/rewards/distribution-setup';

/** Copy planning has no execution authority. Never treat a planned award or a
 * wallet balance as a deposit, or infer a contract from the saved revision. */
export async function readHostedSponsorCampaign(id:string){
 if(!setupId(id))throw Error('invalid_reward_setup');
 const value=await apiRequest<{record:unknown;fundedWei:unknown;approvedWei:unknown;payableWei:unknown}>({path:`/v1/rewards/demo-copy/sponsor-setups/${id}`,cache:'no-store'});
 const record=decodeSavedRewardSetup(value.record,10143,id);
 if(value.fundedWei!=='0'||value.approvedWei!=='0'||value.payableWei!=='0')throw Error('invalid_hosted_campaign_state');
 return {record,fundedWei:value.fundedWei};
}
