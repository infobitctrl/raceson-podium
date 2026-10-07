import {ExternalLink} from 'lucide-react';
import type {RewardSponsorSelection} from '@raceson/domain/rewards/distribution-setup';
import {officialSource} from '../model/officialSource';
import s from './CampaignOverview.module.css';
export default function OfficialSourceLinks({selection,slot,hr=false}:{selection:RewardSponsorSelection|null|undefined;slot?:number;hr?:boolean}){
 const source=officialSource(selection,slot);
 if(!source)return null;
 return <div className={s.links}>{source.eventUrl?<a href={source.eventUrl} target="_blank" rel="noopener noreferrer">{hr?'Događaj na RacesOnu':'Event on RacesOn'}<ExternalLink size={13}/></a>:null}<a href={source.leagueUrl} target="_blank" rel="noopener noreferrer">{hr?'Liga na RacesOnu':'League on RacesOn'}<ExternalLink size={13}/></a></div>;
}
