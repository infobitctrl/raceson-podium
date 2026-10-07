import type {RewardSponsorSelection} from '@raceson/domain/rewards/distribution-setup';
import {CampaignSponsor} from './CampaignSponsor';
import {officialSource} from '../model/officialSource';
import OfficialSourceLinks from './OfficialSourceLinks';
import s from './CampaignOverview.module.css';
export default function CampaignOverview({id,selection,slot,hr=false}:{id:string;selection:RewardSponsorSelection|null|undefined;slot?:number;hr?:boolean}){
 const source=officialSource(selection,slot);
 return <section className={s.overview} aria-label={hr?'Sponzor i događaj':'Sponsor and event'}>{source?<div className={s.event}><img src={source.image} alt=""/><div><small>{hr?'Sponzorirani događaj':'Sponsored event'}</small><h2>{source.name}</h2><OfficialSourceLinks selection={selection} slot={slot} hr={hr}/></div></div>:null}<div className={s.sponsor}><CampaignSponsor id={id} hr={hr} backing={source?.name}/></div></section>;
}
