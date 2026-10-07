import {useEffect,useState} from 'react';
import {formatUnits} from 'viem';
import {ArrowRight,Layers,ExternalLink} from 'lucide-react';
import {readHostedReviewSources} from '../data/hostedReviewSources';
import HostedReviewWorkspace from './HostedReviewWorkspace';
import {setupAmount} from '../model/setupAmount';
import {officialSource} from '../model/officialSource';
import {CampaignSponsor,CampaignSponsorRecords} from '../components/CampaignSponsor';
import OfficialSourceLinks from '../components/OfficialSourceLinks';
import p from '../components/Podium.module.css';
import s from './RewardReviewQueue.module.css';
type Queue=Awaited<ReturnType<typeof readHostedReviewSources>>;
export default function HostedReviewQueue({hr,requestedCampaign=null,requestedSlot=null}:{hr:boolean;requestedCampaign?:string|null;requestedSlot?:number|null}){
 const [data,setData]=useState<Queue|null>(null),[error,setError]=useState(false),[retry,setRetry]=useState(0),[selected,setSelected]=useState('');
 const t=(en:string,local:string)=>hr?local:en;
 useEffect(()=>{let current=true;setData(null);setError(false);setSelected('');void readHostedReviewSources().then(v=>{if(current)setData(v);}).catch(()=>{if(current)setError(true);});return()=>{current=false;};},[retry,requestedCampaign,requestedSlot]);
 if(error)return <section className={p.empty}><p role="alert">{t('Review sources could not be verified. Reload to check current access and campaign versions.','Izvori za pregled nisu potvrđeni. Osvježite pristup i verzije kampanja.')}</p><button className={p.secondary} onClick={()=>setRetry(n=>n+1)}>{t('Retry','Pokušaj ponovno')}</button></section>;
 if(!data)return <p role="status">{t('Checking campaigns…','Provjera kampanja…')}</p>;
 const chosen=data.items.find(i=>i.id===(selected||requestedCampaign));
 if(chosen)return <HostedReviewWorkspace key={chosen.id+':'+chosen.launchId} campaign={{id:chosen.id,name:chosen.name,revision:chosen.revision}} hr={hr} requestedSlot={chosen.id===requestedCampaign?requestedSlot:null} onBack={()=>setSelected('queue')}/>;
 return <CampaignSponsorRecords records={data.items.flatMap(i=>i.branding?[i.branding]:[])}><header className={p.heading}><div><span className={p.eyebrow}>{t('Review','Pregled')}</span><h1>{t('Award review queue','Red za pregled nagrada')}</h1><p>{t('Review results, awards and funding for sponsored events.','Pregledajte rezultate, nagrade i uplatu sponzoriranih događaja.')}</p></div><span className={p.badge}>{data.items.length} {t('campaigns','kampanja')}</span></header>
 <div className={s.queue}>{data.items.map(item=>{const source=officialSource(item.selection);return <article key={item.id} className={s.reviewCard} aria-label={item.name}>
  {source?<div className={s.media}><img src={source.image} alt="" loading="lazy"/><span className={p.badge}>{item.executionState==='awaiting_contract'?t('Awaiting contract','Čeka izradu ugovora'):item.executionState==='awaiting_funding'?t('Awaiting funding','Čeka uplatu'):t('Funding needs confirmation','Uplatu treba provjeriti')}</span></div>:null}
  <div className={s.body}><div className={s.cardHeading}><div><h2>{item.name}</h2>{source?<p>{source.name}</p>:null}<OfficialSourceLinks selection={item.selection} hr={hr}/></div><div className={s.budget}><small>{t('Planned budget','Planirani fond')}</small><strong title={`${formatUnits(BigInt(item.budgetWei),18)} test MON`}>{setupAmount(BigInt(item.budgetWei),hr)} <small>test MON</small></strong></div></div>
  {!source?<span className={p.badge}>{item.executionState==='awaiting_contract'?t('Awaiting contract','Čeka izradu ugovora'):item.executionState==='awaiting_funding'?t('Awaiting funding','Čeka uplatu'):t('Funding needs confirmation','Uplatu treba provjeriti')}</span>:null}
  <CampaignSponsor id={item.id} hr={hr}/><div className={s.pools}>{item.pools.map(pool=><div key={pool.slot}><Layers size={14}/><span>{officialSource(item.selection,pool.slot)?<a href={officialSource(item.selection,pool.slot)!.eventUrl??officialSource(item.selection,pool.slot)!.leagueUrl} target="_blank" rel="noopener noreferrer">{pool.name}<ExternalLink size={12}/></a>:pool.name}</span><b>{setupAmount(BigInt(pool.budgetWei),hr)} <small>test MON</small></b></div>)}</div>
  <button className={p.primary} onClick={()=>setSelected(item.id)} aria-label={`${t('Review awards','Pregledaj nagrade')}: ${item.name}`}>{t('Review awards','Pregledaj nagrade')}<ArrowRight size={16}/></button></div>
 </article>;})}{!data.items.length?<p className={p.empty}>{t('No sponsor has continued to funding with saved rules yet.','Sponzor još nije nastavio s financiranjem spremljenih pravila.')}</p>:null}</div>
 {requestedCampaign&&!chosen&&!selected?<p role="status">{t('The requested campaign is not available for review.','Odabrana kampanja nije dostupna za pregled.')}</p>:null}</CampaignSponsorRecords>;
}
