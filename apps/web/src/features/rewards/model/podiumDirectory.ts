import {campaignFinished,campaignStatus,campaignSum,type DirectoryCampaign} from '@raceson/domain/rewards/public-directory';
import {sponsorCatalogue,sponsorArtwork,sponsorLeague} from './sponsorCatalogue';
export const normalizeSearch=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase();
export function campaignSource(item:DirectoryCampaign){
 const s=item.selection;
 const event=s&&sponsorCatalogue.find(e=>e.eventEditionId===s.eventEditionId&&(s.raceId?e.raceId===s.raceId:e.kind==='race'));
 const league=s?.sourceLeagueId===sponsorLeague.sourceLeagueId&&s?.sourceSeasonId===sponsorLeague.sourceSeasonId&&!s.eventEditionId;
 return{image:event?.image??sponsorArtwork.league,name:event?.name??(league?sponsorLeague.name:null),date:event?.date??null};
}
export const statusLabels={unavailable:['Status unavailable','Stanje nije dostupno'],cancelled:['Cancelled · settled','Otkazano · podmireno'],finished:['Finished','Završeno'],settling:['Awaiting settlement','Čeka podmirenje'],paused:['Claims paused','Preuzimanje pauzirano'],claiming:['Claims open','Preuzimanje otvoreno'],activating:['Awaiting activation','Čeka aktivaciju'],review:['Awaiting results review','Čeka pregled rezultata']} as const;
export const statusLabel=(item:DirectoryCampaign,hr:boolean)=>statusLabels[campaignStatus(item)][hr?1:0];
export type CampaignSort='name'|'funded'|'paid'|'returned'|'date'|'status'|'pots';
export function selectCampaigns(items:DirectoryCampaign[],{status,query,sort,descending}:{status:string;query:string;sort:CampaignSort;descending:boolean}){
 return items.filter(i=>(status==='all'||status==='finished'?status==='all'||campaignFinished(i):!campaignFinished(i))&&normalizeSearch(`${i.campaign.name} ${campaignSource(i).name??''}`).includes(normalizeSearch(query.trim())))
 .sort((a,b)=>{let v=0;
  if(sort==='name')v=a.campaign.name.localeCompare(b.campaign.name);
  else if(sort==='date')v=Date.parse(a.publishedAt)-Date.parse(b.publishedAt);
  else if(sort==='status')v=campaignStatus(a).localeCompare(campaignStatus(b));
  else if(sort==='pots')v=a.campaign.pots.length-b.campaign.pots.length;
  else{const x=sort==='funded'?BigInt(a.campaign.budgetWei):campaignSum(a.campaign,sort==='paid'?'paidWei':'returnedWei'),y=sort==='funded'?BigInt(b.campaign.budgetWei):campaignSum(b.campaign,sort==='paid'?'paidWei':'returnedWei');v=x<y?-1:x>y?1:0;}
  return (descending?-v:v)||a.campaign.id.localeCompare(b.campaign.id);
 });
}
