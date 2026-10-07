import type {ReactNode} from 'react';
import {Check, Circle, LoaderCircle} from 'lucide-react';
import type {SponsorAward, SponsorClaim} from '../data/sponsorProgramme';
import {setupAmount} from '../model/setupAmount';
import RewardExplorerLink from './RewardExplorerLink';
import SponsorClaimTerms from './SponsorClaimTerms';
import s from './AthleteClaimReview.module.css';

/** Presentation of existing verified facts. Connecting or checking consent never
 * upgrades readiness, supplies controller authority, or confirms payment. */
export default function AthleteClaimReview({view,award,hr,connected,consent,busy,signing,onConsent,onSign,signLabel,walletControls}:{
 view:SponsorClaim;award?:SponsorAward;hr:boolean;connected:boolean;consent:boolean;busy:boolean;signing:boolean;
 onConsent:(value:boolean)=>void;onSign:()=>void;signLabel:string;walletControls:ReactNode;
}){
 const t=(en:string,local:string)=>hr?local:en;
 const prepared=!!view.claim&&!!view.context&&view.current&&view.status!=='held'&&view.status!=='awaiting_review';
 const rehearsal='rehearsalPolicy' in view&&!!view.rehearsalPolicy;
 const identityVerified=prepared&&!rehearsal;
 const recorded=prepared&&['awaiting_operator','ready_to_pay','paid'].includes(view.status);
 const canConsent=prepared&&view.status==='awaiting_consent'&&!!view.signing;
 const amount=view.receipt?.amountWei??view.claim?.amount??award?.amountWei;
 const reward=award?(award.slot===0?t('League reward','Nagrada lige'):`${t('Round','Kolo')} ${award.slot} · ${t('Sponsored reward','Sponzorirana nagrada')}`):t('Sponsored reward','Sponzorirana nagrada');
 const address=view.receipt?.recipient??view.address;
 const shortAddress=/^0x[0-9a-f]{40}$/i.test(address)?`${address.slice(0,6)}…${address.slice(-4)}`:address;
 const date=view.claim?new Date(Number(view.claim.expiresAt)*1000):null;
 const expiry=date&&Number.isFinite(date.getTime())&&view.chainId===10143
  ?new Intl.DateTimeFormat(hr?'hr-HR':'en-GB',{dateStyle:'medium',timeStyle:'short',timeZone:'Europe/Zagreb'}).format(date)
  :view.claim?`${view.claim.expiresAt} ${t('(Unix seconds)','(Unix sekunde)')}`:null;
 const steps=[
  {id:'identity',done:identityVerified,title:identityVerified?t('Verified sporting identity','Potvrđen sportski identitet'):t('Sporting identity verification','Provjera sportskog identiteta'),detail:identityVerified?t('Matched to your RacesOn profile','Povezano s vašim RacesOn profilom'):rehearsal?t('Demo setup only; the original athlete’s identity is not verified.','Samo demo postavke; identitet izvornog sportaša nije potvrđen.'):t('Verification is required before consent. Your award stays reserved.','Provjera je potrebna prije pristanka. Nagrada ostaje rezervirana.')},
  {id:'wallet',done:canConsent?connected:prepared,title:canConsent?t('Wallet connected','Novčanik povezan'):prepared?t('Reward wallet verified','Novčanik nagrade potvrđen'):t('Saved reward wallet','Spremljeni novčanik nagrade'),detail:canConsent&&!connected?t('Connect the exact wallet saved for this reward.','Povežite točan novčanik spremljen za ovu nagradu.'):shortAddress},
  {id:'control',done:prepared,title:prepared?t('Wallet control verified','Kontrola novčanika potvrđena'):t('Wallet control verification','Provjera kontrole novčanika'),detail:prepared?t('Signature checked','Potpis provjeren'):t('The saved ownership proof must be verified.','Spremljeni dokaz kontrole mora biti provjeren.')},
  {id:'consent',done:recorded||canConsent&&connected&&consent,title:t('Destination & terms reviewed, consent given','Odredište i uvjeti pregledani, pristanak dan'),detail:recorded?t('Your signed consent is recorded','Vaš potpisani pristanak je spremljen'):consent&&connected&&canConsent?t('Ready to sign your consent','Spremno za potpis pristanka'):t('Review where the reward goes and give consent.','Pregledajte odredište nagrade i dajte pristanak.')},
 ];
 return <div className={s.review}>
  {view.status!=='paid'?<ol className={s.checklist} aria-label={t('Claim readiness','Spremnost preuzimanja')}>{steps.map(step=><li key={step.id} data-step={step.id} data-state={step.done?'complete':'waiting'}>
   <span className={s.marker} aria-hidden="true">{step.done?<Check size={14}/>:<Circle size={19}/>}</span><div><strong>{step.title}</strong><p>{step.detail}</p>{step.id==='wallet'&&walletControls?<div className={s.walletControls} data-connected={connected}>{walletControls}</div>:null}</div>
  </li>)}</ol>:null}
  <dl className={s.facts}>
   <div><dt>{t('Reward','Nagrada')}</dt><dd>{reward}</dd></div>
   {amount!==undefined?<div><dt>{t('Amount','Iznos')}</dt><dd className={s.amount}>{setupAmount(BigInt(amount),hr)} <small>test MON</small></dd></div>:null}
   <div><dt>{view.status==='paid'?t('Paid to','Isplaćeno na'):t('Destination','Odredište')}</dt><dd>{view.status==='paid'?t('Reward wallet','Novčanik nagrade'):prepared?t('Your verified wallet','Vaš potvrđeni novčanik'):t('Your saved wallet','Vaš spremljeni novčanik')}<span className={s.address}><RewardExplorerLink chainId={view.chainId} kind="address" value={address}>{shortAddress}</RewardExplorerLink></span></dd></div>
   {expiry?<div><dt title={t('Authorization expires','Ovlaštenje istječe')}>{t('Valid until','Vrijedi do')}</dt><dd className={s.expiry}>{expiry}{view.chainId===10143?' · Zagreb':''}</dd></div>:null}
  </dl>
  {!canConsent?<SponsorClaimTerms view={view} hr={hr}/>:null}
  {canConsent?<><label className={s.consent}><input type="checkbox" checked={consent} disabled={busy||!connected} onChange={event=>onConsent(event.target.checked)}/><span>{t('I consent to receive this reward at the destination above and accept the claim terms.','Pristajem primiti ovu nagradu na gore navedeno odredište i prihvaćam uvjete preuzimanja.')}</span></label>
   <div className={s.actions}><button type="button" className={s.primary} disabled={busy||!connected||!consent} aria-busy={busy&&signing} onClick={onSign}>{busy&&signing?<LoaderCircle size={16} className={s.spinner} aria-hidden="true"/>:null}{busy&&signing?t('Confirming consent…','Potvrđivanje pristanka…'):signLabel}</button><SponsorClaimTerms view={view} hr={hr}/></div>
   <p className={s.note}>{t('This signs consent; the controller submits payment.','Ovo potpisuje pristanak; kontrolor šalje isplatu.')}</p>
  </>:view.status==='awaiting_operator'?<p className={s.notice} role="status">{t('Consent recorded. Waiting for the controller signature and payment submission.','Pristanak spremljen. Čeka se potpis kontrolora i slanje isplate.')}</p>:view.status==='ready_to_pay'?<p className={s.notice} role="status">{t('Both signatures are recorded. Payment still needs to be submitted and confirmed.','Oba potpisa su spremljena. Isplatu još treba poslati i potvrditi.')}</p>:view.status==='held'||!view.current?<p className={s.notice} role="status">{t('This claim needs a fresh verification. Your award stays reserved.','Ovo preuzimanje zahtijeva novu provjeru. Nagrada ostaje rezervirana.')}</p>:view.status==='awaiting_review'?<p className={s.notice} role="status">{t('Recipient setup verification is pending. This does not change the approved reward.','Čeka se provjera postavki primatelja. To ne mijenja odobrenu nagradu.')}</p>:null}
  <p className={s.note}>{t('Your claim is final once the payment transaction is confirmed.','Vaše preuzimanje je konačno nakon potvrde transakcije isplate.')}</p>
 </div>;
}
