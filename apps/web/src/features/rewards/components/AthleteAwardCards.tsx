import {useEffect} from 'react';
import {Check, Circle, Clock3} from 'lucide-react';
import type {SponsorAward} from '../data/sponsorProgramme';
import type {RewardDestination} from '../model/athleteDestinations';
import {setupAmount} from '../model/setupAmount';
import AthleteProfileWallet from './AthleteProfileWallet';
import RewardActionProgress from './RewardActionProgress';
import s from './AthleteRewards.module.css';

import {awardDisplay} from '../model/awardDisplay';
const scope=(a:SponsorAward,hr:boolean)=>[awardDisplay(a,hr).title,awardDisplay(a,hr).subtitle].filter(Boolean).join(' · ');
export default function AthleteAwardCards({awards,destinations,chainId,hr,busy,failed,onReview,onClaim,onRefresh}:{
 awards:SponsorAward[];destinations:RewardDestination[];chainId:number;hr:boolean;busy:boolean;failed:boolean;
 onReview:(award:SponsorAward)=>void;onClaim:(id:string)=>void;onRefresh:()=>void;
}){
 const t=(en:string,local:string)=>hr?local:en;
 const paid=awards.filter(a=>a.claims.some(c=>c.paid));
 return <>
  <section aria-labelledby="athlete-awards-title"><div className={s.sectionHeading}><h2 id="athlete-awards-title">{t('Awards','Nagrade')}</h2><button disabled={busy} className={s.secondary} onClick={onRefresh}>{t('Refresh claims','Osvježi preuzimanja')}</button></div>
   {failed?<p role="alert">{t('The request could not be saved or verified. Refresh before continuing.','Zahtjev nije moguće spremiti ili provjeriti. Osvježite prije nastavka.')}</p>:null}
   {!awards.length?<div className={s.empty}><h3>{t('Your next reward starts with an official result','Vaša sljedeća nagrada počinje službenim rezultatom')}</h3><p>{t('Published awards linked to your sporting profile will appear here, even before you have a wallet.','Objavljene nagrade povezane sa sportskim profilom pojavit će se ovdje, čak i prije postavljanja novčanika.')}</p></div>:null}
   <ul className={s.awards}>{awards.map(a=>{
    const isPaid=a.claims.some(c=>c.paid),prepared=a.claims.some(c=>c.prepared),consented=a.claims.some(c=>c.consented),approved=a.claims.some(c=>c.approved);
    const wallet=destinations.some(d=>d.athleteProfileId===a.athleteProfileId&&d.chainId===chainId&&d.status==='pending_review');
    const status=isPaid?t('Claimed','Preuzeto'):consented?t('Processing','U obradi'):prepared?t('Ready for review','Spremno za pregled'):!wallet?t('Wallet needed','Potreban novčanik'):t('Awaiting review','Čeka provjeru');
    return <li key={a.entitlementId} className={s.award}><div className={s.awardTop}><div><h3>{awardDisplay(a,hr).title}</h3>{awardDisplay(a,hr).subtitle?<p className={s.scope}>{awardDisplay(a,hr).subtitle}</p>:null}<p className={s.reference}>{t('Award reference','Referenca nagrade')} <code>{a.entitlementId.slice(0,10)}…{a.entitlementId.slice(-6)}</code></p><p>{isPaid?t('Paid. Open the verified receipt.','Isplaćeno. Otvorite potvrđenu isplatu.'):consented?(approved?t('Controller approval recorded. Open the claim to check payment.','Odobrenje kontrolora je spremljeno. Otvorite preuzimanje za provjeru isplate.'):t('Your consent is recorded. Waiting for controller approval.','Vaš pristanak je spremljen. Čeka se odobrenje kontrolora.')):prepared?t('Review the exact destination and terms before giving consent.','Pregledajte točno odredište i uvjete prije pristanka.'):t('Your award stays reserved while you complete the remaining steps.','Nagrada ostaje rezervirana dok dovršavate preostale korake.')}</p></div>
     <div className={s.awardAction}><strong>{setupAmount(BigInt(a.amountWei),hr)} <small>test MON</small></strong><span className={s.badge} data-state={isPaid?'paid':prepared?'ready':'held'}>{status}</span>
      {!isPaid?<button className={s.primary} disabled={busy} onClick={()=>onReview(a)}>{t('Review reward','Pregledaj nagradu')}</button>:null}
      {a.claims.map(c=><button className={s.secondary} disabled={busy} key={c.id} onClick={()=>onClaim(c.id)}>{c.paid?t('View receipt','Pregledaj potvrdu'):t('Continue claim','Nastavi preuzimanje')}</button>)}
     </div></div>
     <ol className={s.paymentProgress} aria-label={t('Payment progress','Napredak isplate')}>{[
      {title:t('Award published','Nagrada objavljena'),detail:t('Allocation recorded','Dodjela zabilježena'),done:true},
      {title:t('Claim readiness','Spremnost preuzimanja'),detail:consented?t('Consent recorded','Pristanak spremljen'):t('Review remaining steps','Pregledaj preostale korake'),done:isPaid},
      {title:t('Reward paid','Nagrada isplaćena'),detail:t('Receipt verified','Potvrda provjerena'),done:isPaid},
     ].map((step,index)=><li key={step.title} aria-label={`${step.done?t("Complete","Dovršeno"):index===1?t("Current step","Trenutni korak"):t("Not yet confirmed","Još nije potvrđeno")}: ${step.title}. ${step.detail}`} data-state={step.done?'complete':index===1?'current':'waiting'}><span aria-hidden="true">{step.done?<Check size={16}/>:index===1?<Clock3 size={16}/>:<Circle size={16}/>}</span><div><strong>{step.title}</strong><small>{step.detail}</small></div></li>)}</ol>
    </li>;
   })}</ul>
  </section>
  <section aria-labelledby="athlete-history-title"><h2 id="athlete-history-title">{t('Claim history','Povijest preuzimanja')}</h2>{paid.length?<div className={s.history}><table><caption>{t('Your confirmed reward payments','Vaše potvrđene isplate nagrada')}</caption><thead><tr><th>{t('Reward','Nagrada')}</th><th>{t('Amount','Iznos')}</th><th>{t('Status','Stanje')}</th><th>{t('Receipt','Potvrda')}</th></tr></thead><tbody>{paid.map(a=><tr key={a.entitlementId}><td>{scope(a,hr)}<code>{a.entitlementId.slice(0,10)}…{a.entitlementId.slice(-6)}</code></td><td>{setupAmount(BigInt(a.amountWei),hr)} test MON</td><td><span className={s.badge} data-state="paid">{t('Confirmed','Potvrđeno')}</span></td><td><button className={s.secondary} disabled={busy} onClick={()=>onClaim(a.claims.find(c=>c.paid)!.id)}>{t('View receipt','Pregledaj potvrdu')}</button></td></tr>)}</tbody></table></div>:<p className={s.historyEmpty}>{t('Confirmed payments will appear here after receipt verification.','Potvrđene isplate pojavit će se ovdje nakon provjere potvrde.')}</p>}</section>
 </>;
}

export function AthleteAwardReview({award,hr,chainId,destinations,complete,busy,failed,refresh,onRecover,onRequest,onBusy}:{award:SponsorAward;hr:boolean;chainId:number;destinations:RewardDestination[];complete:boolean;busy:boolean;failed:boolean;refresh:()=>Promise<void>;onRecover:()=>void;onRequest:(id:string)=>void;onBusy?:(busy:boolean)=>void}){
 const t=(en:string,local:string)=>hr?local:en;
 useEffect(()=>{onBusy?.(busy);},[busy,onBusy]);
 const matching=destinations.filter(d=>d.athleteProfileId===award.athleteProfileId&&d.chainId===chainId&&d.status==='pending_review');
 return <section className={s.review}>
  <p>{scope(award,hr)} · {t('Sponsored reward','Sponzorirana nagrada')}</p>
  <dl className={s.reviewFacts}><div><dt>{t('Amount','Iznos')}</dt><dd>{setupAmount(BigInt(award.amountWei),hr)} <small>test MON</small></dd></div><div><dt>{t('Network','Mreža')}</dt><dd>{chainId===31337?'Local simulation · 31337':'Monad testnet · 10143'}</dd></div></dl>
  <p>{t('Your share stays reserved. Choose a wallet, then review the exact claim and give consent after readiness approval.','Vaš udio ostaje rezerviran. Odaberite novčanik, zatim pregledajte točno preuzimanje i dajte pristanak nakon provjere spremnosti.')}</p>
  {failed?<div role="alert"><p>{t('The request could not be verified. Refresh your rewards and try again.','Zahtjev nije potvrđen. Osvježite nagrade i pokušajte ponovno.')}</p><button className={s.secondary} disabled={busy} onClick={onRecover}>{t('Refresh status','Osvježi stanje')}</button></div>:null}
  {busy?<RewardActionProgress label={t('Reward request progress','Napredak zahtjeva')} labels={[t('Saving request','Spremanje zahtjeva'),t('Request recorded','Zahtjev spremljen')]} stage={0} message={t('Saving this reward and destination. This does not give payment consent.','Spremanje nagrade i odredišta. Ovo nije pristanak na isplatu.')}/>:null}
  {matching.length?matching.map(d=><div className={s.destination} key={d.requestId}><p>{t('Reward destination','Odredište nagrade')} <code>{d.address}</code></p><button disabled={busy||failed||!complete} className={s.primary} onClick={()=>onRequest(d.requestId)}>{busy?t('Saving request…','Spremanje zahtjeva…'):t('Request reward to this wallet','Zatraži nagradu na ovaj novčanik')}</button></div>):award.athleteProfileId?<AthleteProfileWallet idPrefix="claim-wallet" presentation="athlete" ready={!busy} failed={failed} profiles={[award.athleteProfileId]} profileId={award.athleteProfileId} onProfile={()=>{}} destinations={destinations} complete={complete} refreshing={busy} onRefresh={refresh} onMore={()=>{}}/>:null}
  {award.claims.length?<p className={s.note}>{t('An existing request is available under Continue claim on the award card. Creating another request does not replace recorded consent.','Postojeći zahtjev dostupan je pod Nastavi preuzimanje na kartici nagrade. Novi zahtjev ne zamjenjuje zabilježen pristanak.')}</p>:null}
 </section>;
}
