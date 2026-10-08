import ReviewStatusPills from '../components/ReviewStatusPills';
import ReceiveTestMon from '../components/ReceiveTestMon';
import {formatUnits} from 'viem';
import {useEffect,useState} from 'react';
import {ArrowRight,Layers,ExternalLink} from 'lucide-react';
import {readHostedReviewSources} from '../data/hostedReviewSources';
import HostedReviewWorkspace from './HostedReviewWorkspace';
import {setupAmount,walletBalanceAmount} from '../model/setupAmount';
import {officialSource} from '../model/officialSource';
import {CampaignSponsor,CampaignSponsorRecords} from '../components/CampaignSponsor';
import OfficialSourceLinks from '../components/OfficialSourceLinks';
import p from '../components/Podium.module.css';
import s from './RewardReviewQueue.module.css';
type Queue=Awaited<ReturnType<typeof readHostedReviewSources>>;
export default function HostedReviewQueue({hr,requestedCampaign=null,requestedSlot=null}:{hr:boolean;requestedCampaign?:string|null;requestedSlot?:number|null}){
 const [data,setData]=useState<Queue|null>(null),[error,setError]=useState(false),[retry,setRetry]=useState(0),[selected,setSelected]=useState('');
 const t=(en:string,local:string)=>hr?local:en;
 useEffect(()=>setSelected(''),[requestedCampaign,requestedSlot]);
 useEffect(()=>{let current=true;setData(null);setError(false);void readHostedReviewSources().then(v=>{if(current)setData(v);}).catch(()=>{if(current)setError(true);});return()=>{current=false;};},[retry,requestedCampaign,requestedSlot]);
 if(error)return <section className={p.empty}><p role="alert">{t('Review sources could not be verified. Reload to check current access and campaign versions.','Izvori za pregled nisu potvrđeni. Osvježite pristup i verzije kampanja.')}</p><button className={p.secondary} onClick={()=>setRetry(n=>n+1)}>{t('Retry','Pokušaj ponovno')}</button></section>;
 if(!data)return <p role="status">{t('Checking campaigns…','Provjera kampanja…')}</p>;
 const chosen=data.items.find(i=>i.id===(selected||requestedCampaign));
 if(chosen)return <HostedReviewWorkspace key={chosen.id+':'+chosen.launchId} campaign={{id:chosen.id,name:chosen.name,revision:chosen.revision}} hr={hr} requestedSlot={chosen.id===requestedCampaign?requestedSlot:null} onBack={()=>{setSelected('queue');setRetry(n=>n+1);}}/>;
 return <CampaignSponsorRecords records={data.items.flatMap(i=>i.branding?[i.branding]:[])}><header className={p.heading}><div><span className={p.eyebrow}>{t('Review','Pregled')}</span><h1>{t('Award review queue','Red za pregled nagrada')}</h1><p>{t('Review results, awards and funding for sponsored events.','Pregledajte rezultate, nagrade i uplatu sponzoriranih događaja.')}</p></div><span className={p.badge}>{data.items.length} {t('campaigns','kampanja')}</span></header>
 {data.wallet?<section className={p.empty} aria-label={t('Reviewer rewards wallet','Novčanik nagrada pregledavatelja')}><h2>{t('Your rewards wallet','Vaš novčanik nagrada')}</h2><p>{t('You own this wallet. New campaigns use it to publish approved awards and open claims.','Vi ste vlasnik ovog novčanika. Nove kampanje koriste ga za objavu odobrenih nagrada i otvaranje preuzimanja.')}</p><p><code>{data.wallet.address}</code></p><p>{walletBalanceAmount(BigInt(data.wallet.balanceWei),hr)} test MON · {t('Transaction gas','Trošak transakcija')}</p>{BigInt(data.wallet.balanceWei)===0n?<p role="status">{t('Add test MON before publishing awards.','Dodajte test MON prije objave nagrada.')}</p>:null}<ReceiveTestMon address={data.wallet.address} chainId={10143} hr={hr}/><button className={p.secondary} onClick={()=>setRetry(n=>n+1)}>{t('Refresh wallet balance','Osvježi stanje novčanika')}</button></section>:null}
 <div className={s.queue}>{data.items.map(item=>{const source=officialSource(item.selection);return <article key={item.id} className={s.reviewCard} aria-label={item.name}>
  {source?<div className={s.media}><img src={source.image} alt="" loading="lazy"/></div>:null}
  <div className={s.body}><div className={s.cardHeading}><div><h2>{item.name}</h2>{source?<p>{source.name}</p>:null}<OfficialSourceLinks selection={item.selection} hr={hr}/></div><div className={s.budget}><small>{t('Planned budget','Planirani fond')}</small><strong title={`${formatUnits(BigInt(item.budgetWei),18)} test MON`}>{setupAmount(BigInt(item.budgetWei),hr)} <small>test MON</small></strong></div></div>
  <ReviewStatusPills id={item.id} revision={item.revision} hr={hr}/>
  <CampaignSponsor id={item.id} hr={hr}/><div className={s.pools}>{item.pools.map(pool=><div key={pool.slot}><Layers size={14}/><span>{officialSource(item.selection,pool.slot)?<a href={officialSource(item.selection,pool.slot)!.eventUrl??officialSource(item.selection,pool.slot)!.leagueUrl} target="_blank" rel="noopener noreferrer">{pool.name}<ExternalLink size={12}/></a>:pool.name}</span><b>{setupAmount(BigInt(pool.budgetWei),hr)} <small>test MON</small></b></div>)}</div>
  <button className={p.primary} onClick={()=>setSelected(item.id)} aria-label={`${t('Review awards','Pregledaj nagrade')}: ${item.name}`}>{t('Review awards','Pregledaj nagrade')}<ArrowRight size={16}/></button></div>
 </article>;})}{!data.items.length?<p className={p.empty}>{t('No sponsor has continued to funding with saved rules yet.','Sponzor još nije nastavio s financiranjem spremljenih pravila.')}</p>:null}</div>
 {requestedCampaign&&!chosen&&!selected?<p role="status">{t('The requested campaign is not available for review.','Odabrana kampanja nije dostupna za pregled.')}</p>:null}</CampaignSponsorRecords>;
}
