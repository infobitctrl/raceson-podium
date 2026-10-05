import {useEffect,useState} from 'react';
import {Link,useParams} from 'react-router-dom';
import {Check,RefreshCw} from 'lucide-react';
import {useAuth} from '@/lib/auth';
import {publicEnv} from '@/lib/public-env';
import HostedSponsorExecution from './HostedSponsorExecution';
import {useI18n} from '@/shared/i18n/I18nContext';
import {ApiError} from '@/lib/api';
import {previewRewardSetup,setupId} from '@raceson/domain/rewards/distribution-setup';
import {useRewardSessionEpoch} from '../model/useRewardSessionEpoch';
import {useSponsorCatalogue} from '../data/copyCatalogue';
import {readHostedSponsorCampaign} from '../data/hostedSponsorCampaign';
import {sponsorTrackRows} from '../model/sponsorTrackAllocation';
import {setupAmount} from '../model/setupAmount';
import SponsorWallet from '../components/SponsorWallet';
import SponsorWalletBalance from '../components/SponsorWalletBalance';
import type {DetectedRewardWallet} from '../data/browserWallet';
import HostedAllocationPreview from './HostedAllocationPreview';
import d from '../components/SponsorDashboard.module.css';
import s from '../components/SponsorLaunch.module.css';

export default function HostedSponsorFunding(){
 const {id=''}=useParams(),auth=useAuth(),{locale}=useI18n(),hr=locale==='hr';
 const epoch=useRewardSessionEpoch(auth.session);
 if(auth.isLoading)return <p className={d.page} role="status">{hr?'Učitavanje…':'Loading…'}</p>;
 if(!auth.user||!auth.session||auth.account?.userId!==auth.user.id)return <article className={d.page}><h1>{hr?'Financiranje kampanje':'Campaign funding'}</h1><p>{hr?'Prijavite se računom kojim ste spremili kampanju.':'Sign in with the account that saved this campaign.'}</p><Link className={s.primary} to={`/auth?next=${encodeURIComponent(`/rewards/campaigns/${id}`)}`}>{hr?'Prijava':'Sign in'}</Link></article>;
 if(!setupId(id))return <article className={d.page}><h1>{hr?'Kampanja nije pronađena':'Campaign not found'}</h1><Link to="/rewards/manage">{hr?'Moje kampanje':'My campaigns'}</Link></article>;
 return publicEnv.hostedOperations?<HostedSponsorExecution key={`${auth.user.id}:${epoch}:${id}`} id={id} hr={hr}/>:<Workspace key={`${auth.user.id}:${epoch}:${id}`} id={id} hr={hr}/>;
}

function Workspace({id,hr}:{id:string;hr:boolean}){
 const {copy,loading,error:catalogueError,retry}=useSponsorCatalogue();
 const [data,setData]=useState<Awaited<ReturnType<typeof readHostedSponsorCampaign>>|null>(null),[error,setError]=useState<'access'|'missing'|'load'|null>(null),[attempt,setAttempt]=useState(0);
 const [wallet,setWallet]=useState<{wallet:DetectedRewardWallet;address:string}|null>(null);
 const t=(en:string,local:string)=>hr?local:en;
 useEffect(()=>{
  let current=true;setData(null);setError(null);
  void readHostedSponsorCampaign(id).then(value=>{if(current)setData(value);}).catch(e=>{if(current)setError(e instanceof ApiError&&[401,403].includes(e.status)?'access':e instanceof ApiError&&e.status===404?'missing':'load');});
  return()=>{current=false;};
 },[id,attempt]);
 if(error||catalogueError)return <article className={d.page}><h1>{t('Campaign funding','Financiranje kampanje')}</h1><p role="alert">{error==='access'?t('Use the sponsor account that saved this campaign.','Koristite račun sponzora kojim je kampanja spremljena.'):error==='missing'?t('Campaign not found.','Kampanja nije pronađena.'):t('The saved campaign could not be loaded. Try again.','Spremljena kampanja nije učitana. Pokušajte ponovno.')}</p>{error==='access'?<Link className={s.primary} to={`/auth?next=${encodeURIComponent(`/rewards/campaigns/${id}`)}`}>{t('Sign in','Prijava')}</Link>:error!=='missing'?<button className={s.secondary} onClick={()=>{setAttempt(n=>n+1);if(catalogueError)void retry();}}>{t('Retry','Pokušaj ponovno')}</button>:null} <Link to="/rewards/manage">{t('My campaigns','Moje kampanje')}</Link></article>;
 if(!data||!copy||loading)return <p className={d.page} role="status">{t('Loading saved campaign…','Učitavanje spremljene kampanje…')}</p>;
 const record=data.record,c=record.configuration,preview=previewRewardSetup(c),round=copy.rounds.find(r=>r.eventEditionId===c.sponsorSelection?.eventEditionId);
 const categories=[...copy.categories].sort((a,b)=>a.competitionId.localeCompare(b.competitionId)||a.id.localeCompare(b.id));
 const pots=c.root.children.filter(p=>p.shareBps>0);
 const rows=pots.flatMap(p=>{
  const slot=c.guided?.pots.find(g=>g.nodeId===p.id)?.slot;
  if(!round||slot!==round.slot)return [{id:p.id,name:slot===0?copy.name:copy.rounds.find(r=>r.slot===slot)?.name??p.name,shareBps:p.shareBps,amountWei:preview.rows.find(r=>r.id===p.id)?.amountWei??null}];
  const tracks=round.tracks.map(track=>({id:track.raceId,name:track.name,categoryIds:[],nodeIds:p.children.filter((_n,i)=>categories[i]?.competitionId===track.competitionId).map(n=>n.id)}));
  const trackRows=sponsorTrackRows(p,tracks),tracked=new Set(trackRows.flatMap(r=>r.nodes.map(n=>n.id)));
  return [...trackRows.filter(r=>r.shareBps>0).map(r=>({id:r.id,name:r.name,shareBps:r.shareBps,amountWei:r.nodes.reduce((sum,n)=>sum+(preview.rows.find(r=>r.id===n.id)?.amountWei??0n),0n)})),...p.children.filter(n=>n.shareBps>0&&!tracked.has(n.id)).map(n=>({id:n.id,name:n.name,shareBps:n.shareBps,amountWei:preview.rows.find(r=>r.id===n.id)?.amountWei??null}))];
 });
 const colors=['#f56617','#201c19','#a89884','#dccfb9','#586e62'];
 const current=wallet?1:0,labels=[t('Funding wallet connected','Novčanik za uplatu povezan'),t('Reward contract created','Ugovor nagrada izrađen'),t('Prize deposit confirmed','Uplata nagrada potvrđena')];
 const edit=`/rewards/create?setup=${id}`,budget=setupAmount(preview.budgetWei,hr);
 return <article className={d.page}>
  <header className={d.header}><div><span className={d.eyebrow}>{t('My campaigns','Moje kampanje')}</span><h1>{c.name}</h1><p className={d.intro}>{t(`Saved · revision ${record.revision}`,`Spremljeno · revizija ${record.revision}`)}</p></div><div className={d.headerActions}><span className={d.badge}>{t('Awaiting funding','Čeka uplatu')}</span><Link className={d.publicLink} to={edit}>{t('Edit rules','Uredi pravila')}</Link><button className={d.publicLink} disabled title={t('Available after the campaign is published','Dostupno nakon objave kampanje')}>{t('Public page','Javna stranica')}</button></div></header>
  <div className={d.layout}><div className={d.main}>
   <section className={`${d.card} ${d.current}`} aria-label={t('Current task','Trenutačni zadatak')}>
    <span className={d.eyebrow}>{t('Current task','Trenutačni zadatak')}</span>
    <ol className={d.milestones} aria-label={t('Funding progress','Napredak financiranja')}>{labels.map((label,i)=><li key={label} aria-current={current===i?'step':undefined} data-complete={i===0&&!!wallet}><span>{i===0&&wallet?<Check size={16} aria-label={t('Complete','Dovršeno')}/>:i+1}</span>{label}</li>)}</ol>
    <div className={d.task}>
     <h2>{wallet?t('Create your reward contract','Izradite ugovor nagrada'):t('Connect your funding wallet','Povežite novčanik za uplatu')}</h2>
     <p className={d.intro}>{wallet?t('RacesOn pays creation gas. Your prize deposit is a separate step.','RacesOn plaća plin za izradu. Vaša uplata nagrada je odvojen korak.'):t('Connect the wallet you will use to deposit your prizes.','Povežite novčanik kojim ćete uplatiti nagrade.')}</p>
     <SponsorWallet compact chainId={record.chainId} hr={hr} onWallet={setWallet}/>
     <p className={d.readiness} role="status">{t('Contract creation is awaiting hosted testnet setup. Your rules are saved; no prize deposit can be sent yet.','Izrada ugovora čeka postavljanje testneta na ovoj stranici. Pravila su spremljena; uplata nagrada još nije dostupna.')}</p>
     {wallet?<button className={s.primary} disabled>{t('Create reward contract','Izradi ugovor nagrada')}</button>:null}
    </div>
    <button className={s.textButton} onClick={()=>setAttempt(n=>n+1)}><RefreshCw size={14}/>{t('Refresh campaign','Osvježi kampanju')}</button>
   </section>
   <section className={d.card} aria-label={t('Campaign distribution','Raspodjela kampanje')}><h2>{t('Where the prize pool goes','Raspodjela nagradnog fonda')}</h2><div className={d.bar} aria-hidden="true">{rows.map((r,i)=><span key={r.id} style={{width:`${r.shareBps/100}%`,background:colors[i%colors.length]}}/>)}</div><dl className={d.legend}>{rows.map((r,i)=><div key={r.id}><dt><i className={d.dot} style={{background:colors[i%colors.length]}}/>{r.name}</dt><dd>{setupAmount(r.amountWei,hr)} <small className={d.unit}>test MON</small></dd><dd className={d.percent}>{r.shareBps/100}%</dd></div>)}</dl></section>
   <details className={`${d.card} ${d.preview}`}><summary>{t('Allocation preview','Pregled raspodjele')}</summary><HostedAllocationPreview key={`${id}:${record.revision}`} id={id} revision={record.revision}/></details>
  </div><aside className={d.aside}>
   <section className={d.card} aria-label={t('Money','Sredstva')}><h2>{t('Money','Sredstva')}</h2><dl className={d.money}>
    <div><dt>{t('Total campaign budget','Ukupni proračun kampanje')}</dt><dd><strong>{budget}</strong> <small className={d.unit}>test MON</small></dd></div>
    <div><dt>{t('Selected prize pool','Odabrani nagradni fond')}</dt><dd><strong>{budget}</strong> <small className={d.unit}>test MON</small></dd></div>
    <div><dt>{t('Deposited prize funds','Uplaćene nagrade')}</dt><dd><strong>{setupAmount(BigInt(data.fundedWei),hr)}</strong> <small className={d.unit}>test MON</small></dd></div>
    <div><dt>{t('Your wallet balance','Stanje vašeg novčanika')}</dt><dd>{wallet?t('Connected','Povezan'):t('Not connected','Nije povezan')}</dd></div>
    <div><dt>{t('Platform gas reserve','Rezerva za plin platforme')}</dt><dd className={d.gas}>{t('RacesOn pays creation gas','RacesOn plaća plin za izradu')}<br/>{t('not part of your budget','nije dio vašeg proračuna')}</dd></div>
   </dl>{wallet?<SponsorWalletBalance provider={wallet.wallet.provider} address={wallet.address} chainId={record.chainId} hr={hr}/>:null}</section>
   <section className={`${d.card} ${d.terms}`}><h2>{t('Terms','Uvjeti')}</h2><p>{t('Claim window','Rok preuzimanja')}: <strong>{c.policy?.claimWindowDays} {t('days','dana')}</strong></p><p>{t('Unused funds','Neiskorištena sredstva')}: <strong>{c.policy?.treasuryReturn==='original_sender'?t('Back to the sponsor wallet','Povrat u novčanik sponzora'):t('RacesOn treasury','RacesOn riznica')}</strong></p></section>
  </aside></div>
 </article>;
}
