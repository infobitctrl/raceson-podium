import type { ReactNode } from "react";
import type { TestProgrammeConfiguration, SavedTestProgramme } from "@raceson/domain/rewards/test-programme";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useI18n } from "@/shared/i18n/I18nContext";
import { Button } from "@/components/ui/button";
import { calculateTestProgramme, createTestProgramme } from "../model/testRewardProgramme";
import { roundedRewardAmount } from "../model/rewardDisplayAmount";
import styles from "../components/RewardWorkspace.module.css";
import ui from "./RewardCatalogue.module.css";

export default function TestRewardProgramme({initial,saved,locked=false,saveDisabled=false,retrySave=false,onSave,notice}: {
  initial?:TestProgrammeConfiguration;saved?:SavedTestProgramme|null;locked?:boolean;saveDisabled?:boolean;retrySave?:boolean;
  onSave?:(configuration:TestProgrammeConfiguration)=>Promise<void>;notice?:ReactNode;
} = {}) {
  const {locale}=useI18n(), hr=locale==="hr";
  const [rounds,setRounds]=useState(initial?.order.length??2),[athletes,setAthletes]=useState(initial?.order[0].length??10),[budget,setBudget]=useState(String(initial?.budgetMon??100)),[rule,setRule]=useState<"rank"|"equal">(initial?.rule??"rank");
  const [order,setOrder]=useState(()=>initial?.order??createTestProgramme(2,10));
  const [approved,setApproved]=useState(initial?.approved??false),[claims,setClaims]=useState<Record<string,"claimed"|"paid">>(initial?.claims??{});
  const [name,setName]=useState(initial?.name??(hr?"Test s dva kola":"Two-round test"));
  const configuration:TestProgrammeConfiguration={name:name.trim(),budgetMon:Number(budget),order,rule,approved,claims};
  const signature=(c:TestProgrammeConfiguration)=>JSON.stringify({...c,claims:Object.fromEntries(Object.entries(c.claims).sort(([a],[b])=>a.localeCompare(b)))});
  const dirty=!saved||signature(configuration)!==signature(saved.configuration);
  const [selectedRound,setSelectedRound]=useState<number|null>(null);
  const valid=Number.isSafeInteger(Number(budget)) && Number(budget)>=1 && Number(budget)<=1000000 && budget.trim()!=="";
  const preview=useMemo(()=>valid?calculateTestProgramme(Number(budget),order,rule):null,[valid,budget,order,rule]);
  const amount=(value:bigint)=>{ if(value===0n)return "0"; const display=roundedRewardAmount(value.toString(),locale);return `${display.approximate?"≈ ":""}${display.text}`; };
  const retire=()=>{setApproved(false);setClaims({});};
  function resize(nextRounds:number,nextAthletes:number){setRounds(nextRounds);setAthletes(nextAthletes);setOrder(createTestProgramme(nextRounds,nextAthletes));setSelectedRound(null);retire();}
  function move(round:number,rank:number,athlete:number){setOrder(previous=>previous.map((row,index)=>{if(index!==round)return row;const next=[...row],old=next.indexOf(athlete);[next[rank],next[old]]=[next[old],next[rank]];return next;}));retire();}
  const paid=preview?.allocations.flat().filter(row=>claims[`${row.round}:${row.athlete}`]==="paid").reduce((sum,row)=>sum+row.amount,0n)??0n;
  return <article className={styles.page}>
    <header className={styles.header}><div><p className={ui.eyebrow}>{hr?"Simulacija · testni sudionici":"Simulation · synthetic participants"}</p><h1>{hr?"Testni program":"Test programme"}</h1><p>{hr?"Isprobajte raspodjelu s testnim rezultatima. Bez novčanika i prijenosa sredstava.":"Try a distribution with synthetic results. No wallets or funds are used."}</p></div><Link className={styles.textAction} to="/rewards/manage">{hr?"Moji programi":"My programmes"} →</Link></header>
    {notice}
    <div className="my-6 flex flex-wrap items-end justify-between gap-4">
      <label className="w-full max-w-md text-sm">{hr?"Naziv programa":"Programme name"}<input className="mt-2 block w-full rounded border bg-transparent p-3" maxLength={100} value={name} disabled={locked} onChange={e=>setName(e.target.value)}/></label>
      {onSave?<div className="flex items-center gap-4"><span className={styles.muted}>{dirty?(hr?"Nespremljene izmjene":"Unsaved changes"):(hr?"Spremljeno na vaš račun":"Saved to your account")}</span><Button disabled={saveDisabled||!valid||!configuration.name||!dirty&&!retrySave} onClick={()=>void onSave(configuration)}>{retrySave?(hr?"Ponovi spremanje":"Retry save"):saved?(hr?"Spremi izmjene":"Save changes"):(hr?"Spremi testni program":"Save test programme")}</Button></div>:null}
    </div>
    <fieldset disabled={locked} className="min-w-0 border-0 p-0"><legend className="sr-only">{hr?"Uređivanje simulacije":"Simulation editor"}</legend>
    <section aria-label={hr?"Postavke testa":"Test settings"} className={ui.filters}>
      <label className="space-y-2 text-xs">{hr?"Broj kola":"Rounds"}<select className="block" value={rounds} onChange={e=>resize(Number(e.target.value),athletes)}>{[1,2,3,4,5].map(n=><option key={n}>{n}</option>)}</select></label>
      <label className="space-y-2 text-xs">{hr?"Sportaša po kolu":"Athletes per round"}<select className="block" value={athletes} onChange={e=>resize(rounds,Number(e.target.value))}>{Array.from({length:19},(_,i)=>i+2).map(n=><option key={n}>{n}</option>)}</select></label>
      <label className="space-y-2 text-xs">{hr?"Ukupni fond · test MON":"Total pot · test MON"}<input className="block w-44" type="number" min="1" max="1000000" step="1" value={budget} onChange={e=>{setBudget(e.target.value);retire();}}/></label>
      <label className="space-y-2 text-xs">{hr?"Raspodjela":"Distribution"}<select className="block" value={rule} onChange={e=>{setRule(e.target.value as "rank"|"equal");retire();}}><option value="rank">{hr?"Prema plasmanu":"By rank"}</option><option value="equal">{hr?"Jednaki udjeli":"Equal shares"}</option></select></label>
    </section>
    <p className={styles.smallNote}>{hr?`Istih ${athletes} sportaša u svakom kolu · jedna kategorija · ${rounds*athletes} nastupa.`:`The same ${athletes} athletes in every round · one category · ${rounds*athletes} race entries.`} {rule==="rank"?(hr?`Ponderi od ${athletes} do 1 prema plasmanu.`:`Rank weights run from ${athletes} for first place to 1 for last.`):null}</p>
    {!valid?<p role="alert" className="py-8">{hr?"Unesite cijeli broj od 1 do 1.000.000 test MON.":"Enter a whole number from 1 to 1,000,000 test MON."}</p>:null}
    {preview?<>
      <dl className={ui.metrics}>{[[hr?"Fond":"Pot",amount(preview.budget)],[hr?"Dodijeljeno":"Awarded",amount(approved?preview.budget:0n)],[hr?"Isplaćeno u simulaciji":"Simulated paid",amount(paid)],[hr?"Čeka isplatu":"Awaiting payment",amount(approved?preview.budget-paid:0n)]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}<small className="ml-2 text-xs">test MON</small></dd></div>)}</dl>
      <section aria-labelledby="test-distribution"><div className={`${styles.sectionHeading} flex-wrap`}><h2 id="test-distribution">{hr?"Raspodjela fonda":"Pot distribution"}</h2><div className="flex flex-wrap items-center gap-3"><span className={ui.pill}>{approved?(hr?"Odobreno u simulaciji":"Approved in simulation"):(hr?"Pregled":"Preview")}</span>{approved?<Button variant="outline" onClick={retire}>{hr?"Uredi simulaciju":"Edit simulation"}</Button>:<Button onClick={()=>setApproved(true)}>{hr?"Odobri testnu raspodjelu":"Approve simulated allocation"}</Button>}</div></div>
        <div className={`${styles.segmented} ${ui.filtersGroup}`}><button aria-pressed={selectedRound===null} onClick={()=>setSelectedRound(null)}>{hr?"Sva kola":"All rounds"}</button>{preview.roundBudgets.map((value,round)=><button key={round} aria-pressed={selectedRound===round} onClick={()=>setSelectedRound(round)}>{hr?"Kolo":"Round"} {round+1} · {amount(value)}</button>)}</div>
        <div className="mt-5 flex h-7 overflow-hidden rounded" role="img" aria-label={hr?"Fond je podijeljen jednako na kola":"Pot split equally between rounds"}>{preview.roundBudgets.map((_,i)=><span key={i} style={{flex:1,background:i%2?"var(--rw-league)":"var(--rw-race)",opacity:selectedRound===null||selectedRound===i?1:.3}}/>)}</div>
        <div className={`${styles.scroll} mt-5`}><table className={`${styles.table} ${ui.table}`}><caption className="sr-only">{hr?"Simulirana raspodjela nagrada":"Simulated reward distribution"}</caption><thead><tr>{[hr?"Sportaš / plasman":"Athlete / rank",hr?"Kolo":"Round",hr?"Nagrada":"Reward",hr?"Dodjela":"Allocation",hr?"Preuzimanje":"Claim",hr?"Isplata":"Payment",hr?"Testna radnja":"Test action"].map(label=><th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>{preview.allocations.flat().filter(row=>selectedRound===null||row.round===selectedRound).map(row=>{
          const key=`${row.round}:${row.athlete}`,state=claims[key];
          return <tr key={key}><td><div className="flex items-center gap-3"><span className={styles.muted}>{row.rank}.</span><select aria-label={`${hr?"Sportaš":"Athlete"}, ${hr?"kolo":"round"} ${row.round+1}, ${hr?"plasman":"rank"} ${row.rank}`} disabled={approved} className="max-w-40 rounded border bg-transparent p-2" value={row.athlete} onChange={e=>move(row.round,row.rank-1,Number(e.target.value))}>{Array.from({length:athletes},(_,id)=><option key={id} value={id}>{hr?"Test sportaš":"Test athlete"} {id+1}</option>)}</select></div></td><td>{row.round+1}</td><td className="tabular-nums" title={`${row.amount} wei`}>{amount(row.amount)}</td><td>{approved?(hr?"Dodijeljeno":"Awarded"):(hr?"Procjena":"Estimate")}</td><td>{!approved?"—":state?(hr?"Zatraženo":"Claim submitted"):(hr?"Nije zatraženo":"Unclaimed")}</td><td>{state==="paid"?(hr?"Isplaćeno (test)":"Paid (test)"):(hr?"Nije poslano":"Not sent")}</td><td>{approved&&state!=="paid"?<button className="text-xs underline underline-offset-4" onClick={()=>setClaims(old=>({...old,[key]:state==="claimed"?"paid":"claimed"}))}>{state==="claimed"?(hr?"Simuliraj isplatu":"Simulate payment"):(hr?"Simuliraj zahtjev":"Simulate claim")}</button>:"—"}</td></tr>;
        })}</tbody></table></div>
      </section>
      <div className="my-6 flex flex-wrap items-center gap-4"><p className={styles.muted}>{hr?"Statusi su testni. Promjena postavki poništava testne zahtjeve i isplate.":"These are test statuses. Changing settings resets simulated claims and payments."}</p></div>
      <details className={styles.disclosure}><summary>{hr?"Ukupno po sportašu":"Totals per athlete"}</summary><div className={styles.scroll}><table className={`${styles.table} ${ui.table}`}><thead><tr><th>{hr?"Sportaš":"Athlete"}</th>{order.map((_,r)=><th key={r}>{hr?"Kolo":"Round"} {r+1}</th>)}<th>{hr?"Ukupno":"Total"}</th></tr></thead><tbody>{preview.totals.map((total,id)=><tr key={id}><th scope="row">{hr?"Test sportaš":"Test athlete"} {id+1}</th>{preview.allocations.map((rows,r)=><td key={r}>{amount(rows.find(row=>row.athlete===id)!.amount)}</td>)}<td>{amount(total)}</td></tr>)}</tbody></table></div></details>
    </>:null}
    </fieldset>
    <details className={styles.disclosure}><summary>{hr?"Napredni testovi postojećeg programa":"Advanced tests for the existing programme"}</summary><Link className={styles.textAction} to="/rewards/rehearsal?stage=five_rounds&cohort=compact_20">{hr?"Otvori scenarij s pet kola":"Open five-round scenario"} →</Link></details>
  </article>;
}
