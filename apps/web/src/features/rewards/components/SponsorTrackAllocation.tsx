import {useState} from 'react';
import {previewRewardSetup,type RewardDistributionSetup} from '@raceson/domain/rewards/distribution-setup';
import type {RewardSourceCatalogueV2} from '@raceson/domain/rewards/source-mapping-v2';
import {allocateSponsorTracks,sponsorTrackRows,type SponsorTrack} from '../model/sponsorTrackAllocation';
import {setupAmount} from '../model/setupAmount';
import s from './SponsorExact.module.css';

type Props={configuration:RewardDistributionSetup;potId:string;tracks:SponsorTrack[];catalogue?:RewardSourceCatalogueV2|null;onChange:(c:RewardDistributionSetup)=>void;disabled:boolean;hr:boolean};
export default function SponsorTrackAllocation({configuration:c,potId,tracks,catalogue,onChange,disabled,hr}:Props){
 const [error,setError]=useState(''),t=(en:string,local:string)=>hr?local:en;
 const pot=c.root.children.find(p=>p.id===potId)!;
 const rows=sponsorTrackRows(pot,tracks),locked=disabled||pot.locked||pot.children.some(n=>n.locked);
 let preview:ReturnType<typeof previewRewardSetup>|null=null;try{preview=previewRewardSetup(c);}catch{/* The percentage controls remain editable. */}
 const total=pot.children.reduce((sum,n)=>sum+n.shareBps,0),tracked=new Set(rows.flatMap(r=>r.nodes.map(n=>n.id))),other=pot.children.filter(n=>!tracked.has(n.id)&&n.shareBps>0);
 const apply=(change:{id:string;shareBps:number}|null)=>{if(locked)return;try{onChange(allocateSponsorTracks(c,potId,tracks,change,catalogue,hr));setError('');}catch{setError(t('Track allocations could not be updated. Check the categories and locked shares.','Raspodjelu staza nije moguće ažurirati. Provjerite kategorije i zaključane udjele.'));}};
 return <><div className={s.sectionHeading}><div><h2>{t('Allocate the prize pool','Raspodijelite fond nagrada')}</h2><p className={s.hint}>{preview?<>{t('Each percentage is a share of the','Svaki postotak je udio u fondu od')} <strong>{setupAmount(preview.budgetWei,hr)} test MON</strong>{t(' prize pool.','.')}</>:t('Each percentage is a share of the prize pool.','Svaki postotak je udio u fondu nagrada.')}</p></div><button className={s.outline} disabled={locked} onClick={()=>apply(null)}>{t('Split evenly','Podijeli jednako')}</button></div>
 <div className={s.allocation}><p className={s.allocationLabel}>{t('Tracks','Staze')}</p>{rows.map(row=>{
  const amounts=row.nodes.map(n=>preview?.rows.find(r=>r.id===n.id)?.amountWei??null),amount=preview&&amounts.every(n=>n!==null)?amounts.reduce<bigint>((sum,n)=>sum+n!,0n):null;
  return <div className={s.allocationRow} key={row.id}><label><input type="checkbox" checked={row.shareBps>0} disabled={locked} onChange={e=>apply({id:row.id,shareBps:e.target.checked?Math.floor((10000-other.reduce((sum,n)=>sum+n.shareBps,0))/(rows.filter(r=>r.shareBps>0).length+1)):0})}/>{row.name}</label><label><input type="number" aria-label={`${row.name} %`} min="0" max="100" step="0.01" value={row.shareBps/100} disabled={locked} onChange={e=>{if(e.target.value!==''&&e.target.validity.valid)apply({id:row.id,shareBps:Math.round(Number(e.target.value)*100)});}}/>%</label><strong>{setupAmount(amount,hr)} <small>test MON</small></strong></div>;
 })}{other.map(n=><div className={s.allocationRow} key={n.id}><span>{n.name}</span><span>{n.shareBps/100}%</span><strong>{setupAmount(preview?.rows.find(r=>r.id===n.id)?.amountWei??null,hr)} <small>test MON</small></strong></div>)}<div className={s.allocated}><span>{t('Allocated','Raspoređeno')}</span><span>{total/100}%{total===10000?' ✓':''}</span></div></div>{error?<p role="alert">{error}</p>:null}</>;
}
