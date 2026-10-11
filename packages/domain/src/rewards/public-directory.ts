import {decodePublicSponsorCampaign,type PublicSponsorCampaign} from './public-campaign.js';
import {decodeRewardSponsorSelection,setupId,type RewardSponsorSelection} from './distribution-setup.js';
export type PublicCampaignSource={id:string;chainId:10143|31337;selection:RewardSponsorSelection|null};
export function decodePublicCampaignSource(value:unknown):PublicCampaignSource{
 const r=value as PublicCampaignSource;
 if(!r||typeof r!=='object'||Array.isArray(r)||Object.keys(r).sort().join()!=='chainId,id,selection'
  ||!setupId(r.id)||![10143,31337].includes(r.chainId))throw Error('invalid_public_campaign_source');
 if(r.selection!==null)decodeRewardSponsorSelection(r.selection);
 return r;
}
export type DirectoryCampaign={campaign:PublicSponsorCampaign;selection:RewardSponsorSelection|null;publishedAt:string;verified:boolean};
/** Historical public projection. Its block timestamp is not a fresh status check. */
export type PublicCampaignSnapshot=Omit<DirectoryCampaign,'verified'>;
export function decodePublicCampaignSnapshot(value:unknown):PublicCampaignSnapshot{
 const r=value as PublicCampaignSnapshot;
 if(!r||typeof r!=='object'||Array.isArray(r)||Object.keys(r).sort().join()!=='campaign,publishedAt,selection'
  ||typeof r.publishedAt!=='string'||!Number.isFinite(Date.parse(r.publishedAt)))throw Error('invalid_public_campaign_snapshot');
 decodePublicSponsorCampaign(r.campaign);
 if(r.selection!==null)decodeRewardSponsorSelection(r.selection);
 return r;
}
export type PublicDirectory={chainId:10143|31337;items:DirectoryCampaign[];sponsors:number;checkedAt:string;refreshStatus:'published'|'refreshing'|'current'|'failed'};
export function decodePublicDirectory(value:unknown):PublicDirectory {
 const bad=()=>{throw Error('invalid_public_directory');};
 if(!value||typeof value!=='object'||Array.isArray(value))return bad();
 const r=value as PublicDirectory;
 if(Object.keys(r).sort().join()!=='chainId,checkedAt,items,refreshStatus,sponsors'||!['published','refreshing','current','failed'].includes(r.refreshStatus)||![10143,31337].includes(r.chainId)||!Number.isSafeInteger(r.sponsors)||r.sponsors<0||typeof r.checkedAt!=='string'||!Number.isFinite(Date.parse(r.checkedAt))||!Array.isArray(r.items)||r.sponsors>r.items.length)return bad();
 const ids=new Set<string>();
 for(const item of r.items){
  if(!item||Object.keys(item).sort().join()!=='campaign,publishedAt,selection,verified'||typeof item.verified!=='boolean'||typeof item.publishedAt!=='string'||!Number.isFinite(Date.parse(item.publishedAt)))return bad();
  const c=decodePublicSponsorCampaign(item.campaign);
  if(c.chainId!==r.chainId||ids.has(c.id))return bad();ids.add(c.id);
  if(item.selection!==null)decodeRewardSponsorSelection(item.selection);
 }
 return r;
}
export type CampaignStatus='unavailable'|'cancelled'|'finished'|'settling'|'paused'|'claiming'|'activating'|'review';
export function campaignStatus(item:DirectoryCampaign):CampaignStatus {
 if(!item.verified)return 'unavailable';
 const c=item.campaign,p=c.pots;
 if(p.every(p=>[4,5].includes(p.state)&&BigInt(p.remainingWei)===0n))return p.every(p=>p.state===5)?'cancelled':'finished';
 if(p.some(p=>p.paused))return 'paused';
 if(p.some(p=>p.state===3&&BigInt(p.claimDeadline)>BigInt(c.blockTimestamp)))return 'claiming';
 if(p.some(p=>[4,5].includes(p.state)||p.state===3&&BigInt(p.claimDeadline)<=BigInt(c.blockTimestamp)))return 'settling';
 if(p.some(p=>p.state===2))return 'activating';
 return 'review';
}
export const campaignFinished=(item:DirectoryCampaign)=>['finished','cancelled'].includes(campaignStatus(item));
export const campaignSum=(c:PublicSponsorCampaign,key:'paidWei'|'remainingWei'|'returnedWei'|'allocatedWei')=>c.pots.reduce((n,p)=>n+BigInt(p[key]),0n);
export function directoryMetrics(d:PublicDirectory){
 if(d.items.some(i=>!i.verified))return null;
 return {active:d.items.filter(i=>!campaignFinished(i)).length,finished:d.items.filter(campaignFinished).length,
  pots:d.items.reduce((n,i)=>n+i.campaign.pots.length,0),sponsors:d.sponsors,
  paidWei:d.items.reduce((n,i)=>n+campaignSum(i.campaign,'paidWei'),0n).toString(),
  fundedWei:d.items.reduce((n,i)=>n+BigInt(i.campaign.budgetWei),0n).toString()};
}
