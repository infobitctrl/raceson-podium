import CampaignOverview from '../components/CampaignOverview';
import {useEffect,useRef,useState} from 'react';
import {Link} from 'react-router-dom';
import {ApiError} from '@/lib/api';
import {previewRewardSetup} from '@raceson/domain/rewards/distribution-setup';
import {hostedSponsorLaunch} from '../data/hostedSponsorLaunch';
import SponsorFunding,{type SponsorFundingSummary} from '../components/SponsorFunding';
import HostedAllocationPreview from './HostedAllocationPreview';
import {setupAmount} from '../model/setupAmount';
import d from '../components/SponsorDashboard.module.css';
import s from '../components/SponsorLaunch.module.css';
/** This freezes a source-bound rules revision only. GET/mount cannot create a
 * contract, grant a wallet role, deposit prizes or approve an allocation. */
export default function HostedSponsorExecution({id,hr}:{id:string;hr:boolean}){
 const [data,setData]=useState<Awaited<ReturnType<typeof hostedSponsorLaunch>>|null>(null),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
 const [summary,setSummary]=useState<SponsorFundingSummary|null>(null),request=useRef(crypto.randomUUID());
 const t=(en:string,local:string)=>hr?local:en;
 useEffect(()=>{
  let current=true;setData(null);setError('');
  void(async()=>{
   let value=await hostedSponsorLaunch(id);
   if(!current)return;
   if(!value.view.launch)value=await hostedSponsorLaunch(id,{requestId:request.current,expectedRevision:value.view.setup.revision});
   if(current)setData(value);
  })().catch(e=>{if(current)setError(e instanceof ApiError&&[401,403,404,409].includes(e.status)?e.code??'access':'load');});
  return()=>{current=false;};
 },[id,attempt]);
 if(error)return <article className={d.page}><h1>{t('Campaign funding','Financiranje kampanje')}</h1><p role="alert">{t('The saved rules and source could not be verified. Reopen the campaign before continuing.','Spremljena pravila i izvor nisu potvrđeni. Ponovno otvorite kampanju prije nastavka.')}</p><button className={s.secondary} onClick={()=>setAttempt(n=>n+1)}>{t('Retry','Pokušaj ponovno')}</button> <Link to="/rewards/manage">{t('My campaigns','Moje kampanje')}</Link></article>;
 if(!data?.view.launch||!data.binding)return <p className={d.page} role="status">{t('Checking saved rules…','Provjera spremljenih pravila…')}</p>;
 const launch=data.view.launch,c=launch.setup.configuration,preview=previewRewardSetup(c);
 const fresh=summary?.launchId===launch.id?summary:null,observation=fresh?.view?.observation,plan=fresh?.view?.record?.plan;
 const deposited=observation?.funded===true&&plan?BigInt(plan.budgetWei):0n;
 return <article className={d.page}>
  <header className={d.header}><div><span className={d.eyebrow}>{t('My campaigns','Moje kampanje')}</span><h1>{c.name}</h1><p className={d.intro}>{t(`Saved · revision ${launch.setup.revision}`,`Spremljeno · revizija ${launch.setup.revision}`)}</p></div><div className={d.headerActions}><span className={d.badge}>{observation?.funded?t('Funded','Financirano'):t('Awaiting funding','Čeka uplatu')}</span><Link className={d.publicLink} to={`/rewards/create?setup=${id}`}>{t('View rules','Pogledaj pravila')}</Link><button className={d.publicLink} disabled title={t('Available after the campaign is published','Dostupno nakon objave kampanje')}>{t('Public page','Javna stranica')}</button></div></header>
  <CampaignOverview id={id} selection={c.sponsorSelection} hr={hr}/>
  {data.view.setup.revision!==launch.setup.revision?<p role="status">{t(`Funding retains the frozen rules at revision ${launch.setup.revision}. Later edits cannot change this contract.`,`Financiranje zadržava zaključana pravila revizije ${launch.setup.revision}. Kasnije izmjene ne mijenjaju ovaj ugovor.`)}</p>:null}
  <div className={d.layout}><div className={d.main}><SponsorFunding launch={launch} copyBinding={data.binding} hr={hr} onSummary={setSummary}
   allocation={<><section className={d.card}><h2>{t('Where the prize pool goes','Raspodjela nagradnog fonda')}</h2><dl className={d.legend}>{c.root.children.filter(n=>n.shareBps>0).map(n=><div key={n.id}><dt>{n.name}</dt><dd>{setupAmount(preview.rows.find(r=>r.id===n.id)?.amountWei??null,hr)} <small className={d.unit}>test MON</small></dd><dd className={d.percent}>{n.shareBps/100}%</dd></div>)}</dl></section><details className={`${d.card} ${d.preview}`}><summary>{t('Allocation preview','Pregled raspodjele')}</summary><HostedAllocationPreview id={id} revision={launch.setup.revision}/></details></>}/></div>
   <aside className={d.aside}><section className={d.card}><h2>{t('Money','Sredstva')}</h2><dl className={d.money}>
    <div><dt>{t('Total campaign budget','Ukupni proračun kampanje')}</dt><dd><strong>{setupAmount(plan?BigInt(plan.budgetWei):preview.budgetWei,hr)}</strong> <small className={d.unit}>test MON</small></dd></div>
    <div><dt>{t('Selected prize pool','Odabrani nagradni fond')}</dt><dd><strong>{setupAmount(plan?BigInt(plan.budgetWei):preview.budgetWei,hr)}</strong> <small className={d.unit}>test MON</small></dd></div>
    <div><dt>{t('Deposited prize funds','Uplaćene nagrade')}</dt><dd><strong>{setupAmount(deposited,hr)}</strong> <small className={d.unit}>test MON</small></dd></div>
    <div><dt>{t('Your wallet balance','Stanje vašeg novčanika')}</dt><dd>{fresh?.balanceWei!==null&&fresh?.balanceWei!==undefined?`${setupAmount(BigInt(fresh.balanceWei),hr)} test MON`:fresh?.walletConnected?t('Connected','Povezan'):t('Not connected','Nije povezan')}</dd></div>
    <div><dt>{t('Platform gas reserve','Rezerva za plin platforme')}</dt><dd className={d.gas}>{t('RacesOn pays creation gas','RacesOn plaća plin za izradu')}<br/>{t('not part of your budget','nije dio vašeg proračuna')}</dd></div>
   </dl></section><section className={`${d.card} ${d.terms}`}><h2>{t('Terms','Uvjeti')}</h2><p>{t('Claim window','Rok preuzimanja')}: <strong>{c.policy?.claimWindowDays} {t('days','dana')}</strong></p><p>{t('Unused funds','Neiskorištena sredstva')}: <strong>{c.policy?.treasuryReturn==='original_sender'?t('Back to the sponsor wallet','Povrat u novčanik sponzora'):t('RacesOn treasury','RacesOn riznica')}</strong></p></section></aside>
  </div>
 </article>;
}
