import {publicEnv} from "@/lib/public-env";
import type {SavedRewardSetup} from '@raceson/domain/rewards/distribution-setup';
import {campaignStatus,type DirectoryCampaign} from '@raceson/domain/rewards/public-directory';
import {statusLabel} from './podiumDirectory';
import {sponsorLaunchSourcesReady} from '@raceson/domain/rewards/sponsor-launch';

/** Shared wording for the card and sortable table; lifecycle remains a server fact. */
export function savedCampaignStatus(record:SavedRewardSetup,hr:boolean,finished=false,live?:DirectoryCampaign){
 const t=(en:string,local:string)=>hr?local:en,state=record.lifecycle?.state;
 const label=live?.campaign.id===record.id?`${live.verified?t("Last checked · ","Zadnja provjera · "):""}${statusLabel(live,hr)}`:finished?t('Finished','Završeno'):state==='funded'?t('Funded','Financirano')
  :state==='deposit'?sponsorLaunchSourcesReady(record)?t('Ready for deposit','Spremno za uplatu'):t('Source links required','Potrebne poveznice rezultata')
  :state==='saved'?t('Saved · not launched','Spremljeno · nije pokrenuto')
  :record.configuration.stage==='ready'?t('Ready for results','Spremno za rezultate'):t('Draft','Nacrt');
 return record.lifecycle?.archived?`${t('Archived','Arhivirano')} · ${label}`:label;
}
export function savedCampaignHref(record:SavedRewardSetup){
 if(publicEnv.hostedCopy)return `/rewards/create?setup=${record.id}`;
 const c=record.configuration;
 return c.version===5?(record.lifecycle?.state==='draft'&&c.stage!=='ready'?`/rewards/create?setup=${record.id}`:`/rewards/campaigns/${record.id}`):`/rewards/setup?setup=${record.id}${c.stage==='ready'?'&view=results':''}`;
}

export function savedCampaignNext(record:SavedRewardSetup,hr:boolean,live?:DirectoryCampaign){
 const t=(en:string,local:string)=>hr?local:en;
 if(live?.campaign.id===record.id){
  const status=campaignStatus(live);
  return ({unavailable:t('Check campaign status','Provjerite stanje kampanje'),review:t('RacesOn team · Review official results','RacesOn tim · Pregled službenih rezultata'),activating:t('Controller · Open claims','Kontrolor · Otvaranje preuzimanja'),claiming:t('Athletes & clubs · Claim rewards','Sportaši i klubovi · Preuzimanje nagrada'),paused:t('RacesOn team · Review the pause','RacesOn tim · Provjera pauze'),settling:t('RacesOn team · Review settlement','RacesOn tim · Provjera podmirenja'),finished:t('View final payments and returns','Pregledajte konačne isplate i povrate'),cancelled:t('View final returns','Pregledajte konačne povrate')})[status];
 }
 return record.lifecycle?.state==='funded'?t('Deposit recorded · Check current distribution','Uplata zabilježena · Provjerite trenutačnu raspodjelu'):record.lifecycle?.state==='deposit'?t('Sponsor · Check status and fund prizes','Sponzor · Provjerite stanje i uplatite nagrade'):t('Sponsor · Continue campaign setup','Sponzor · Nastavite postavljanje kampanje');
}

/** Sponsor navigation, not permission to perform another role's next action. */
export function savedCampaignAction(record:SavedRewardSetup,hr:boolean,live?:DirectoryCampaign){
 const t=(en:string,local:string)=>hr?local:en;
 if(record.lifecycle?.archived)return t('View campaign','Pregledaj kampanju');
 if(live?.campaign.id===record.id)return live.verified?t('Track rewards','Prati nagrade'):t('Check status','Provjeri stanje');
 if(record.lifecycle?.state==='funded')return t('Check distribution','Provjeri raspodjelu');
 if(['saved','deposit'].includes(record.lifecycle?.state??'')&&!sponsorLaunchSourcesReady(record))return t('Review source links','Pregledaj poveznice rezultata');
 if(record.lifecycle?.state==='deposit')return t('Review deposit','Pregledaj uplatu');
 if(record.lifecycle?.state==='saved')return t('Create & fund','Izradi i uplati');
 return record.configuration.stage==='ready'?t('Review results','Pregledaj rezultate'):t('Continue setup','Nastavi postavljanje');
}
