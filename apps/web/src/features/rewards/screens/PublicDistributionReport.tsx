import { useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { publicRewardPool, publicRewardTotals, type PublicRewardPot as Pot, type PublicRewardProgramme as Programme, type PublicRewardRow as Row } from "@raceson/domain/rewards/public-report";
import { useI18n } from "@/shared/i18n/I18nContext";
import { usePublicRewardReport } from "../model/usePublicRewardReport";
import { PublicReportNotice, ReportAmount, ReportDate } from "../components/PublicReportSummary";
import ui from "./RewardCatalogue.module.css";
import styles from "../components/RewardWorkspace.module.css";

import PublicAllocationTable from "../components/PublicAllocationTable";
import PublicPrizeCharts from "../components/PublicPrizeCharts";
import DistributionExplorer from "../components/DistributionExplorer";
import { reportDistributionGraph } from "../model/distributionExplorer";

const receiptUrl=(hash:string)=>`https://testnet.monadvision.com/tx/${hash}`;
function Receipt({hash}: {hash:string}) { const {locale}=useI18n(); return <a className={styles.textAction} href={receiptUrl(hash)} target="_blank" rel="noreferrer">{locale==="hr"?"Potvrda ↗":"Receipt ↗"}</a>; }
function Distribution({programme,pot,poolLabel}: {programme:Programme;pot:Pot|undefined;poolLabel?:string}) {
  const {locale}=useI18n(),hr=locale==="hr",[search,setSearch]=useState(""),[kind,setKind]=useState("all"),[payment,setPayment]=useState("all");
  const [summarySort,setSummarySort]=useState({key:"name",descending:false});
  const matches=(r:Row)=>r.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())&&(kind==="all"||r.kind===kind)&&(payment==="all"|| (payment==="paid"?r.payment==="paid":r.payment!=="paid"));
  const rows=pot?.rows.filter(matches);
  const recipients=[...new Map(programme.pots.flatMap(p=>p.rows).map(r=>[r.recipientId,r])).values()].filter(r=>r.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())&&(kind==="all"||r.kind===kind));
  const summaryValue=(r:Row,key:string)=>{
    if(key==="name")return r.name;
    const awards=programme.pots.flatMap(p=>p.rows.filter(a=>a.recipientId===r.recipientId&&(key==="total"||key==="paid"||key===p.id)));
    return awards.reduce((n,a)=>n+(key!=="paid"||a.payment==="paid"?BigInt(a.amountWei):0n),0n);
  };
  recipients.sort((a,b)=>{const x=summaryValue(a,summarySort.key),y=summaryValue(b,summarySort.key);return (typeof x==="string"&&typeof y==="string"?x.localeCompare(y,locale,{numeric:true}):x<y?-1:x>y?1:0)*(summarySort.descending?-1:1);});
  const summaryHeader=(key:string,label:string)=><th scope="col" key={key} aria-sort={summarySort.key===key?(summarySort.descending?"descending":"ascending"):"none"}><button className={ui.sortHeader} onClick={()=>setSummarySort({key,descending:summarySort.key===key?!summarySort.descending:false})}>{label}<span aria-hidden="true">{summarySort.key===key?(summarySort.descending?"↓":"↑"):"↕"}</span></button>{key!=="name"&&key!=="total"&&key!=="paid"?<Link className="block text-xs" aria-label={`${label} · ${hr?"Otvori fond":"Open pot"}`} to={`/rewards/programmes/${programme.id}/pots/${key}`}>↗</Link>:null}</th>;
  return <section>
    {poolLabel?<header className={ui.splitHeading}><h2>{poolLabel}</h2><p>{hr?"Odobrene nagrade iz ovog dijela fonda. Zahtjev i isplata odnose se na objedinjenu nagradu primatelja iz cijelog fonda.":"Approved awards from this split. Claim and payment statuses refer to each recipient’s combined pot award."}</p></header>:null}
    <div className={ui.filters}><input type="search" aria-label={hr?"Pretraži primatelje":"Search recipients"} placeholder={hr?"Ime sportaša ili kluba…":"Athlete or club name…"} value={search} onChange={e=>setSearch(e.target.value)}/>
      <select aria-label={hr?"Vrsta primatelja":"Recipient type"} value={kind} onChange={e=>setKind(e.target.value)}><option value="all">{hr?"Svi primatelji":"All recipients"}</option><option value="athlete">{hr?"Sportaši":"Athletes"}</option><option value="club">{hr?"Klubovi":"Clubs"}</option></select>
      {pot?<select aria-label={hr?"Status isplate":"Payment status"} value={payment} onChange={e=>setPayment(e.target.value)}><option value="all">{hr?"Sve isplate":"All payments"}</option><option value="paid">{hr?"Isplaćeno":"Paid"}</option><option value="unpaid">{hr?"Čeka isplatu":"Awaiting payment"}</option></select>:null}
    </div>
    <div className={styles.scroll} tabIndex={0} role="region" aria-label={hr?"Tablica raspodjele":"Distribution table"}><table className={`${styles.table} ${ui.table}`}>
      <caption className={ui.tableCaption}>{poolLabel??(pot?(hr?"Raspodjela fonda":"Pot distribution"):(hr?"Nagrade po primatelju i fondu":"Rewards by recipient and pot"))} · test MON</caption>
      <thead><tr>{pot?<th scope="col">{hr?"Primatelj":"Recipient"}</th>:summaryHeader("name",hr?"Primatelj":"Recipient")}{pot?<>{[hr?"Iznos":"Amount",hr?"Dodjela":"Allocation",hr?"Preuzimanje":"Claim",hr?"Isplata":"Payment",hr?"Potvrda":"Receipt"].map(s=><th key={s} scope="col">{s}</th>)}</>:<>{programme.pots.map(p=>summaryHeader(p.id,p.name))}{summaryHeader("total",hr?"Ukupno":"Total")}{summaryHeader("paid",hr?"Isplaćeno":"Paid")}</>}</tr></thead>
      <tbody>{pot?rows!.map(r=><tr key={r.recipientId}><th scope="row">{r.name}</th><td><ReportAmount value={r.amountWei}/>{poolLabel?<span className={ui.awardBar} aria-hidden="true"><span style={{width:`${BigInt(pot.budgetWei)?Number(BigInt(r.amountWei)*10000n/BigInt(pot.budgetWei))/100:0}%`}}/></span>:null}</td><td>{hr?"Dodijeljeno":"Awarded"}</td><td>{r.claim==="submitted"?(hr?"Zahtjev predan":"Claim submitted"):(hr?"Nije zatraženo":"Not claimed")}</td><td><span className={r.payment==="paid"?ui.paid:ui.pending}>{r.payment==="paid"?(hr?"Isplaćeno":"Paid"):r.payment==="processing"?(hr?"U obradi":"Processing"):(hr?"Čeka isplatu":"Awaiting payment")}</span></td><td>{r.transactionHash?<Receipt hash={r.transactionHash}/>:"—"}</td></tr>)
        :recipients.map(r=>{
          const awards=programme.pots.map(p=>p.rows.find(a=>a.recipientId===r.recipientId));
          const total=awards.reduce((n,a)=>n+BigInt(a?.amountWei??0),0n),paid=awards.reduce((n,a)=>n+(a?.payment==="paid"?BigInt(a.amountWei):0n),0n);
          return <tr key={r.recipientId}><th scope="row">{r.name}</th>{awards.map((a,i)=><td key={programme.pots[i].id}>{a?<ReportAmount value={a.amountWei}/>:"—"}</td>)}<td className={ui.total}><ReportAmount value={total}/></td><td><ReportAmount value={paid}/></td></tr>;
        })}</tbody>
      {!(pot?rows!.length:recipients.length)?<tfoot><tr><td colSpan={pot?6:programme.pots.length+3} className={ui.empty}>{hr?"Nema pronađenih primatelja.":"No matching recipients."}</td></tr></tfoot>:null}
    </table></div>
    <p className={styles.smallNote}>{hr?"Iznosi su zaokruženi na četiri decimale. Nedodijeljeni proračun ostaje izvan nagrada primatelja.":"Amounts are rounded to four decimals. Unallocated budget is separate from recipients’ awards."}</p>
    {pot?<details className={styles.disclosure}><summary>{hr?"Što znače statusi?":"What do the statuses mean?"}</summary><p className={styles.ruleSummary}>{hr?"Dodijeljeno znači da je iznos odobren. Zahtjev predan znači da je zabilježen potpis primatelja. Isplaćeno znači da postoji potvrda prijenosa. Statusi prikazuju stanje na datum izvješća.":"Awarded means the amount was approved. Claim submitted means recipient consent was recorded. Paid requires a confirmed transfer receipt. Statuses reflect the report date."}</p></details>:null}
  </section>;
}
function InteractiveDistribution({programme,pot}:{programme:Programme;pot?:Pot}) {
  const {locale}=useI18n(),hr=locale==="hr",[search,setSearch]=useSearchParams();
  const graph=useMemo(()=>reportDistributionGraph(programme,hr,pot?.id),[programme,hr,pot?.id]);
  const requested=search.getAll("branch"),selected=requested.length===1&&graph.byId.has(requested[0])?requested[0]:graph.rootId;
  const node=graph.byId.get(selected)!,pots=programme.pots.filter(p=>node.potIds.includes(p.id));
  const selectedPot=pots.length===1?pots[0]:undefined;
  const pool=node.poolKey&&selectedPot?publicRewardPool(selectedPot,node.poolKey):undefined;
  const totals=publicRewardTotals(pool?[pool]:pots);
  function select(id:string){const next=new URLSearchParams(search);if(id===graph.rootId)next.delete("branch");else next.set("branch",id);setSearch(next,{replace:true});}
  return <>
    <DistributionExplorer graph={graph} selected={selected} onSelect={select} branchDetails={selectedPot?.pools.some(p=>p.categories)?<PublicPrizeCharts pot={selectedPot} poolKey={node.poolKey}/>:undefined} status={hr?"Odobrena podjela proračuna":"Approved budget split"}>
      {node.pool&&!pool?<p className="my-4 text-sm text-muted-foreground">{hr?"Prikazan je proračun ove grane. Nagrade i statusi u tablici odnose se na cijeli odabrani fond.":"This is the branch budget. The table shows combined awards and statuses for the selected pot."}</p>:<dl>
        {[[hr?"Dodijeljeno":"Allocated",totals.allocated],[hr?"Isplaćeno":"Paid",totals.paid],[hr?"Čeka isplatu":"Awaiting payment",totals.unpaid],[hr?"Nedodijeljeno":"Unallocated",totals.unallocated]].map(([label,value])=><div key={String(label)}><dt>{String(label)}</dt><dd><ReportAmount value={value}/></dd></div>)}
        <div><dt>{hr?"Primatelji":"Recipients"}</dt><dd>{totals.athletes+totals.clubs}</dd></div>
      </dl>}
      {selectedPot&&!pot?<Link className={styles.textAction} to={`/rewards/programmes/${programme.id}/pots/${selectedPot.id}${pool?`?branch=${encodeURIComponent(node.id)}`:""}`}>{hr?"Otvori fond":"Open pot"} →</Link>:null}
    </DistributionExplorer>
    {pots.every(p=>p.pools.every(f=>f.categories))?<PublicAllocationTable key={selected} programme={{...programme,pots}} poolKey={node.poolKey} title={selectedPot?`${selectedPot.name}${pool?` · ${node.label}`:""}`:undefined}/>:<Distribution key={selected} programme={{...programme,pots}} pot={pool??selectedPot} poolLabel={pool?`${selectedPot!.name} · ${node.label}`:undefined}/>}
    {!selectedPot&&pots.every(p=>p.pools.every(f=>f.categories))?<details className={styles.disclosure}><summary>{hr?"Ukupno po primatelju i fondu":"Totals by recipient and pot"}</summary><Distribution programme={{...programme,pots}} pot={undefined}/></details>:null}
  </>;
}
function Rules({pots}: {pots:Pot[]}) {
  const {locale}=useI18n(),hr=locale==="hr";
  const names:Record<string,string>={athlete_standings:hr?"Plasman sportaša":"Athlete standings",club_standings:hr?"Plasman klubova":"Club standings",participation:hr?"Prijeđena udaljenost":"Distance participation"};
  return <section><h2>{hr?"Odobrena podjela proračuna":"Approved budget split"}</h2><div className={ui.grid}>{pots.map(p=><section className={ui.card} key={p.id}><h3>{p.name}</h3>{p.pools.map(pool=><div className={ui.pool} key={pool.key}><span>{names[pool.key]}</span><b><ReportAmount value={pool.budgetWei}/></b></div>)}</section>)}</div><p className={styles.smallNote}>{hr?"Neiskorišteni plasmani ostaju nedodijeljeni. Dodijeljena nagrada čuva se i kada primatelj još nema novčanik.":"Unused rank slots remain unallocated. An awarded share is retained when its recipient has no wallet."}</p></section>;
}
function History({pots}: {pots:Pot[]}) {
  const {locale}=useI18n(),hr=locale==="hr";
  const events=pots.flatMap(p=>[{id:`approval-${p.id}`,time:p.approvedAt,name:p.name,hash:null as string|null,recipient:null as string|null},...p.rows.filter(r=>r.paidAt).map(r=>({id:r.transactionHash!,time:r.paidAt!,name:p.name,hash:r.transactionHash,recipient:r.name}))]).sort((a,b)=>b.time.localeCompare(a.time));
  return <ol className={ui.history}>{events.map(e=><li key={e.id}><div><strong>{e.recipient?`${e.recipient} · ${hr?"isplaćeno":"paid"}`:`${e.name} · ${hr?"raspodjela odobrena":"allocation approved"}`}</strong><p>{e.recipient?`${e.name} · `:""}<ReportDate value={e.time}/></p></div>{e.hash?<Receipt hash={e.hash}/>:null}</li>)}</ol>;
}
export default function PublicDistributionReport() {
  const {programmeId,potId}=useParams(),{locale}=useI18n(),hr=locale==="hr",{data,failed,retry}=usePublicRewardReport();
  const [tab,setTab]=useState("distribution");
  if(!data)return <article className={styles.page}><h1>{hr?"Raspodjela nagrada":"Reward distribution"}</h1><PublicReportNotice failed={failed} retry={retry}/></article>;
  const programme=data.programmes.find(p=>p.id===programmeId),pot=programme?.pots.find(p=>p.id===potId);
  if(!programme || potId && !pot)return <article className={styles.page}><h1>{hr?"Izvješće nije pronađeno":"Report not found"}</h1><Link to="/rewards">{hr?"Svi programi":"All programmes"}</Link></article>;
  const pots=pot?[pot]:programme.pots,totals=publicRewardTotals(pots);
  return <article className={`${styles.page} ${ui.distributionPage}`}>
    <Link className={styles.textAction} to={pot?`/rewards/programmes/${programme.id}`:"/rewards"}>← {pot?programme.name:(hr?"Svi programi":"All programmes")}</Link>
    <header className={`${styles.header} mt-6`}><div><span className={ui.pill}>{hr?"Testna raspodjela":"Test distribution"}</span><h1>{pot?.name??programme.name}</h1><p>{programme.host} · {hr?"Sintetički sudionici":"Synthetic participants"}</p></div></header>
    <dl className={ui.compactStats}>{[[hr?"Sportaši / klubovi":"Athletes / clubs",`${totals.athletes} / ${totals.clubs}`],[hr?"Dodijeljeno":"Allocated",<ReportAmount value={totals.allocated}/>],[hr?"Isplaćeno":"Paid",<ReportAmount value={totals.paid}/>]].map(([label,value])=><div key={String(label)}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    <p className={styles.smallNote}>{hr?"Spremljeno izvješće · stanje na":"Saved report · records as of"} <ReportDate value={data.observedAt}/></p>
    <div className={ui.tabs} aria-label={hr?"Detalji izvješća":"Report details"}>{[["distribution",hr?"Raspodjela":"Distribution"],["rules",hr?"Pravila":"Rules"],["history",hr?"Povijest":"History"]].map(([key,label])=><button key={key} aria-pressed={tab===key} onClick={()=>setTab(key)}>{label}</button>)}</div>
    {tab==="distribution"?<InteractiveDistribution key={pot?.id??programme.id} programme={programme} pot={pot}/>:tab==="rules"?<Rules pots={pots}/>:<History pots={pots}/>}
  </article>;
}
