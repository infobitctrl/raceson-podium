import type {SponsorClaim} from '../data/sponsorProgramme';
import RewardReadiness,{type ReadinessStep} from './RewardReadiness';
import s from './RewardRoleWorkspace.module.css';

export default function RewardClaimProgress({view,pending,hr,club=false}:{view:Pick<SponsorClaim,'status'|'current'|'receipt'>;pending:string|null;hr:boolean;club?:boolean}){
 const t=(en:string,local:string)=>hr?local:en;
 const paid=view.status==='paid'&&!!view.receipt;
 // Held/stale claims cannot inherit completion from a previous review.
 const stage=paid?4:!view.current||view.status==='held'?-1:({awaiting_review:0,awaiting_consent:1,awaiting_operator:2,ready_to_pay:3,paid:3})[view.status];
 const titles=[club?t('Treasury reviewed','Riznica provjerena'):t('Recipient readiness','Spremnost primatelja'),club?t('Two owner signatures','Dva potpisa vlasnika'):t('Your consent','Vaš pristanak'),t('Controller approval','Odobrenje kontrolora'),t('Verified payment','Potvrđena isplata')];
 const details=[club?t('Club authority and the exact 2-of-3 Safe are checked.','Provjerava se klupska ovlast i točan Safe s dva od tri potpisa.'):t('Identity and wallet evidence are checked before consent.','Identitet i dokazi novčanika provjeravaju se prije pristanka.'),club?t('Two distinct reviewed owners approve this reward.','Dva različita potvrđena vlasnika odobravaju ovu nagradu.'):t('Review this exact reward and destination before signing.','Pregledajte točnu nagradu i odredište prije potpisa.'),t('The designated controller approves the exact claim.','Određeni kontrolor odobrava točno preuzimanje.'),paid?t('The payment receipt is verified.','Potvrda isplate je provjerena.'):pending?t('Transaction submitted. Receipt verification is still required.','Transakcija je poslana. Potrebna je provjera potvrde.'):t('A signature or submitted hash alone does not confirm payment.','Sam potpis ili poslani hash ne potvrđuje isplatu.')];
 const steps:ReadinessStep[]=titles.map((title,index)=>({id:String(index),title,detail:details[index],state:stage>index?'complete':stage===index?'current':'waiting'}));
 if(!club){
  steps[0]={...steps[0],title:t('Sporting identity reviewed','Sportski identitet provjeren'),detail:t('RacesOn reviews the profile and eligibility for this exact award.','RacesOn provjerava profil i pravo na ovu točnu nagradu.')};
  steps.splice(1,0,{id:'wallet-proof',title:t('Wallet control verified','Kontrola novčanika potvrđena'),detail:t('The saved destination and its signed ownership proof are checked by RacesOn. Connecting a wallet alone is not proof.','RacesOn provjerava spremljeno odredište i potpisani dokaz kontrole. Samo povezivanje novčanika nije dokaz.'),state:stage>0?'complete':'waiting'});
 }
 return <div className={s.claimProgress}><RewardReadiness label={t('Claim readiness','Spremnost preuzimanja')} steps={steps}/>
  {stage<0?<p className={s.reassurance}>{t('Your award remains recorded. Refresh or resolve the review before continuing.','Vaša nagrada ostaje zabilježena. Osvježite ili riješite provjeru prije nastavka.')}</p>:null}
 </div>;
}
