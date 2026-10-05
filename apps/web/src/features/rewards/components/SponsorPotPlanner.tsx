import {useState} from "react";
import {ArrowDown,ArrowRight,Layers3} from "lucide-react";
import {balanceSetupChildren,previewRewardSetup,updateSetupNode,type RewardDistributionSetup,type RewardSetupNode} from "@raceson/domain/rewards/distribution-setup";
import {sponsorAmountShare,sponsorBudgetAmount,sponsorPotBranches,splitSponsorSections,splitSponsorRoundsEqually,setSponsorRoundShare} from "../model/sponsorBudget";
import {setupAmount} from "../model/setupAmount";
import s from "./SponsorPotPlanner.module.css";

type Props={configuration:RewardDistributionSetup;onChange:(next:RewardDistributionSetup)=>void;onChooseRewards:(slot:number)=>void;disabled:boolean;hr:boolean};
export default function SponsorPotPlanner({configuration:c,onChange,onChooseRewards,disabled,hr}:Props){
 const t=(en:string,local:string)=>hr?local:en,[error,setError]=useState("");
 const {league,rounds,roundsBps}=sponsorPotBranches(c),potsLocked=c.root.children.some(n=>n.locked);
 let preview:ReturnType<typeof previewRewardSetup>|null=null;try{preview=previewRewardSetup(c);}catch{/* Invalid drafts remain editable. */}
 const amount=(id:string)=>preview?.rows.find(row=>row.id===id)?.amountWei??null;
 const roundAmounts=rounds.map(n=>amount(n.id));
 const roundsAmount=roundAmounts.some(n=>n===null)?null:roundAmounts.reduce<bigint>((sum,n)=>sum+n!,0n);
 const apply=(update:()=>RewardDistributionSetup)=>{if(disabled)return;try{onChange(update());setError("");}catch{setError(t("Check the amount and available pot.","Provjerite iznos i raspoloživi fond."));}};
 const nodeShare=(node:RewardSetupNode,bps:number)=>apply(()=>({...c,root:updateSetupNode(c.root,node.id,n=>({...n,shareBps:bps}))}));
 function fields(label:string,share:number,value:bigint|null,parent:bigint|null,change:(bps:number)=>void,locked=false){
  const blocked=disabled||locked;
  return <div className={s.fields}>
   <label><span className={s.srOnly}>{label} %</span><input aria-label={`${label} %`} type="number" min="0" max="100" step="0.01" value={share/100} disabled={blocked} onChange={e=>{if(e.target.value!==""&&e.target.validity.valid)change(Math.round(Number(e.target.value)*100));}}/><span>%</span></label>
   <label><span className={s.srOnly}>{label} test MON</span><input aria-label={`${label} test MON`} key={`${label}:${value}`} inputMode="decimal" defaultValue={sponsorBudgetAmount(value)} disabled={blocked||parent===null||parent===0n||value===null} onBlur={e=>{const input=e.currentTarget;if(input.value===input.defaultValue)return;try{change(sponsorAmountShare(input.value,sponsorBudgetAmount(parent)));setError("");}catch{setError(t("Enter an amount within the parent pot.","Unesite iznos unutar nadređenog fonda."));}input.value=input.defaultValue;}}/><span>test MON</span></label>
  </div>;
 }
 function categories(pot:RewardSetupNode){
  const slot=c.guided!.pots.find(p=>p.nodeId===pot.id)!.slot,total=pot.children.reduce((sum,n)=>sum+n.shareBps,0);
  return <div className={s.categories}>
   {pot.children.length?<><div className={s.actions}><small>{t("% of this pot","% ovog fonda")}</small><button disabled={disabled||pot.children.every(n=>n.locked)} onClick={()=>apply(()=>({...c,root:updateSetupNode(c.root,pot.id,n=>({...n,children:balanceSetupChildren(n.children,"equal")}))}))}>{t("Split categories equally","Podijeli kategorije jednako")}</button></div>
    {pot.children.map(n=><div className={s.row} key={n.id}><span>{n.name}</span>{fields(`${pot.name} / ${n.name}`,n.shareBps,amount(n.id),amount(pot.id),bps=>nodeShare(n,bps),n.locked)}</div>)}
    <p className={s.balance} data-invalid={total>10000}>{total/100}% {t("allocated","raspoređeno")}{total<10000?` · ${(10000-total)/100}% ${t("unallocated","neraspoređeno")}`:""}</p></>:<p>{t("Choose reward categories to split this pot.","Odaberite kategorije za raspodjelu fonda.")}</p>}
   <button className={s.choose} disabled={disabled} onClick={()=>onChooseRewards(slot)}>{t("Choose rewards","Odaberi nagrade")}<ArrowRight size={15}/></button>
  </div>;
 }
 return <details className={s.planner}>
  <summary><Layers3 size={19}/>{t("Plan the whole pot","Planirajte cijeli fond")}<span>{t("Optional","Neobavezno")}</span></summary>
  <div className={s.body}>
   <label className={s.total}>{t("Programme pot","Fond programa")}<span><input aria-label={t("Programme pot · test MON","Fond programa · test MON")} inputMode="decimal" value={c.budgetMon} disabled={disabled} onChange={e=>onChange({...c,budgetMon:e.target.value})}/><b>test MON</b></span></label>
   <div className={s.flow}><ArrowDown size={18}/>{t("League + rounds","Liga + kola")}</div>
   <div className={s.actions}><small>{t("% of total · changes balance the other section","% ukupnog fonda · druga se cjelina prilagođava")}</small><button disabled={disabled||potsLocked} onClick={()=>apply(()=>splitSponsorSections(c,5000))}>50 / 50</button></div>
   <section className={s.branch} aria-label={t("League reward pot","Fond lige")}>
    <div className={s.row}><strong>{t("League rewards","Nagrade lige")}</strong>{fields(t("League rewards","Nagrade lige"),league.shareBps,amount(league.id),preview?.budgetWei??null,bps=>apply(()=>splitSponsorSections(c,bps)),potsLocked)}</div>
    <details><summary>{t("Split league categories","Podijeli kategorije lige")}<span>{league.children.length} {t("groups","grupa")}</span></summary>{categories(league)}</details>
   </section>
   <section className={s.branch} aria-label={t("Rounds reward pot","Fond kola")}>
    <div className={s.row}><strong>{t("All rounds","Sva kola")}</strong>{fields(t("All rounds","Sva kola"),roundsBps,roundsAmount,preview?.budgetWei??null,bps=>apply(()=>splitSponsorSections(c,10000-bps)),potsLocked)}</div>
    <details><summary>{t("Split between rounds","Podijeli između kola")}<span>{rounds.length} {t("rounds","kola")}</span></summary>
     <div className={s.rounds}><div className={s.actions}><small>{t("% of rounds pot · other rounds rebalance","% fonda kola · druga se kola prilagođavaju")}</small><button disabled={disabled||potsLocked||roundsBps<=0||roundsBps>10000} onClick={()=>apply(()=>splitSponsorRoundsEqually(c))}>{t("Split rounds equally","Podijeli kola jednako")}</button></div>
      {rounds.map(n=><section className={s.round} key={n.id}><div className={s.row}><strong>{n.name}</strong>{fields(`${n.name} · ${t("of rounds","od kola")}`,roundsBps?Math.round(n.shareBps*10000/roundsBps):0,amount(n.id),roundsAmount,bps=>apply(()=>setSponsorRoundShare(c,n.id,bps)),potsLocked||roundsBps<=0||roundsBps>10000)}</div>
       <details><summary>{t("Split reward categories","Podijeli kategorije nagrada")}<span>{n.children.length} {t("groups","grupa")}</span></summary>{categories(n)}</details>
      </section>)}
     </div>
    </details>
   </section>
   <p className={s.balance} data-invalid={league.shareBps+roundsBps!==10000}>{(league.shareBps+roundsBps)/100}% {t("of programme pot allocated","fonda programa raspoređeno")} · {setupAmount(preview?.budgetWei??null,hr)} test MON</p>
   <small>{t("Amount edits round to the draft’s 0.01% shares.","Uneseni iznosi zaokružuju se na udjele nacrta od 0,01%.")}</small>
   {error?<p role="alert" className={s.error}>{error}</p>:null}
  </div>
 </details>;
}
