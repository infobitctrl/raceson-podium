import {decodePublicSponsorCampaign,decodePublicRewardPage} from '@raceson/domain/rewards/public-campaign';
import {setupId} from '@raceson/domain/rewards/distribution-setup';
import {apiRequest,ApiError} from '@/lib/api';
import {assertPublicEnvironmentOrigin,publicEnv} from '@/lib/public-env';

export const publicCampaignPath = (id:string) => `/rewards/campaigns/${id}/public`;
export async function completeSponsorSetup(id:string) {
 if(!setupId(id) || !publicEnv.rewardDemo)throw Error('invalid_public_campaign');
 return decodePublicSponsorCampaign(await apiRequest({path:`/v1/rewards/public-campaigns/${id}`,method:'POST',body:{},cache:'no-store'}));
}
export async function readPublicCampaign(id:string,signal:AbortSignal) {
 assertPublicEnvironmentOrigin();
 const demo=publicEnv.rewardDemo;
 if(!setupId(id) || !demo)throw Error('invalid_public_campaign');
 const response=await fetch(`${demo.apiBaseUrl}/v1/rewards/public-campaigns/${id}`,{
  method:'GET',credentials:'omit',cache:'no-store',redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(60000)]),headers:{Accept:'application/json'},
 });
 if(!response.ok)throw new ApiError('Campaign unavailable',{status:response.status,code:'public_campaign_unavailable'});
 const envelope:unknown=await response.json();
 if(!envelope || typeof envelope!=='object' || !('data' in envelope))throw Error('invalid_public_campaign');
 const campaign=decodePublicSponsorCampaign(envelope.data);
 if(campaign.id!==id || campaign.chainId!==demo.chainId)throw Error('invalid_public_campaign');
 return campaign;
}

export async function readPublicRewards(id:string,slot:number,offset:number,sort:'reward'|'amount',direction:'asc'|'desc',signal:AbortSignal) {
 assertPublicEnvironmentOrigin();
 const demo=publicEnv.rewardDemo;
 if(!setupId(id)||!demo||!Number.isInteger(slot)||slot<0||slot>5)throw Error('invalid_public_awards');
 const response=await fetch(`${demo.apiBaseUrl}/v1/rewards/public-campaigns/${id}/pots/${slot}/awards?offset=${offset}&sort=${sort}&direction=${direction}`,{
  method:'GET',credentials:'omit',cache:'no-store',redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(60000)]),headers:{Accept:'application/json'},
 });
 if(!response.ok)throw new ApiError('Rewards unavailable',{status:response.status,code:'public_awards_unavailable'});
 const envelope:unknown=await response.json();
 if(!envelope||typeof envelope!=='object'||!('data' in envelope))throw Error('invalid_public_awards');
 const page=decodePublicRewardPage(envelope.data);
 if(page.campaignId!==id||page.chainId!==demo.chainId||page.slot!==slot||page.offset!==offset||page.sort!==sort||page.direction!==direction)throw Error('invalid_public_awards');
 return page;
}
