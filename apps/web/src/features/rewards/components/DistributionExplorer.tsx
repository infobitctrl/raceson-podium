import { lazy, Suspense, useId, type ReactNode } from "react";
import { useI18n } from "@/shared/i18n/I18nContext";
import { formatTestMon } from "../model/athleteRewards";
import { distributionPath, visibleDistributionBranches, type DistributionGraph } from "../model/distributionExplorer";
import styles from "./DistributionExplorer.module.css";
const DistributionFlowChart = lazy(() => import("./DistributionFlowChart"));

/** Keep the complete chart in place while the selected branch updates the inspector. */
export default function DistributionExplorer({ graph, selected, onSelect, status, children, branchDetails }: {
  graph: DistributionGraph; selected: string; onSelect: (id:string)=>void; status: string; children?: ReactNode; branchDetails?:ReactNode;
}) {
  const {locale}=useI18n(),hr=locale==="hr",inspector=useId();
  const root=graph.byId.get(graph.rootId)!,node=graph.byId.get(selected)??root;
  const path=distributionPath(graph,node.id),visible=visibleDistributionBranches(graph,graph.rootId);
  const rounds=graph.nodes.filter(n=>n.parentId==="rounds"),branches=root.children.map(id=>graph.byId.get(id)!);
  const leaguePools=graph.nodes.filter(n=>n.pool&&n.tone==="league");
  const mobileBranches=branches.filter(n=>!leaguePools.some(pool=>pool.id===n.id));
  const amount=(wei:bigint)=>wei===0n?"0":formatTestMon(wei.toString(),locale);
  return <section className={styles.explorer} aria-label={hr?"Istraži raspodjelu":"Explore distribution"}>
    <div className={styles.layout}><div className={styles.visual}>
      <header className={styles.heading}><div><h2>{hr?"Ukupni proračun nagrada":"Total reward budget"}</h2><button className={styles.total} onClick={()=>onSelect(root.id)} aria-controls={inspector}>{amount(root.amountWei)} test MON</button></div><p>{status}</p></header>
      <Suspense fallback={<p role="status">{hr?"Učitavanje grafikona…":"Loading chart…"}</p>}><DistributionFlowChart controls={inspector}
        nodes={visible.map(n=>({...n,amount:`${amount(n.amountWei)} test MON`}))} selected={node.id} onSelect={onSelect} height={400}/></Suspense>
      {mobileBranches.length?<div className={styles.mobileBranches}>{mobileBranches.map(n=><button key={n.id} onClick={()=>onSelect(n.id)} aria-pressed={path.some(p=>p.id===n.id)} data-tone={n.tone} aria-controls={inspector}><span>{n.label}</span><strong>{amount(n.amountWei)} test MON</strong></button>)}</div>:null}
      {leaguePools.length?<section className={styles.leagueSplits} aria-label={hr?"Podjela fonda lige":"League pot splits"}>
        <h3>{hr?"Fond lige":"League pot"}</h3>
        <ul className={`${styles.rounds} ${styles.pools}`}>{leaguePools.map(n=><li key={n.id}><button aria-controls={inspector} aria-pressed={node.id===n.id} onClick={()=>onSelect(n.id)}><span>{amount(n.amountWei)} test MON</span><strong>{n.label}</strong><span>{n.parentId&&graph.byId.get(n.parentId)!.amountWei?Number(n.amountWei*10000n/graph.byId.get(n.parentId)!.amountWei)/100:0}% {hr?"fonda lige":"of league pot"}</span></button></li>)}</ul>
      </section>:null}
      {rounds.length?<ul className={styles.rounds}>{rounds.map((n,i)=><li key={n.id}><button aria-controls={inspector} aria-pressed={path.some(p=>p.id===n.id)} onClick={()=>onSelect(n.id)}><span>{n.label===`${hr?"Kolo":"Round"} ${i+1}`?(hr?"Fond kola":"Race pot"):`${hr?"Kolo":"Round"} ${i+1}`}</span><strong>{n.label}</strong><span>{amount(n.amountWei)} test MON</span></button></li>)}</ul>:null}
      <details className={styles.allBranches}><summary>{hr?"Sve grane raspodjele":"All distribution branches"}</summary><label className={styles.select}>{hr?"Prikaži granu":"View branch"}<select value={node.id} onChange={e=>onSelect(e.target.value)}>
        {graph.nodes.map(n=><option key={n.id} value={n.id}>{distributionPath(graph,n.id).map(p=>p.label).join(" / ")}</option>)}
      </select></label></details>
    </div><section id={inspector} className={styles.inspector} aria-label={hr?"Odabrana raspodjela":"Selected distribution"} data-tone={node.tone}>
      <nav className={styles.path} aria-label={hr?"Putanja raspodjele":"Distribution path"}>{path.slice(0,-1).map(p=><button key={p.id} onClick={()=>onSelect(p.id)}>{p.label} ›</button>)}</nav>
      <div aria-live="polite" aria-atomic="true"><h3>{node.label}</h3><p className={styles.amount}>{amount(node.amountWei)} test MON</p></div>
      <p className={styles.hint}>{hr?"Proračun grane":"Branch budget"}{node.parentId?` · ${graph.byId.get(node.parentId)!.amountWei?Number(node.amountWei*10000n/graph.byId.get(node.parentId)!.amountWei)/100:0}% ${hr?"nadređenog fonda":"of parent budget"}`:""}</p>
      {branchDetails??(node.children.length?<ul className={styles.allocations}>{node.children.map(id=>{const n=graph.byId.get(id)!;return <li key={id}><button onClick={()=>onSelect(id)} aria-controls={inspector}><strong>{amount(n.amountWei)} test MON</strong><span>{n.label}</span><span className={styles.bar} aria-hidden="true"><span style={{width:`${node.amountWei?Number(n.amountWei*10000n/node.amountWei)/100:0}%`}}/></span></button></li>;})}</ul>:null)}
      {children}
    </section></div>
  </section>;
}
