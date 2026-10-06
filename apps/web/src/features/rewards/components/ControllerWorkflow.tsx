import {useI18n} from '@/shared/i18n/I18nContext';
import type {ReactNode} from 'react';
import {Check,CheckCircle2,Clock3,ArrowRight} from 'lucide-react';
import type {ControllerAllocation} from '../data/controller';
import {setupAmount} from '../model/setupAmount';
import s from './ControllerHandoff.module.css';

type Props={allocation:ControllerAllocation|null;ready:boolean;hasApproval:boolean;loading:boolean;checking?:boolean;reviewHref:string;children:ReactNode};
export default function ControllerWorkflow({allocation,ready,hasApproval,loading,checking=false,reviewHref,children}:Props){
 const {locale}=useI18n(),hr=locale==='hr',text=(en:string,cr:string)=>hr?cr:en;
 const verified=!!allocation?.current&&ready,pot=allocation?.pot;
 const active=verified&&pot?.state===3,closed=verified&&pot?.state===4,cancelled=verified&&pot?.state===5;
 const expired=!!(active&&!pot?.paused&&allocation?.observedBlock&&BigInt(pot.claimDeadline)>0n&&BigInt(allocation.observedBlock.timestamp)>=BigInt(pot.claimDeadline));
 const allPaid=!!(verified&&pot&&BigInt(pot.allocatedWei)>0n&&BigInt(pot.paidWei)===BigInt(pot.allocatedWei));
 const finished=active||closed;
 const claimStatus=closed?text('Claims closed','Preuzimanje zatvoreno'):active&&pot?.paused?text('Claims paused','Preuzimanje pauzirano'):allPaid?text('All rewards claimed','Sve nagrade preuzete'):expired?text('Claim window ended','Rok preuzimanja istekao'):text('Claims open','Preuzimanje otvoreno');
 const authorizationDone=verified&&!cancelled&&(pot?.state===2||finished);
 const openStep=allocation?.transaction?.action==='activate';
 const amount=allocation?.review?.allocatedWei??pot?.allocatedWei;
 const mon=(wei:string)=>`${setupAmount(BigInt(wei),hr)} ${hr?'testni MON':'test MON'}`;
 return <section className={s.workflow} aria-label={text('Reward distribution workflow','Tijek raspodjele nagrada')}>
  <h2><Clock3 size={23} aria-hidden="true"/>{text('Workflow','Tijek rada')}</h2>
  {cancelled?<p role="status">{text('This reward pot was cancelled. No new claims or distribution signatures are available.','Ovaj fond nagrada je otkazan. Nova preuzimanja i potpisi raspodjele nisu dostupni.')}</p>:<>
   <section className={s.block}>
    <h3>{text('1 · Reviewer decision','1 · Odluka pregledavatelja')}</h3>
    {verified?<p className={s.approved}><CheckCircle2 size={23} aria-hidden="true"/><span>{text('Allocation approved','Raspodjela odobrena')}{amount?<> · <strong>{mon(amount)}</strong></>:null}</span></p>:<><p>{checking?(loading?text('Checking the current approval and official source…','Provjera važećeg odobrenja i službenog izvora…'):text('Refresh the distribution to verify this status.','Osvježi raspodjelu za provjeru ovog stanja.')):hasApproval?text('The results team must confirm the current allocation and prepare the controller handoff.','Tim za rezultate treba potvrditi važeću raspodjelu i pripremiti predaju kontroloru.'):text('Available after the exact allocation is approved.','Dostupno nakon odobrenja točne raspodjele.')}</p>{!checking?<a className={s.link} href={reviewHref}>{text('Open results review','Otvori pregled rezultata')}<ArrowRight size={15}/></a>:null}</>}
   </section>
   <section className={s.block}>
    <h3>{text('2 · Controller: open claims','2 · Kontrolor: otvaranje preuzimanja')}</h3>
    {verified?<>
     <div className={s.step}><span className={authorizationDone?s.done:s.number} aria-hidden="true">{authorizationDone?<Check size={22}/>:1}</span><h4>{text('Authorize the approved handoff','Odobri potvrđenu predaju')}</h4></div>
     {authorizationDone?<p>{text('Distribution confirmed on Monad testnet.','Raspodjela potvrđena na Monad testnetu.')}</p>:<><p>{text('Upload the approved rewards and confirm their distribution. Each transaction requires your wallet confirmation.','Učitaj odobrene nagrade i potvrdi raspodjelu. Svaka transakcija zahtijeva potvrdu u novčaniku.')}</p>{!openStep?children:null}</>}
     <div className={s.step}><span className={finished?s.done:s.number} aria-hidden="true">{finished?<Check size={22}/>:2}</span>{finished?<h4>{claimStatus}</h4>:<h4>{text('Open claims on the contract','Otvori preuzimanje na ugovoru')}</h4>}</div>
     {finished?<><p>{closed||expired?text('The claim window has ended. Paid rewards and unclaimed amounts are shown below.','Rok preuzimanja je istekao. Isplaćene nagrade i nepreuzeti iznosi prikazani su ispod.'):pot?.paused?text('Claims are temporarily paused. Existing reward entitlements remain recorded.','Preuzimanje je privremeno pauzirano. Postojeća prava na nagrade ostaju zabilježena.'):allPaid?text('All approved rewards have been paid to recipients.','Sve odobrene nagrade isplaćene su primateljima.'):text('Recipients can claim their rewards. Opening claims is not payment.','Primatelji mogu preuzeti nagrade. Otvaranje preuzimanja nije isplata.')}</p><dl className={s.totals}><div><dt>{text('Paid to recipients','Isplaćeno primateljima')}</dt><dd>{mon(pot!.paidWei)}</dd></div><div><dt>{text('Unclaimed awards','Nepreuzete nagrade')}</dt><dd>{mon((BigInt(pot!.allocatedWei)-BigInt(pot!.paidWei)).toString())}</dd></div></dl></>:openStep?children:<p>{text('Available after the distribution is confirmed.','Dostupno nakon potvrde raspodjele.')}</p>}
    </>:<p>{text('Available after award approval and funding verification.','Dostupno nakon odobrenja nagrada i provjere uplate.')}</p>}
    {!finished?<p className={s.note}>{text('Opening claims lets recipients claim. Nobody is paid yet.','Otvaranje preuzimanja omogućuje primateljima preuzimanje. Nitko još nije isplaćen.')}</p>:null}
   </section>
  </>}
 </section>;
}
