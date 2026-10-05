import { usePublicRewardReport } from "../model/usePublicRewardReport";
import { ReportProgrammeCard, ReportPotCards, PublicReportNotice } from "../components/PublicReportSummary";
import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import { useI18n } from "@/shared/i18n/I18nContext";
import styles from "../components/RewardWorkspace.module.css";
import ui from "./RewardCatalogue.module.css";

function useCopy() {
  const { locale } = useI18n();
  return { hr:locale === "hr", n:(v:number) => new Intl.NumberFormat(locale).format(v) };
}
export function RewardsHome() {
  const {hr} = useCopy();
  const [filter,setFilter] = useState("all");
  const report = usePublicRewardReport();
  const published = report.data?.programmes.filter(p => filter === "all" || (p.status === "distributing" ? filter === "active" : filter === "closed")) ?? [];
  return <article className={styles.page}>
    <header className={styles.header}><div><p className={ui.eyebrow}>RacesOn Rewards</p><h1>{hr ? "Nagrade" : "Rewards"}</h1><p>{hr ? "Programi, fondovi i raspodjela nagrada na jednom mjestu." : "Programmes, reward pots and their distribution."}</p></div><Link className={styles.secondaryAction} to="/rewards/pots">{hr ? "Svi fondovi" : "All reward pots"} <ArrowUpRight size={15}/></Link></header>
    <div className={styles.actions}><Link className={styles.primaryAction} to="/rewards/events">{hr?"Odaberi događaj za podršku":"Choose an event to support"}</Link><Link className={styles.secondaryAction} to="/rewards/manage">{hr?"Moji programi":"My programmes"}</Link></div>
    <div className={styles.sectionHeading}><h2>{hr ? "Programi nagrada" : "Reward programmes"}</h2></div>
    <div className={`${styles.segmented} ${ui.filtersGroup}`} aria-label={hr ? "Status programa" : "Programme status"}>{[["all",hr?"Svi":"All"],["active",hr?"Aktivni":"Active"],["planned",hr?"Planirani":"Planned"],["closed",hr?"Završeni":"Completed"]].map(([id,label]) => <button key={id} aria-pressed={filter===id} onClick={()=>setFilter(id)}>{label}</button>)}</div>
    {!report.data ? <PublicReportNotice failed={report.failed} retry={report.retry}/> : published.map(p=><ReportProgrammeCard key={p.id} programme={p} observedAt={report.data!.observedAt}/>)}
    {!published.length && report.data ? <p role="status" className={ui.empty}>{hr ? "Još nema objavljenih programa." : "No published programmes yet."}</p> : null}
    <p className={styles.smallNote}>{hr ? "Planirani programi prikazuju najavljeni proračun. Izvješća raspodjele prikazuju spremljene dodjele i isplate." : "Planned programmes show announced budgets. Distribution reports show saved allocation and payment records."}</p>
  </article>;
}
export function RewardPotsDirectory() {
  const {hr} = useCopy();const [search,setSearch]=useState(""),[kind,setKind]=useState("all");
  const report=usePublicRewardReport();
  const published=report.data?.programmes.map(p=>({programme:p,items:p.pots.filter(pot=>(kind==="all"||(pot.slot===6?"league":"race")===kind)&&`${pot.name} ${p.name}`.toLowerCase().includes(search.toLowerCase()))})).filter(p=>p.items.length)??[];
  return <article className={styles.page}><header className={styles.header}><div><p className={ui.eyebrow}>RacesOn Rewards</p><h1>{hr?"Fondovi nagrada":"Reward pots"}</h1><p>{hr?"Programi i raspodjele":"Programmes and distributions"}</p></div></header>
    <p className={styles.smallNote}>{hr?"Uređujete privatni fond?":"Setting up a private pot?"} <Link to="/rewards/manage">{hr?"Nastavi u Mojim programima":"Continue in My programmes"}</Link></p>
    <div className={ui.filters}><input type="search" aria-label={hr?"Pretraži fondove":"Search pots"} placeholder={hr?"Pretraži fondove…":"Search pots…"} value={search} onChange={e=>setSearch(e.target.value)}/><select aria-label={hr?"Vrsta fonda":"Pot type"} value={kind} onChange={e=>setKind(e.target.value)}><option value="all">{hr?"Sve vrste":"All types"}</option><option value="league">{hr?"Liga":"League"}</option><option value="race">{hr?"Kola":"Rounds"}</option></select></div>
    {!report.data?<PublicReportNotice failed={report.failed} retry={report.retry}/>:null}
    {published.map(p=><section key={p.programme.id}><h2>{p.programme.name}</h2><ReportPotCards programme={p.programme} items={p.items}/></section>)}
    {!published.length&&report.data?<p role="status" className={ui.empty}>{hr?"Nema pronađenih fondova.":"No matching reward pots."}</p>:null}
  </article>;
}
/** Old sample-pot links cannot resurrect retired fixtures. */
export function PublicRewardPot() {
  const {hr}=useCopy();
  return <article className={styles.page}><h1>{hr?"Fond nije pronađen":"Pot not found"}</h1><Link to="/rewards/pots">{hr?"Svi fondovi":"All reward pots"}</Link></article>;
}
