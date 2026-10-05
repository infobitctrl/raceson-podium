import {useI18n} from "@/shared/i18n/I18nContext";
import type {ReactNode} from 'react';
import {Check,ArrowRight} from 'lucide-react';
import type {ControllerAllocation} from '../data/controller';
import {setupAmount} from '../model/setupAmount';
import s from './ControllerWorkflow.module.css';

type Props={allocation:ControllerAllocation|null;ready:boolean;hasApproval:boolean;loading:boolean;checking?:boolean;reviewHref:string;children:ReactNode};
export default function ControllerWorkflow({allocation,ready,hasApproval,loading,checking=false,reviewHref,children}:Props){
 const {locale}=useI18n(),hr=locale==='hr',text=(en:string,cr:string)=>hr?cr:en;
 const verified=!!allocation?.current&&ready;
 const pot=allocation?.pot;
 const active=verified&&pot?.state===3,closed=verified&&pot?.state===4,cancelled=verified&&pot?.state===5;
 const expired=!!(active&&!pot?.paused&&allocation?.observedBlock&&BigInt(pot.claimDeadline)>0n&&BigInt(allocation.observedBlock.timestamp)>=BigInt(pot.claimDeadline));
 const allPaid=!!(verified&&pot&&BigInt(pot.allocatedWei)>0n&&BigInt(pot.paidWei)===BigInt(pot.allocatedWei));
 const finishedStage=active||closed;
 const claimStatus=closed?text("Claims closed","Preuzimanje zatvoreno"):active&&pot?.paused?text("Claims paused","Preuzimanje pauzirano"):allPaid?text("All rewards claimed","Sve nagrade preuzete"):expired?text("Claim window ended","Rok preuzimanja istekao"):text("Claims open","Preuzimanje otvoreno");
 const action=allocation?.transaction?.action;
 const titles=[text("Confirm official results","Potvrdi službene rezultate"),text("Approve & prepare rewards","Odobri i pripremi nagrade"),text("Controller signs","Kontrolor potpisuje"),finishedStage?claimStatus:text("Claims open","Preuzimanje otvoreno")];
 const current=checking||cancelled?-1:finishedStage?4:verified?2:hasApproval?1:0;
 const detail=[
  verified?text("The official source has been confirmed for these rewards.","Službeni izvor potvrđen je za ove nagrade."):text("The results team confirms the official source before approving rewards.","Tim za rezultate potvrđuje službeni izvor prije odobrenja nagrada."),
  verified?text("Exact rewards are approved and the controller handoff is ready.","Točne nagrade su odobrene i predaja kontroloru je spremna."):text("The results team reviews the amounts and prepares this pot for signing.","Tim za rezultate pregledava iznose i priprema ovaj fond za potpisivanje."),
  text("Review the results and rewards, then confirm each required step in your wallet.","Pregledaj rezultate i nagrade, zatim potvrdi svaki potreban korak u novčaniku."),
  finishedStage?(closed||expired?text("The claim window has ended. Paid rewards and unclaimed amounts are shown below.","Rok preuzimanja je istekao. Isplaćene nagrade i nepreuzeti iznosi prikazani su ispod."):pot?.paused?text("Claims are temporarily paused. Existing reward entitlements remain recorded.","Preuzimanje je privremeno pauzirano. Postojeća prava na nagrade ostaju zabilježena."):allPaid?text("All approved rewards have been paid to recipients.","Sve odobrene nagrade isplaćene su primateljima."):text("Athletes and clubs can claim their rewards separately.","Natjecatelji i klubovi zasebno preuzimaju svoje nagrade.")):text("Opens after the controller completes signing and the contract confirms readiness.","Otvara se nakon što kontrolor dovrši potpisivanje i ugovor potvrdi spremnost."),
 ];
 return <section className={s.workflow} aria-label={text("Reward distribution workflow","Tijek raspodjele nagrada")}>
  <h2>{text("From results to claims","Od rezultata do preuzimanja")}</h2>
  {cancelled?<p role="status">{text("This reward pot was cancelled. No new claims or distribution signatures are available.","Ovaj fond nagrada je otkazan. Nova preuzimanja i potpisi raspodjele nisu dostupni.")}</p>:null}
  <ol className={s.steps}>{titles.map((title,index)=>{
   // An approval record alone cannot prove that the source is still current.
   const complete=verified&&index<current,active=index===current;
   return <li key={title} data-state={complete?'complete':active?'current':'upcoming'} aria-current={active?'step':undefined}>
    <span className={s.marker} aria-hidden="true">{complete?<Check size={20}/>:index+1}</span>
    <div className={s.content}>{complete&&index<3?<details className={s.completed}><summary><span className={s.heading}><h3>{title}</h3><span className={s.status}>{text("Complete","Dovršeno")}</span></span><span className={s.owner}>{index<2?text("Results team","Tim za rezultate"):text("Controller","Kontrolor")} · {text('View confirmation','Pogledaj potvrdu')}</span></summary><p>{detail[index]}</p></details>:<><div className={s.heading}><h3>{title}</h3><span className={s.status}>{checking?(loading?text("Checking…","Provjera…"):text("Not verified","Nije provjereno")):complete?text("Complete","Dovršeno"):active?(loading?text("Checking…","Provjera…"):text("Current","Trenutačno")):text("Upcoming","Slijedi")}</span></div><span className={s.owner}>{index<2?text("Results team","Tim za rezultate"):index===2?text("Controller","Kontrolor"):text("Athletes & clubs","Natjecatelji i klubovi")}</span>
     <div className={s.stepDetail}><p>{checking?(loading?text("Waiting for verified campaign status.","Čeka se provjereno stanje kampanje."):text("Refresh the distribution to verify this status.","Osvježi raspodjelu za provjeru ovog stanja.")):detail[index]}</p></div></>}
     {active&&index<2?<a className={s.link} href={reviewHref}>{text('Open results review','Otvori pregled rezultata')} <ArrowRight size={16}/></a>:null}
     {index===2&&verified&&!finishedStage&&!cancelled?<>
      <div className={s.summary}><strong>{setupAmount(BigInt(allocation!.review.allocatedWei),hr)} {hr?"testni MON":"test MON"}</strong> {text('allocated','raspodijeljeno')} <span>·</span> {setupAmount(BigInt(allocation!.review.retainedWei),hr)} {hr?"testni MON":"test MON"} {text('reserved','rezervirano')}</div>
      {children}
      <ol className={s.signing} aria-label={text("Wallet signing steps","Koraci potpisivanja u novčaniku")}>{[text("Upload rewards","Učitaj nagrade"),text("Confirm distribution","Potvrdi raspodjelu"),text("Open claims","Otvori preuzimanje")].map((label,i)=>{
       const position=action==='upload'?0:action==='stage'?1:action==='activate'?2:-1;
       return <li key={label} data-state={position>i?'complete':position===i?'current':'upcoming'} aria-current={position===i?'step':undefined}>{position>i?<Check size={14}/>:null}<span>{label}</span>{i<2?<ArrowRight size={14} aria-hidden="true"/>:null}</li>;
      })}</ol>
      <p className={s.note}>{text("Your wallet confirms each transaction. Opening claims does not send payments.","Tvoj novčanik potvrđuje svaku transakciju. Otvaranje preuzimanja ne šalje isplate.")}</p>
     </>:null}
     {index===3&&finishedStage?<>{claimStatus===text("Claims open","Preuzimanje otvoreno")?<p className={s.open}>{text("Distribution published · claims open","Raspodjela objavljena · preuzimanje otvoreno")}</p>:null}<dl className={s.paymentTotals}><div><dt>{text("Paid to recipients","Isplaćeno primateljima")}</dt><dd>{setupAmount(BigInt(pot!.paidWei),hr)} {hr?"testni MON":"test MON"}</dd></div><div><dt>{text("Unclaimed awards","Nepreuzete nagrade")}</dt><dd>{setupAmount(BigInt(pot!.allocatedWei)-BigInt(pot!.paidWei),hr)} {hr?"testni MON":"test MON"}</dd></div></dl><p className={s.note}>{text("Verified on-chain amounts. Opening claims alone does not make a payment.","Provjereni iznosi na lancu. Samo otvaranje preuzimanja ne izvršava isplatu.")}</p></>:null}
    </div>
   </li>;
  })}</ol>
 </section>;
}
