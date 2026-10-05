import { useState } from "react";
import type { PublicRewardPot } from "@raceson/domain/rewards/public-report";
import { useI18n } from "@/shared/i18n/I18nContext";
import { ReportAmount } from "./PublicReportSummary";
import { rewardPoolLabel, prizePercent } from "../model/prizeDisplay";
import styles from "./PublicPrizeCharts.module.css";



function PoolChart({pot,pool}:{pot:PublicRewardPot;pool:PublicRewardPot["pools"][number]}) {
  const {locale}=useI18n(),hr=locale==="hr";
  const [categoryId,setCategoryId]=useState(pool.categories?.[0]?.id),[active,setActive]=useState(0);
  const category=pool.categories?.find(c=>c.id===categoryId)??pool.categories?.[0];
  const title=rewardPoolLabel(pool.key,hr),participation=pool.key==="participation";
  const weightTotal=category?.slots.reduce((n,s)=>n+BigInt(s.weight),0n)??0n;
  const bars=category?category.slots.map(s=>({label:`${hr?"Mjesto":"Place"} ${s.position}`,amountWei:s.amountWei,share:prizePercent(BigInt(s.weight),weightTotal)}))
    :participation?(pool.awards??[]).map(a=>({label:pot.rows.find(r=>r.recipientId===a.recipientId)?.name??a.recipientId,amountWei:a.amountWei,share:prizePercent(BigInt(a.amountWei),BigInt(pool.budgetWei))})):[];
  const selected=bars[active]??bars[0],max=Math.max(...bars.map(b=>b.share),1);
  return <section className={styles.pool} aria-label={`${title} · ${hr?"Raspodjela nagrada":"Prize distribution"}`}>
    <header><h4>{title}</h4><strong><ReportAmount value={pool.budgetWei}/> <small>test MON</small></strong><span>{prizePercent(BigInt(pool.budgetWei),BigInt(pot.budgetWei))}% {hr?"fonda":"of pot"}</span></header>
    {category?<label className={styles.category}>{hr?"Kategorija":"Category"}<select aria-label={`${title} · ${hr?"Kategorija":"Category"}`} value={category.id} onChange={e=>{setCategoryId(e.target.value);setActive(0);}}>{pool.categories!.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select><span>{hr?"Fond kategorije":"Category pot"}: <ReportAmount value={category.budgetWei}/> test MON</span></label>:null}
    {selected?<>
      <div className={styles.bars} aria-label={hr?"Udjeli nagrada":"Prize shares"}>{bars.map((bar,i)=><button key={bar.label} aria-label={`${bar.label} · ${bar.share}%`} aria-pressed={active===i} title={`${bar.label} · ${bar.share}%`} onClick={()=>setActive(i)} style={{height:`${Math.max(3,bar.share/max*100)}%`}}/>)}</div>
      <p className={styles.selection}><b>{selected.label}</b><span>{selected.share}% · <ReportAmount value={selected.amountWei}/> test MON</span></p>
      <details><summary>{participation?(hr?"Sve pojedinačne nagrade":"Every athlete’s share"):(hr?"Sva nagradna mjesta":"Every prize slot")}</summary><div className={styles.slotScroll}><table><caption className="sr-only">{title} · {hr?"Udjeli i iznosi":"Shares and amounts"}</caption><thead><tr><th>{participation?(hr?"Sportaš":"Athlete"):(hr?"Mjesto":"Place")}</th><th>%</th><th>test MON</th></tr></thead><tbody>{bars.map(b=><tr key={b.label}><th scope="row">{b.label}</th><td>{b.share}%</td><td><ReportAmount value={b.amountWei}/></td></tr>)}</tbody></table></div></details>
      <p className={styles.note}>{participation?(hr?"Prema prijeđenoj udaljenosti; bez plasmana.":"Based on distance; no finishing position."):(hr?"Nagradna mjesta po kategoriji. Izjednačeni plasmani dijele zauzeta mjesta.":"Prize slots within this category. Tied finishers share the occupied slots.")}</p>
    </>:<p className={styles.note}>{hr?"Raspored nagradnih mjesta nije dostupan u ovom izvješću.":"Prize-slot schedule is not available in this report."}</p>}
  </section>;
}
export default function PublicPrizeCharts({pot,poolKey}:{pot:PublicRewardPot;poolKey?:string}) {
  return <div className={styles.charts} data-tone={pot.slot===6?"league":"race"}>{pot.pools.filter(p=>!poolKey||p.key===poolKey).map(pool=><PoolChart key={`${pot.id}:${pool.key}`} pot={pot} pool={pool}/>)}</div>;
}
