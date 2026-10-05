import {controllerSelection,rewardsControlLink} from "../model/controllerLinks";
import {useEffect,useState} from "react";
import {useParams,Link,useSearchParams} from "react-router-dom";
import type {PublicSponsorCampaign} from "@raceson/domain/rewards/public-campaign";
import {useAuth} from "@/lib/auth";
import {publicEnv} from "@/lib/public-env";
import {useI18n} from "@/shared/i18n/I18nContext";
import {readPublicCampaign,publicCampaignPath} from "../data/publicCampaign";
import SponsorProgramme from "../components/SponsorProgramme";
import s from "../components/Podium.module.css";
import w from "../components/RewardReviewWorkspace.module.css";

/** Public context improves navigation; only the allocation endpoint authorizes source review. */
export default function SponsorResultsHandoff(){
 const {id=""}=useParams(),[search,setSearch]=useSearchParams(),auth=useAuth(),{locale}=useI18n(),hr=locale==="hr",t=(en:string,local:string)=>hr?local:en;
 const slot=controllerSelection(search.toString()).slot,userId=auth.user?.id;
 const [context,setContext]=useState<PublicSponsorCampaign|null>(null);
 useEffect(()=>{
  const abort=new AbortController();setContext(null);
  if(userId)void readPublicCampaign(id,abort.signal).then(c=>{if(!abort.signal.aborted)setContext(c);}).catch(()=>{/* Unpublished campaigns still use their exact authorized review link. */});
  return()=>abort.abort();
 },[id,userId]);
 // A response for a previous campaign must never supply choices for the current route.
 const campaign=context?.id===id?context:null,pot=campaign?.pots.find(p=>p.slot===slot);
 if(auth.isLoading)return <p role="status">{t('Loading…','Učitavanje…')}</p>;
 if(!auth.user)return <article className={s.page}><h1>{t('Review results & rewards','Pregled rezultata i nagrada')}</h1><p className={s.muted}>{t('Sign in with your results-team or master-administrator account to continue.','Prijavite se računom tima za rezultate ili glavnog administratora za nastavak.')}</p><Link className={s.primary} to={`/auth?next=${encodeURIComponent(`/rewards/manage/campaigns/${id}${search.toString()?`?${search}`:""}`)}`}>{t('Sign in to the platform results workspace','Prijava u radni prostor za rezultate')}</Link></article>;
 return <article className={`${s.page} ${s.workspace}`}>
  <nav className={s.breadcrumb} aria-label={t('Results navigation','Navigacija rezultata')}><Link to="/rewards/review">{t('Award review queue','Red za pregled nagrada')}</Link><span aria-hidden="true">/</span><span>{t('Results review','Pregled rezultata')}</span></nav>
  <header className={s.heading}><div><span className={s.eyebrow}>{t('Reward review','Pregled nagrada')}</span><h1>{campaign?.name??t('Review results & rewards','Pregled rezultata i nagrada')}</h1><p>{t('Official results and exact awards for review.','Službeni rezultati i točne nagrade za pregled.')}</p></div><a href={slot===null?`/rewards/control?campaign=${encodeURIComponent(id)}`:rewardsControlLink(id,slot)} className={s.secondary}>{t('Rewards Control ↗','Rewards Control ↗')}</a></header>

  <section className={w.frame} aria-label={t('Selected prize pot','Odabrani fond nagrada')}>
   {campaign?<div className={s.toolbar}>{campaign.pots.length?<label className={s.sort}>{t('Prize pot','Fond nagrada')}<select value={pot?.slot??""} onChange={e=>setSearch(p=>{const next=new URLSearchParams(p);next.set('pot',e.target.value);return next;},{replace:true})}>{!pot?<option value="" disabled>{t('Choose a prize fund','Odaberite fond nagrada')}</option>:null}{campaign.pots.map(p=><option value={p.slot} key={p.slot}>{p.name}</option>)}</select></label>:null}{campaign?<Link className={s.back} to={`${publicCampaignPath(id)}${slot===null?"":`?pot=${slot}`}`}>{t('Campaign overview','Pregled kampanje')}</Link>:null}</div>:null}
   {slot===null||campaign&&!pot?<p role={search.has("pot")?"alert":"status"}>{!search.has("pot")?t("Choose a prize fund above to review its official results and rewards. If no choices are available, open the exact review link from Rewards Control.","Odaberite fond iznad za pregled službenih rezultata i nagrada. Ako nema dostupnih fondova, otvorite točnu poveznicu iz Rewards Control."):t('This pot is not listed in the verified campaign. Return to Rewards Control to check the selected campaign and pot.','Ovaj fond nije naveden u provjerenoj kampanji. Vratite se u Rewards Control i provjerite odabranu kampanju i fond.')}</p>:<SponsorProgramme key={`${auth.user.id}:${id}:${slot}`} setupId={id} slot={slot} chainId={publicEnv.rewardDemo!.chainId} hr={hr} sourceOnly/>}
  </section>
  <details className={s.howDisclosure}><summary>{t('Review and signing steps','Koraci pregleda i potpisivanja')}</summary><p>{t('First review the official results, then approve the exact rewards. The controller signs the approved distribution. Approval does not pay athletes; each recipient claims their own reward.','Najprije pregledajte službene rezultate, a zatim odobrite točne nagrade. Kontrolor potpisuje odobrenu raspodjelu. Odobrenje ne isplaćuje sportaše; svaki primatelj preuzima svoju nagradu.')}</p></details>
 </article>;
}
