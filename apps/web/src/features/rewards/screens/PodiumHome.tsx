import {Link} from 'react-router-dom';
import {ArrowRight,CalendarDays,Coins,Flag,Send,Users,Search,SlidersHorizontal} from 'lucide-react';
import {directoryMetrics,campaignSum} from '@raceson/domain/rewards/public-directory';
import {useI18n} from '@/shared/i18n/I18nContext';
import {staticAssetUrl} from '@/lib/static-asset';
import {usePublicDirectory} from '../data/publicDirectory';
import {useSponsorCatalogue} from '../data/copyCatalogue';
import {sponsorLink} from '../model/sponsorOpportunities';
import {setupAmount} from '../model/setupAmount';
import PodiumDirectoryStatus from '../components/PodiumDirectoryStatus';
import PodiumCampaigns from '../components/PodiumCampaigns';
import PodiumPaymentRing from '../components/PodiumPaymentRing';
import hero from '../assets/podium-hero.png';
import s from '../components/Podium.module.css';
export function DirectoryNotice({loading,error,retry}:{loading:boolean;error:boolean;retry:()=>void}){
 const {locale}=useI18n(),hr=locale==='hr';
 return <div className={s.empty} role={error?'alert':'status'}><h3>{error?(hr?'Kampanje trenutačno nisu dostupne':'Campaigns are temporarily unavailable'):(hr?'Provjera kampanja i isplata…':'Checking campaigns and payouts…')}</h3><p>{error?(hr?'Sredstva nisu promijenjena. Pokušajte ponovno.':'Funds are unchanged. Please try again.'):(hr?'Provjeravamo posljednje potvrđeno stanje.':'Reading the latest confirmed status.')}</p>{!loading&&error?<button className={s.secondary} onClick={retry}>{hr?'Pokušaj ponovno':'Try again'}</button>:null}</div>;
}
export default function PodiumHome(){
 const {locale}=useI18n(),hr=locale==='hr',t=(en:string,local:string)=>hr?local:en;
 const {data,isPending,isError,refetch,isFetching}=usePublicDirectory(),metrics=data?directoryMetrics(data):null;
 const {items:sponsorCatalogue,copy,loading:eventsLoading,error:eventsError,retry:retryEvents}=useSponsorCatalogue();
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Zagreb',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const featured=sponsorCatalogue.filter(e=>e.kind==='race').sort((a,b)=>Number(b.date>=today)-Number(a.date>=today)||b.date.localeCompare(a.date)).slice(0,3);
 const paid=data?.items.filter(i=>i.verified&&campaignSum(i.campaign,'paidWei')>0n)??[];
 const sum=(key:'paidWei'|'remainingWei'|'returnedWei')=>paid.reduce((n,i)=>n+campaignSum(i.campaign,key),0n);
 const cards=[{label:t('Active campaigns','Aktivne kampanje'),value:metrics?.active,Icon:Flag},{label:t('Funded pots','Financirani fondovi'),value:metrics?.pots,Icon:Coins},{label:t('Paid to recipients','Isplaćeno primateljima'),value:metrics?setupAmount(BigInt(metrics.paidWei),hr):undefined,unit:true,Icon:Send},{label:t('Sponsors','Sponzori'),value:metrics?.sponsors,Icon:Users}];
 return <article className={s.page}>
 <section className={s.hero}>
  <div className={s.heroCopy}><span className={s.eyebrow}>{t('Sponsor-funded sports rewards','Sportske nagrade uz podršku sponzora')}</span>
   <h1>{t('Sponsor the podium.','Podržite postolje.')}<br/><em>{t('Reward the finish.','Nagradite cilj.')}</em></h1>
   <p>{t('Fund prizes for RacesOn events. Verified athletes and clubs claim the rewards they earn.','Financirajte nagrade na RacesOn događajima. Provjereni sportaši i klubovi preuzimaju zaslužene nagrade.')}</p>
   <div className={s.heroActions}><Link className={s.primary} to="/rewards/events">{t('Sponsor an event','Sponzoriraj događaj')}<ArrowRight size={18}/></Link><Link className={s.secondary} to="/athlete/rewards">{t('Find my rewards','Pronađi moje nagrade')}</Link></div>
  </div>
  <figure className={s.heroMedia}><img src={staticAssetUrl(hero)} alt=""/><figcaption><span>RacesOn Podium</span><strong>{t('Every finish deserves support.','Svaki cilj zaslužuje podršku.')}</strong></figcaption></figure>
 </section>
 <ol className={s.howItWorks} aria-label={t('How rewards work','Kako funkcioniraju nagrade')}>{[
  [Search,t('Discover','Istražite'),t('Pick an existing event','Odaberite postojeći događaj')],
  [SlidersHorizontal,t('Configure','Postavite'),t('Set your budget and rules','Odredite fond i pravila')],
  [Coins,t('Fund','Financirajte'),t('Create the contract and deposit prizes','Izradite ugovor i uplatite nagrade')],
  [Send,t('Review & claim','Provjera i preuzimanje'),t('Results decide. Recipients claim.','Rezultati odlučuju. Primatelji preuzimaju.')],
 ].map(([Icon,title,description],i)=>{const Graphic=Icon as typeof Coins;return <li key={i}><span className={s.howNumber}>0{i+1}</span><div><strong>{String(title)}</strong><p>{String(description)}</p></div><Graphic size={20} aria-hidden="true"/></li>;})}</ol>
 <section className={s.featuredEvents}><div className={s.sectionTitle}><h2>{t('Featured events','Izdvojeni događaji')}</h2><Link to="/rewards/events">{t('All events','Svi događaji')} →</Link></div>{eventsLoading?<p role="status">{t("Loading completed events…","Učitavanje završenih događaja…")}</p>:eventsError?<p role="alert">{t("Events could not be loaded.","Nije moguće učitati događaje.")} <button onClick={()=>void retryEvents()}>{t("Try again","Pokušaj ponovno")}</button></p>:null}<div className={s.grid}>{featured.map(event=><Link className={s.card} key={event.id} to={sponsorLink(event.parent)}><div className={s.photo}><img src={event.image} alt=""/><span className={s.badge}>{event.status==='completed'?t('Completed','Završeno'):event.date>=today?t('Upcoming','Uskoro'):t('Past event','Prošli događaj')}</span></div><div className={s.cardBody}><h3>{event.name}</h3><div className={s.metadata}><span><CalendarDays size={15}/>{new Date(`${event.date}T12:00:00`).toLocaleDateString(hr?'hr-HR':'en-GB',{day:'numeric',month:'short',year:'numeric'})}</span></div><p className={s.muted}>{event.detail}</p><span className={s.eventAction}>{t('Sponsor event','Sponzoriraj događaj')}<ArrowRight size={16}/></span></div></Link>)}</div><p className={s.catalogueNote}>{copy?t('Isolated database · five completed rounds · league closed','Izdvojena baza · pet završenih kola · liga zatvorena'):t('Prepared RacesOn catalogue · 24 Sep 2026','Pripremljeni RacesOn katalog · 24. rujna 2026.')}</p></section>
 <dl className={s.metrics}>{cards.map(({label,value,Icon,unit})=><div className={s.metric} key={label}><Icon size={30}/><div><dt>{label}</dt><dd>{value??'—'}{unit&&value!==undefined?<small> test MON</small>:null}</dd></div></div>)}</dl>
 <PodiumDirectoryStatus data={data} fetching={isFetching} error={isError} onRefresh={()=>void refetch()}/>
 <section className={s.liveCampaigns}><div className={s.sectionTitle}><h2>{t('Live campaigns','Aktivne kampanje')}</h2><Link to="/rewards/campaigns">{t('View all campaigns','Sve kampanje')} →</Link></div>{data?<><PodiumCampaigns items={data.items} compact/>{isError?<p role="alert">{t('Refresh failed. Showing the last checked data.','Osvježavanje nije uspjelo. Prikazani su prethodno provjereni podaci.')}</p>:null}</>:<DirectoryNotice loading={isPending} error={isError} retry={()=>void refetch()}/>}</section>
 <section className={s.history}><div className={s.sectionTitle}><h2>{t('Past distributions','Dosadašnje isplate')}</h2><Link to="/rewards/campaigns?status=finished">{t('Finished campaigns','Završene kampanje')} →</Link></div>{data?<div className={s.historyGrid}><PodiumCampaigns items={data.items} history/>{paid.length?<aside><h3>{t('Campaigns with payouts','Kampanje s isplatama')}</h3>{metrics?(paid.length?<PodiumPaymentRing hr={hr} paid={sum('paidWei')} held={sum('remainingWei')} returned={sum('returnedWei')}/>:<p className={s.muted}>{t('The balance breakdown will appear after the first confirmed recipient payout. Funded prizes remain separate from payments.','Pregled stanja prikazat će se nakon prve potvrđene isplate primatelju. Financirane nagrade nisu isto što i isplate.')}</p>):<p className={s.muted}>{t('Payment totals are unavailable until every campaign is verified.','Ukupne isplate nisu dostupne dok sve kampanje nisu provjerene.')}</p>}</aside>:null}</div>:<p className={s.muted}>{t('Confirmed distribution history will appear once campaign status is available.','Povijest potvrđenih isplata prikazat će se kada stanje kampanja bude dostupno.')}</p>}</section></article>;
}
