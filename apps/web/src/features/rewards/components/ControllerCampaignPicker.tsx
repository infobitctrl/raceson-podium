import {useState} from 'react';
import {ArrowUpRight,Search,RefreshCw} from 'lucide-react';
import type {ControllerCampaign} from '../data/controller';
import {setupAmount} from '../model/setupAmount';
import s from '../screens/RewardsControl.module.css';

type Props={campaigns:ControllerCampaign[];selected?:string;busy:boolean;onSelect:(id:string)=>void;onRefresh:()=>void};
export default function ControllerCampaignPicker({campaigns,selected,busy,onSelect,onRefresh}:Props){
 const [expanded,setExpanded]=useState(false),[query,setQuery]=useState(''),[order,setOrder]=useState('ready');
 const visible=!selected||expanded;
 const search=query.trim().toLocaleLowerCase();
 const items=campaigns.filter(c=>c.name.toLocaleLowerCase().includes(search)||c.setupId.toLowerCase().includes(search)).sort((a,b)=>{
  if(order==='budget'){const delta=BigInt(b.execution.plan.budgetWei)-BigInt(a.execution.plan.budgetWei);if(delta!==0n)return delta>0n?1:-1;}
  if(order==='ready'){const delta=b.pots.filter(p=>p.ready).length-a.pots.filter(p=>p.ready).length;if(delta)return delta;}
  return a.name.localeCompare(b.name)||a.setupId.localeCompare(b.setupId);
 });
 return <section className={s.picker} aria-label="Assigned campaigns">
  <div className={s.row}><div><span className={s.eyebrow}>Your workspace</span><h2>Campaign distributions <small>{campaigns.length}</small></h2></div><div className={s.actions}>
   {selected?<button className={s.secondary} aria-expanded={visible} aria-controls="controller-campaigns" onClick={()=>setExpanded(!expanded)}>{expanded?'Close campaign list':'Change campaign'}</button>:null}
   <button disabled={busy} className={s.secondary} onClick={onRefresh}><RefreshCw size={15}/>{busy?'Checking…':'Refresh'}</button>
  </div></div>
  {visible?<div id="controller-campaigns"><div className={s.pickerTools}>
   <label className={s.search}><Search size={17} aria-hidden="true"/><input aria-label="Find an assigned campaign" placeholder="Campaign name or reference…" value={query} onChange={e=>setQuery(e.target.value)}/></label>
   <label className={s.sort}>Sort by<select value={order} onChange={e=>setOrder(e.target.value)}><option value="ready">Ready distributions</option><option value="name">Campaign name</option><option value="budget">Budget · high to low</option></select></label>
  </div><div className={s.campaigns}>{items.map(c=><button key={c.setupId} className={s.campaign} aria-pressed={c.setupId===selected} onClick={()=>{onSelect(c.setupId);setExpanded(false);}}>
   <span>{c.name}</span><strong>{setupAmount(BigInt(c.execution.plan.budgetWei),false)} <small>test MON budget</small></strong>
   <small className={s.campaignReference}>Campaign {c.setupId}</small>
   <small>{!c.execution.deploymentHash?'Saved · not deployed':!c.execution.fundingHash?'Ready for sponsor deposit':`${c.pots.filter(p=>p.ready).length} ${c.pots.filter(p=>p.ready).length===1?'distribution':'distributions'} ready`}</small><ArrowUpRight size={18} aria-hidden="true"/>
  </button>)}</div>{!items.length?<p role="status">No campaigns match this search. Try another name or reference.</p>:null}</div>:null}
 </section>;
}
