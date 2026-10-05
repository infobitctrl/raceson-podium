import RewardReviewIssues from './RewardReviewIssues';
import {walletActionLabel} from "../model/walletActionLabel";
import type {ReactNode} from 'react';
import SourceReviewWorkflow from './SourceReviewWorkflow';
import RewardReviewViews from './RewardReviewViews';
import w from './RewardReviewWorkspace.module.css';
import RewardResultsTable from "./RewardResultsTable";
import r from "./RewardResultsTable.module.css";
import SponsorSourceReview from "./SponsorSourceReview";
import {rewardsControlLink} from "../model/controllerLinks";
import {useEffect,useRef,useState} from "react";
import {Link} from "react-router-dom";
import {Check,RefreshCw} from "lucide-react";
import {ApiError} from "@/lib/api";
import {programmeRequest,type SponsorReview,type SponsorUpload,type SponsorLifecycle} from "../data/sponsorProgramme";
import {sendProgrammeTransaction} from "../data/sponsorProgrammeWallet";
import type {DetectedRewardWallet} from "../data/browserWallet";
import SponsorWallet from "./SponsorWallet";
import SponsorClubClaims from "./SponsorClubClaims";
import SponsorClaims from "./SponsorClaims";
import {formatTestMon} from "../model/athleteRewards";
import {setupAmount} from "../model/setupAmount";
import {sponsorResultHold} from "../model/sponsorResultHold";
import s from "./SponsorLaunch.module.css";
export default function SponsorProgramme({setupId,slot,chainId,hr,sourceOnly=false}:{setupId:string;slot:number;chainId:number;hr:boolean;sourceOnly?:boolean}){
 const [opened,setOpened]=useState(sourceOnly),t=(en:string,local:string)=>hr?local:en;
 if(sourceOnly)return <section className={r.reviewFlow}><PotActions key={`${setupId}:${slot}`} {...{setupId,slot,chainId,hr,sourceOnly}}/></section>;
 return <section className={s.card}><span className={s.eyebrow}>{sourceOnly ? t("01 · Source & awards","01 · Izvor i nagrade") : t("03 · Results & payouts","03 · Rezultati i isplate")}</span><h2>{sourceOnly ? t("Review results and awards","Pregledaj rezultate i nagrade") : t("Open the prize pot","Otvori fond nagrada")}</h2>
 <p>{t("Official results → approve awards → open claims","Službeni rezultati → odobri nagrade → otvori preuzimanje")}</p>
 <p>{t("Sponsors fund the pot. The results team approves the awards. Athletes choose their own wallets.","Sponzori financiraju fond. Tim za rezultate odobrava nagrade. Sportaši biraju svoje novčanike.")}</p>
 {!opened?<button className={s.secondary} onClick={()=>setOpened(true)}>{t("Review selected pot · results team","Pregledaj odabrani fond · tim za rezultate")}</button>:<PotActions key={`${setupId}:${slot}`} {...{setupId,slot,chainId,hr,sourceOnly}}/>}
 {!sourceOnly ? <Link className={s.back} to="/athlete/rewards">{t("View my rewards","Moje nagrade")}</Link> : null}</section>;
}
function PotActions({setupId,slot,chainId,hr,sourceOnly=false}:{setupId:string;slot:number;chainId:number;hr:boolean;sourceOnly?:boolean}){
 const [awardsReviewed,setAwardsReviewed]=useState(false);
 const [review,setReview]=useState<SponsorReview|null>(null),[upload,setUpload]=useState<SponsorUpload|null>(null),[life,setLife]=useState<SponsorLifecycle|null>(null);
 const [wallet,setWallet]=useState<{wallet:DetectedRewardWallet;address:string}|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
 const [progress,setProgress]=useState<'prepare'|'handoff'|null>(null);
 const walletRef=useRef(wallet);walletRef.current=wallet;
 const [pending,setPending]=useState<{action:"receipt";requestId:string;transactionHash:string;operation:"upload"|"stage"|"activate";start:number;end:number}|null>(null);
 const mounted=useRef(true),flight=useRef(false),ids=useRef(new Map<string,string>()),t=(en:string,local:string)=>hr?local:en;
 const storage=`raceson:sponsor-lifecycle:${chainId}:${setupId}:${slot}`;
 const requestId=(key:string)=>{if(!ids.current.has(key))ids.current.set(key,crypto.randomUUID());return ids.current.get(key)!;};
 async function load(){setAwardsReviewed(false);setReview(null);setUpload(null);setLife(null);const r=await programmeRequest(setupId,slot,"review") as SponsorReview;if(!mounted.current)return;setReview(r);
  if(r.approval?.decision==="approved"&&r.approval.current){const u=await programmeRequest(setupId,slot,"upload",r.approval.id) as SponsorUpload;if(!mounted.current)return;setUpload(u);
   if(u.prepared){const l=await programmeRequest(setupId,slot,sourceOnly?"handoff":"lifecycle",r.approval.id) as SponsorLifecycle;if(mounted.current)setLife(l);}}
 }
 async function run(task:()=>Promise<void>){if(flight.current)return;flight.current=true;setBusy(true);setError(null);try{await task();}catch(e){if(mounted.current){setLife(null);setError(e instanceof ApiError&&e.code==="reward_review_issue_open"?"issues":e instanceof ApiError&&[403,404].includes(e.status)?"access":e instanceof ApiError&&e.code==="reward_sponsor_source_not_ready"?"source":e instanceof ApiError&&e.code==="reward_sponsor_funding_not_ready"?"funding":e instanceof ApiError&&["reward_final_allocation_source_not_ready","reward_league_publication_not_ready"].includes(e.code??"")?"results":"refresh");}}finally{flight.current=false;if(mounted.current)setBusy(false);}}
 useEffect(()=>{mounted.current=true;try{const p=JSON.parse(sessionStorage.getItem(storage)??"null");if(p?.action==="receipt"&&/^0x[0-9a-f]{64}$/.test(p.transactionHash))setPending(p);}catch{/* Recovery is optional. */}void run(load);return()=>{mounted.current=false;};},[setupId,slot]);
 async function approve(){if(!review||(review.results&&!awardsReviewed))return;await programmeRequest(setupId,slot,"review",undefined,{requestId:requestId(`approve:${review.documentHash}:${review.approval?.id}`),expectedApprovalId:review.approval?.id??null,contextHash:review.contextHash,documentHash:review.documentHash,decision:"approved"});await load();}
 async function prepare(){if(!upload)return;setProgress('prepare');try{await programmeRequest(setupId,slot,"upload",upload.approvalId,{requestId:requestId(`upload:${upload.documentHash}`),contextHash:upload.contextHash,documentHash:upload.documentHash});await load();}finally{if(mounted.current)setProgress(null);}}
 async function bind(){if(!life)return;setProgress('handoff');try{await programmeRequest(setupId,slot,sourceOnly?"handoff":"lifecycle",life.approvalId,{action:"publication",requestId:requestId(`publication:${life.publicationHash}`),documentHash:life.publicationHash});await load();}finally{if(mounted.current)setProgress(null);}}
 async function send(){if(!life?.transaction||!wallet||pending)return;const fresh=await programmeRequest(setupId,slot,"lifecycle",life.approvalId) as SponsorLifecycle;
  if(JSON.stringify(fresh.transaction)!==JSON.stringify(life.transaction))throw Error("changed");
  const tx=life.transaction,hash=await (wallet.wallet.sendProgrammeTransaction ? wallet.wallet.sendProgrammeTransaction(fresh,()=>mounted.current&&walletRef.current===wallet) : sendProgrammeTransaction(wallet.wallet.provider,fresh,()=>mounted.current&&walletRef.current===wallet));
  const p={action:"receipt" as const,requestId:crypto.randomUUID(),transactionHash:hash,operation:tx.action,start:tx.start,end:tx.end};
  try{sessionStorage.setItem(storage,JSON.stringify(p));}catch{/* Keep hash in memory. */}if(mounted.current)setPending(p);
 }
 async function verify(){if(!pending||!review?.approval)return;await programmeRequest(setupId,slot,"lifecycle",review.approval.id,pending);try{sessionStorage.removeItem(storage);}catch{/* Optional recovery. */}setPending(null);await load();}
 const stage=life?.pot?.state??0;
 const approved=review?.approval?.current&&review.approval.decision==="approved";
 const handoffReady=sourceOnly&&life?.current&&!!life.publication&&!error;
 const currentStep=error||handoffReady?null:review?.reasons.length?'review':!approved?'approve':life?.current&&!sourceOnly&&stage===3?'claims':'controller';
 return <><a className={sourceOnly?w.shortcut:undefined} hidden={!sourceOnly} href="#source-review-progress">{t("Distribution progress & next action ↓","Napredak raspodjele i sljedeći korak ↓")}</a><div className={sourceOnly?w.layout:s.main}><div className={sourceOnly?w.evidence:undefined}>
 {!review?.results?<div className={s.actions}><strong>{review?.results ? t("Official results","Službeni rezultati") : review?.sourceReview?.name ?? (slot===0?t("League rewards","Nagrade lige"):`${t("Round","Kolo")} ${slot}`)}</strong><button className={s.secondary} disabled={busy} onClick={()=>void run(load)}><RefreshCw size={15}/>{t("Refresh","Osvježi")}</button></div>:null}
 {error==="results"?<section className={r.waiting} role="status" aria-labelledby={`publication-wait-${slot}`}>
 <span className={s.eyebrow}>{t("Waiting for RacesOn","Čeka se RacesOn")}</span>
 <h2 id={`publication-wait-${slot}`}>{t("Official results are not ready yet","Službeni rezultati još nisu spremni")}</h2>
 <p>{t("The RacesOn results team must confirm the official final publication for this pot.","RacesOn tim za rezultate mora potvrditi službenu konačnu objavu za ovaj fond.")}</p>
 <ol className={r.waitingSteps} aria-label={t("What happens next","Što slijedi")}>
 <li aria-current="step"><strong>{t("Confirm official results","Potvrda službenih rezultata")}</strong><span>{t("RacesOn results team","RacesOn tim za rezultate")}</span></li>
 <li><strong>{t("Review and approve rewards","Pregled i odobrenje nagrada")}</strong><span>{t("Results team or master administrator, then controller","Tim za rezultate ili glavni administrator, zatim kontrolor")}</span></li>
 <li><strong>{t("Open individual claims","Otvaranje pojedinačnih preuzimanja")}</strong><span>{t("Each recipient chooses a wallet and claims","Svaki primatelj bira novčanik i preuzima nagradu")}</span></li>
 </ol>
 <p className={r.note}>{t("Depositing more funds will not make results available. No reward approval or payout is available from this review yet.","Dodatna uplata neće učiniti rezultate dostupnima. Ovaj pregled još ne omogućuje odobrenje nagrada ili isplatu.")}</p>
 </section>:error?<p role="alert">{error==="issues"?t("A reviewer flagged an issue. Check the current flag before approving.","Pregledavatelj je prijavio problem. Provjerite trenutnu prijavu prije odobravanja."):error==="access"?t("Only this event’s results team or a master administrator can approve awards. Sponsoring stays open to everyone.","Samo tim za rezultate ovog događaja ili glavni administrator može odobriti nagrade. Sponzoriranje je otvoreno svima."):error==="source"?t("Official results are not ready for this campaign. Check its saved league, round and category links and the results team’s final review. Depositing funds does not resolve missing result links.","Službeni rezultati nisu spremni za ovu kampanju. Provjerite spremljene poveznice lige, kola i kategorija te konačni pregled tima za rezultate. Uplata ne rješava nedostajuće poveznice rezultata."):error==="funding"?t("The reward deposit has not been confirmed. Finish the sponsor deposit and verify its transaction before opening claims.","Uplata nagrada nije potvrđena. Dovršite sponzorsku uplatu i provjerite transakciju prije otvaranja preuzimanja."):t("Current status could not be verified. Refresh before continuing. Saved transaction hashes remain below.","Trenutno stanje nije potvrđeno. Osvježite prije nastavka. Spremljeni hash transakcije ostaje ispod.")}</p>:null}
 {review?.results?<><div className={r.flowHeader}><h2>{review.results.name}</h2>{!sourceOnly?<ol className={r.steps} aria-label={t("Reward progress","Napredak nagrada")}>{([["review",t("Review results","Pregled rezultata")],["approve",t("Approve rewards","Odobrenje nagrada")],["controller",t("Controller handoff","Predaja kontroloru")],["claims",t("Claims open","Preuzimanje otvoreno")]] as const).map(([key,label])=><li key={key} aria-current={currentStep===key?"step":undefined}>{label}</li>)}</ol>:null}<button className={s.secondary} disabled={busy} onClick={()=>void run(load)}><RefreshCw size={15}/>{t("Refresh","Osvježi")}</button></div>{sourceOnly?<RewardReviewViews data={review.results} budgetWei={review.budgetWei} hr={hr} approved={!!approved}/>:<RewardResultsTable data={review.results} budgetWei={review.budgetWei} hr={hr} approved={!!approved}/>}</>:null}
 </div><ReviewActions sourceOnly={sourceOnly} current={currentStep==='claims'?null:currentStep} loading={busy} handoffReady={!!handoffReady} hr={hr}>
 {sourceOnly&&approved?<section className={r.confirm} aria-label={t('Controller handoff','Predaja kontroloru')}>
 <h2>{handoffReady?t('Handoff recorded','Predaja zabilježena'):t('Controller handoff','Predaja kontroloru')}</h2>
 {handoffReady?<><p>{t('The approved rewards have been handed off. This page confirms the handoff; check Rewards Control for current distribution and claim status.','Odobrene nagrade su predane. Ova stranica potvrđuje predaju; za trenutačno stanje raspodjele i preuzimanja otvorite Rewards Control.')}</p><a className={s.primary} href={rewardsControlLink(setupId,slot)}>{t('Check distribution status','Provjeri stanje raspodjele')}</a></>:<>{busy&&!progress?<p role="status" aria-live="polite">{t('Checking the approved reward package and controller handoff…','Provjera paketa odobrenih nagrada i predaje kontroloru…')}</p>:null}<p>{t('Wallet signing happens in Rewards Control after the handoff is ready.','Potpisivanje novčanikom odvija se u Rewards Control nakon pripreme predaje.')}</p></>}
 </section>:null}
 {progress?<p role="status" aria-live="polite">{progress==='prepare'?t('Preparing the approved rewards and checking funding… No wallet signature is needed on this page.','Pripremamo odobrene nagrade i provjeravamo uplatu… Na ovoj stranici nije potreban potpis novčanika.'):t('Preparing the controller handoff… Wallet signing follows in Rewards Control.','Pripremamo predaju kontroloru… Potpisivanje novčanikom slijedi u Rewards Control.')}</p>:null}
 {review?<>{!review.results?<><dl className={s.facts}><div><dt>{t("Awards","Nagrade")}</dt><dd>{setupAmount(BigInt(review.proposedWei),hr)} test MON</dd></div><div><dt>{t("Recipients","Primatelji")}</dt><dd>{review.recipientCounts.athletes} {t("athletes","sportaša")} · {review.recipientCounts.clubs} {t("clubs","klubova")}</dd></div><div><dt>{t("Reserved remainder","Rezervirani ostatak")}</dt><dd>{setupAmount(BigInt(review.retainedWei),hr)} test MON</dd></div></dl>
 <details className={s.details}><summary>{t("Review individual awards","Pregledaj pojedinačne nagrade")} ({review.recipients.length})</summary><dl className={s.facts}>{review.recipients.map(r=><div key={r.position}><dt className={s.address}>{r.beneficiaryKind=== "athlete"?t("Athlete","Sportaš"):t("Club","Klub")} #{r.position}</dt><dd>{formatTestMon(r.amountWei,hr?"hr":"en")} test MON</dd></div>)}</dl></details>
 </>:null}
 {review.recipientCounts.clubs>0?<p>{t("Club awards stay reserved. Club owners request their rewards in the club portal, using a verified 2-of-3 Safe and explicit consent.","Klupske nagrade ostaju rezervirane. Vlasnici klubova traže nagrade u klupskom portalu uz potvrđeni Safe s dva od tri potpisa i izričit pristanak.")}</p>:null}
 <RewardReviewIssues key={error==='issues'?'issue-conflict':'current'} {...{setupId,slot,hr}} contextHash={review.contextHash} approved={!!approved}>{review.reasons.length?<div role="status" hidden={sourceOnly&&!!review.sourceReview&&review.reasons.every(reason=>reason==="source_held")}><p>{review.reasons.includes("source_held") ? t("Official source review is required before awards can be approved.","Prije odobravanja nagrada potreban je pregled službenog izvora.") : t("Waiting for complete, official results.","Čekamo potpune službene rezultate.")}</p><ul>{[...new Set(review.reasons)].map(reason=><li key={reason}>{sponsorResultHold(reason,hr)}</li>)}</ul></div>:!review.approval?.current||review.approval.decision!=="approved"?<div className={r.confirm}>{review.results?<label><input type="checkbox" checked={awardsReviewed} onChange={e=>setAwardsReviewed(e.target.checked)}/>{t("I have reviewed the proposed rewards.","Pregledao/la sam predložene nagrade.")}</label>:null}<button className={s.primary} disabled={busy||!!review.results&&!awardsReviewed} onClick={()=>void run(approve)}>{t("Approve exact awards","Odobri točne nagrade")}</button><p>{t("Approval saves these exact amounts. It does not send a payment.","Odobrenje sprema ove točne iznose. Ne šalje isplatu.")}</p></div>:<p className={s.success}><Check size={16}/>{t("Awards approved","Nagrade odobrene")}</p>}</RewardReviewIssues>
 {sourceOnly && review.sourceReview && review.reasons.includes("source_held") ? <SponsorSourceReview
   key={`${review.sourceReview.draftId}:${slot}`} draftId={review.sourceReview.draftId} slot={slot} expectedContextHash={review.sourceReview.contextHash} hr={hr} onReviewed={()=>void run(load)}/> : null}
 {upload&&!upload.prepared?<><button className={s.primary} disabled={busy} onClick={()=>void run(prepare)}>{t("Prepare approved rewards","Pripremi odobrene nagrade")}</button>{sourceOnly?<p>{t('This saves the approved reward package. Next, send it to Rewards Control, where the controller signs with their wallet.','Ovo sprema paket odobrenih nagrada. Zatim ga pošaljite u Rewards Control, gdje kontrolor potpisuje svojim novčanikom.')}</p>:null}</>:null}
 {sourceOnly&&upload?.prepared&&life&&!life.publication&&!progress&&!error?<p role="status">{t('Rewards prepared. Send the handoff below, then open Rewards Control for wallet signing.','Nagrade su pripremljene. Pošaljite pripremu u nastavku, a zatim otvorite Rewards Control za potpisivanje novčanikom.')}</p>:null}
 {life&&!life.publication?<button className={s.primary} disabled={busy||!life.current} onClick={()=>void run(bind)}>{t("Send to Rewards Control","Pošalji u Rewards Control")}</button>:null}
 {life?.publication?<p className={s.success}><Check size={16}/>{t("Official publication linked","Službena objava povezana")}</p>:null}
 {stage===3?<p className={s.success}>{t("Claims are open","Preuzimanje nagrada je otvoreno")} · {t("Paid","Isplaćeno")}: {setupAmount(BigInt(life!.pot!.paidWei),hr)} test MON</p>:null}
 {life?.transaction&&!sourceOnly?<><SponsorWallet chainId={chainId} hr={hr} purpose="operator" requiredAddress={life.transaction.from} onWallet={setWallet}/><p>{t("Use the campaign’s designated operator wallet.","Koristite određeni operatorski novčanik kampanje.")}</p><button className={s.primary} disabled={busy||!!pending||wallet?.address!==life.transaction.from} onClick={()=>void run(send)}>{walletActionLabel(life.transaction.action==="upload"?t(`Upload awards ${life.transaction.start+1}–${life.transaction.end}`,`Učitaj nagrade ${life.transaction.start+1}–${life.transaction.end}`):life.transaction.action==="stage"?t("Confirm allocation on chain","Potvrdi raspodjelu na lancu"):t("Open claims","Otvori preuzimanje"),wallet?.wallet)}</button></>:null}
 </>:busy?<p role="status">{t("Checking the selected pot…","Provjera odabranog fonda…")}</p>:null}
 {pending?<div role="status"><p>{t("Transaction sent · confirmation pending","Transakcija poslana · čeka potvrdu")}</p><p className={s.address}>{pending.transactionHash}</p><button disabled={busy} className={s.secondary} onClick={()=>void run(verify)}>{t("Verify transaction","Provjeri transakciju")}</button></div>:null}
 {life?.receipts.length?<details className={r.technical}><summary>{t("Transaction records","Zapisi transakcija")}</summary>{life.receipts.map(receipt=><p key={receipt.id} className={s.address}>{receipt.body.action} · {receipt.body.transactionHash}</p>)}</details>:null}
 {stage===3&&life&&!sourceOnly?<SponsorClubClaims role="operator" approvalId={life.approvalId} hr={hr} chainId={chainId}/>:null}
 {stage===3&&life&&!sourceOnly?<SponsorClaims role="operator" approvalId={life.approvalId} hr={hr} chainId={chainId}/>:null}
 </ReviewActions></div></>;
}

function ReviewActions({sourceOnly,current,loading,handoffReady,hr,children}:{sourceOnly:boolean;current:'review'|'approve'|'controller'|null;loading:boolean;handoffReady:boolean;hr:boolean;children:ReactNode}){
 if(!sourceOnly)return <div>{children}</div>;
 return <aside className={w.sidebar} id="source-review-progress" aria-label={hr?'Napredak raspodjele':'Distribution progress'}><SourceReviewWorkflow current={current} loading={loading} completeThrough={handoffReady?1:-1} hr={hr}>{children}</SourceReviewWorkflow></aside>;
}
