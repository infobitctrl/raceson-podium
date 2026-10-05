import { Link } from "react-router-dom";
import { formatUnits } from "viem";
import { publicRewardTotals, type PublicRewardPot, type PublicRewardProgramme } from "@raceson/domain/rewards/public-report";
import { useI18n } from "@/shared/i18n/I18nContext";
import ui from "../screens/RewardCatalogue.module.css";
import styles from "./RewardWorkspace.module.css";

function reportAmount(value: bigint | string, locale: string) {
  return new Intl.NumberFormat(locale, {maximumFractionDigits:4}).format(Number(formatUnits(BigInt(value),18)));
}
export function ReportAmount({value}: {value: bigint | string}) {
  const {locale}=useI18n(); return <span title={`${formatUnits(BigInt(value),18)} test MON`}>{reportAmount(value,locale)}</span>;
}
export function ReportDate({value}: {value:string}) {
  const {locale}=useI18n(); return <time dateTime={value}>{new Intl.DateTimeFormat(locale === "hr" ? "hr-HR":"en-GB", {dateStyle:"medium",timeStyle:"short"}).format(new Date(value))}</time>;
}
export function ReportMetrics({pots}: {pots:PublicRewardPot[]}) {
  const {locale}=useI18n(),hr=locale === "hr",t=publicRewardTotals(pots);
  return <><dl className={ui.metrics}>
    <div><dt>{hr?"Sportaši / klubovi":"Athletes / clubs"}</dt><dd>{t.athletes} <small>/ {t.clubs}</small></dd></div>
    <div><dt>{hr?"Dodijeljeno":"Allocated"}</dt><dd><ReportAmount value={t.allocated}/></dd></div>
    <div><dt>{hr?"Isplaćeno":"Paid"}</dt><dd><ReportAmount value={t.paid}/></dd></div>
    <div><dt>{hr?"Čeka isplatu":"Awaiting payment"}</dt><dd><ReportAmount value={t.unpaid}/></dd></div>
  </dl><div className={ui.paymentBar} aria-hidden="true">{[t.paid,t.unpaid,t.unallocated].map((n,i)=><span key={i} style={{width:`${t.budget ? Number(n*10000n/t.budget)/100:0}%`}}/>)}</div>
  <div className={ui.barLegend}><span>{hr?"Isplaćeno":"Paid"} <ReportAmount value={t.paid}/></span><span>{hr?"Čeka isplatu":"Awaiting payment"} <ReportAmount value={t.unpaid}/></span><span>{hr?"Nedodijeljeni proračun":"Unallocated budget"} <ReportAmount value={t.unallocated}/></span></div></>;
}
export function ReportProgrammeCard({programme:p,observedAt}: {programme:PublicRewardProgramme;observedAt:string}) {
  const {locale}=useI18n(),hr=locale==="hr",t=publicRewardTotals(p.pots);
  return <section className={ui.reportHero}>
    <div className={styles.header}><div><span className={ui.pill}>{hr?"Testna raspodjela":"Test distribution"}</span><h2>{p.name}</h2><p className={styles.muted}>{p.host} · {p.pots.length} {hr?"fondova":"pots"}</p></div><div><strong className={ui.reportBudget}><ReportAmount value={t.budget}/></strong><p className={styles.muted}>test MON · {hr?"proračun programa":"programme budget"}</p></div></div>
    <ReportMetrics pots={p.pots}/>
    <div className={ui.reportFooter}><Link className={styles.secondaryAction} to={`/rewards/programmes/${p.id}`}>{hr?"Pogledaj raspodjelu":"View distribution"} ↗</Link><small>{hr?"Stanje na":"Records as of"} <ReportDate value={observedAt}/></small></div>
  </section>;
}
export function ReportPotCards({programme:p,items=p.pots}: {programme:PublicRewardProgramme;items?:PublicRewardPot[]}) {
  const {locale}=useI18n(),hr=locale==="hr";
  return <div className={ui.grid}>{items.map(pot=>{
    const t=publicRewardTotals([pot]);
    return <Link className={ui.card} key={pot.id} to={`/rewards/programmes/${p.id}/pots/${pot.id}`}>
      <span className={ui.pill}>{hr?"Dodijeljeno":"Awarded"}</span><h2>{pot.name}</h2><small>{p.name}</small>
      <strong><ReportAmount value={pot.budgetWei}/></strong><small>test MON · {hr?"proračun fonda":"pot budget"}</small>
      <dl className={ui.cardMetrics}><div><dt>{hr?"Primatelji":"Recipients"}</dt><dd>{pot.rows.length}</dd></div><div><dt>{hr?"Isplaćeno":"Paid"}</dt><dd><ReportAmount value={t.paid}/></dd></div><div><dt>{hr?"Čeka isplatu":"Awaiting payment"}</dt><dd><ReportAmount value={t.unpaid}/></dd></div></dl>
    </Link>;
  })}</div>;
}
export function PublicReportNotice({failed,retry}: {failed:boolean;retry:()=>void}) {
  const {locale}=useI18n(),hr=locale==="hr";
  return failed ? <div className={ui.reportNotice} role="alert">{hr?"Javno izvješće nije dostupno.":"The public report could not be loaded."} <button onClick={retry}>{hr?"Pokušaj ponovno":"Try again"}</button></div>
    : <p className={styles.smallNote} role="status">{hr?"Učitavanje javnog izvješća…":"Loading public report…"}</p>;
}
