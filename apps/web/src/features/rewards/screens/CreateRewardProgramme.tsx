import { useEffect,useRef,useState } from "react";
import { Link,useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { ApiError } from "@/lib/api";
import { useI18n } from "@/shared/i18n/I18nContext";
import { createDefaultRewardProgrammeDraftV2 } from "@raceson/domain/rewards/programme-draft-v2";
import type { CreateRewardProgramme as Change,RewardProgrammeSource } from "@raceson/domain/rewards/programme-creation";
import { useRewardSessionEpoch } from "../model/useRewardSessionEpoch";
import { programmeSources,createProgramme } from "../data/programmeCreation";
import { draftDistributionGraph } from "../model/distributionExplorer";
import DistributionExplorer from "../components/DistributionExplorer";
import styles from "../components/RewardWorkspace.module.css";
type CreatorOptions={onSelected?:(draftId:string)=>void;initialBudgetMon?:string};
function Creator({onSelected,initialBudgetMon="100000"}:CreatorOptions){
 const {locale}=useI18n(),hr=locale==="hr",navigate=useNavigate();
 const [sources,setSources]=useState<RewardProgrammeSource[]|null>(null),[failed,setFailed]=useState(false),[attempt,setAttempt]=useState(0);
 const [season,setSeason]=useState(""),[budget,setBudget]=useState(initialBudgetMon),[branch,setBranch]=useState("programme");
 const [busy,setBusy]=useState(false),[error,setError]=useState<"unknown"|"exists"|"failed"|null>(null);
 const request=useRef<Change|null>(null),active=useRef(true);
 useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
 useEffect(()=>{let current=true;setFailed(false);setSources(null);void programmeSources().then(value=>{if(current)setSources(value);}).catch(()=>{if(current)setFailed(true);});return()=>{current=false;};},[attempt]);
 // Inline source selection inherits the campaign budget. An uncertain request
 // retains its exact original amount even if the parent draft changes.
 const budgetMon=request.current?.budgetMon??(onSelected?initialBudgetMon:budget);
 const selected=sources?.find(s=>s.seasonId===season),valid=/^[1-9][0-9]{0,6}$/.test(budgetMon)&&Number(budgetMon)<=1000000;
 const graph=valid?draftDistributionGraph({...createDefaultRewardProgrammeDraftV2(),budgetMon},hr):null;
 async function submit(){
  if(busy||!selected||selected.draftId||!valid)return;
  const change=request.current??{draftId:crypto.randomUUID(),seasonId:season,budgetMon};request.current=change;setBusy(true);setError(null);
  try{const record=await createProgramme(change);if(active.current){if(onSelected)onSelected(record.draftId);else navigate(`/rewards/setup?programme=${record.draftId}`,{replace:true});}}
  catch(e){if(!active.current)return;if(e instanceof ApiError&&e.status===409){request.current=null;setError("exists");setAttempt(n=>n+1);}
   else if(e instanceof ApiError&&[400,401,403,404].includes(e.status)){request.current=null;setError("failed");}else setError("unknown");}
  finally{if(active.current)setBusy(false);}
 }
 const locked=busy||error==="unknown";
 return <article className={onSelected?undefined:styles.page}>{!onSelected?<><Link className={styles.textAction} to="/rewards/manage">← {hr?"Moji programi":"My programmes"}</Link>
  <p className="my-4"><Link className={styles.textAction} to="/rewards/setup">{hr?"Postavite vlastite podfondove i kriterije":"Set up custom subpots and criteria"} →</Link></p></>:null}
  {!onSelected?<header className={`${styles.header} my-6`}><div><h2>{onSelected?(hr?"Povežite sezonu":"Connect a season"):(hr?"Novi program nagrada":"New reward programme")}</h2><p>{hr?"Odaberite ligu i početni proračun. Pravila možete urediti u sljedećem koraku.":"Choose a league and starting budget. Adjust the rules in the next step."}</p></div></header>:null}
  {failed?<p role="alert">{hr?"Lige nije moguće učitati.":"Leagues could not be loaded."} <button className="underline" onClick={()=>setAttempt(n=>n+1)}>{hr?"Pokušaj ponovno":"Try again"}</button></p>:sources===null?<p role="status">{hr?"Učitavanje liga…":"Loading leagues…"}</p>:sources.length===0?<section className={styles.ledgerEmpty}><p>{hr?"Nema aktivnih liga na ovom računu.":"No active leagues on this account."}</p><Link className={styles.textAction} to="/organizer/leagues">{hr?"Upravljaj ligama":"Manage leagues"} →</Link></section>:<>
   <div className="my-6 flex flex-wrap items-end gap-6"><label className="flex w-full max-w-md flex-col gap-2 text-sm">{hr?"Liga i sezona":"League and season"}<select className="rounded border bg-transparent p-3" value={season} disabled={locked} onChange={e=>setSeason(e.target.value)}><option value="">{hr?"Odaberite ligu":"Choose a league"}</option>{sources.map(s=><option key={s.seasonId} value={s.seasonId}>{s.organizationName} · {s.seasonName}{s.draftId?(hr?" · već postavljeno":" · already configured"):""}</option>)}</select></label>
   {!onSelected?<label className="flex flex-col gap-2 text-sm">{hr?"Proračun · test MON":"Budget · test MON"}<input className="w-48 rounded border bg-transparent p-3" type="number" min="1" max="1000000" step="1" disabled={locked} value={budget} onChange={e=>setBudget(e.target.value)}/></label>:null}</div>
   {!valid?<p role="alert">{hr?"Unesite cijeli broj od 1 do 1.000.000.":"Enter a whole number from 1 to 1,000,000."}</p>:null}
   {!onSelected?<p className={styles.muted}>{hr?"Pet fondova za kola + jedan fond lige. Početna podjela je 50% za ligu i 10% za svako kolo.":"Five round pots + one league pot. Start with 50% for the league and 10% for each round."}</p>:null}
   <div className="my-6">{selected?.draftId?onSelected?<button className={styles.primaryAction} onClick={()=>onSelected(selected.draftId!)}>{hr?"Odaberi sezonu":"Use this season"}</button>:<Link className={styles.primaryAction} to={`/rewards/setup?programme=${selected.draftId}`}>{hr?"Otvori postojeći program":"Open existing programme"} →</Link>:<button className={styles.primaryAction} disabled={busy||!valid||!selected} onClick={()=>void submit()}>{busy?(hr?"Spremanje…":"Saving…"):error==="unknown"?(hr?"Ponovi stvaranje":"Retry creation"):onSelected?(hr?"Odaberi ligu":"Select league"):(hr?"Kreiraj nacrt programa":"Create programme draft")}</button>}</div>
   {!onSelected?<p className={styles.smallNote}>{hr?"Nacrt je privatan. Spremanje ne financira fondove niti objavljuje nagrade.":"The draft is private. Saving does not fund pots or publish awards."}</p>:null}
   {error?<p role="alert" className="my-4 text-sm">{error==="unknown"?(hr?"Ishod nije potvrđen. Ponovite isti zahtjev ili provjerite Moje programe prije stvaranja novog.":"Creation is not confirmed. Retry the same request or check My programmes before starting again."):error==="exists"?(hr?"Program već postoji. Odaberite ligu za otvaranje programa.":"A programme already exists. Select the league to open it."):(hr?"Program nije kreiran. Provjerite postavke i prijavu.":"Programme was not created. Check settings and sign-in.")}</p>:null}
   {graph&&!onSelected?<DistributionExplorer graph={graph} selected={branch} onSelect={setBranch} status={hr?"Prijedlog početne podjele":"Proposed starting split"}/>:null}
  </>}
 </article>;
}
export default function CreateRewardProgramme({onSelected,initialBudgetMon="100000"}:CreatorOptions={}){
 const auth=useAuth(),epoch=useRewardSessionEpoch(auth.session),{locale}=useI18n(),hr=locale==="hr";
 if(auth.isLoading)return <p role="status">{hr?"Učitavanje…":"Loading…"}</p>;
 if(!auth.user||!auth.session||auth.account?.userId!==auth.user.id)return <section className={styles.page}><h1>{hr?"Novi program nagrada":"New reward programme"}</h1><Link to="/auth?next=%2Frewards%2Fcreate">{hr?"Prijavite se za nastavak":"Sign in to continue"}</Link></section>;
 if(!auth.account.hasOrganizerAccess)return <section className={styles.page}><h1>{hr?"Za organizatore":"For organizers"}</h1><p>{hr?"Za program lige potreban je pristup organizatoru. Možete isprobati vlastiti privatni test.":"A league programme requires organizer access. You can create your own private test."}</p><Link className={styles.textAction} to="/rewards/test">{hr?"Kreiraj testni program":"Create test programme"} →</Link></section>;
 return <Creator onSelected={onSelected} initialBudgetMon={initialBudgetMon} key={`${auth.user.id}:${epoch}`}/>;
}
