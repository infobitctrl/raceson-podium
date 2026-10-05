import type {ReactNode} from 'react';
import {previewRewardSetup,type RewardDistributionSetup} from '@raceson/domain/rewards/distribution-setup';
import {sponsorTrackRows,type SponsorTrack} from '../model/sponsorTrackAllocation';
import {setupAmount} from '../model/setupAmount';
import s from './SponsorExact.module.css';
const colors=['#f56617','#201c19','#dbb47e','#a88ab9','#4c8278','#868f69'];
export default function SponsorBudgetSummary({configuration:c,hr,status,saved=false,selectedRace}:{selectedRace?:{slot:number;name:string;tracks?:SponsorTrack[]};configuration:RewardDistributionSetup;hr:boolean;status?:ReactNode;saved?:boolean}){
 let preview:ReturnType<typeof previewRewardSetup>|null=null;try{preview=previewRewardSetup(c);}catch{/* Invalid inputs remain editable. */}
 const pots=c.root.children.filter(n=>n.shareBps>0),t=(en:string,local:string)=>hr?local:en;
 const rows=pots.flatMap(pot=>{
  if(!selectedRace?.tracks?.length||!c.guided?.pots.some(p=>p.nodeId===pot.id&&p.slot===selectedRace.slot))return [{id:pot.id,name:selectedRace&&c.guided?.pots.some(p=>p.nodeId===pot.id&&p.slot===selectedRace.slot)?selectedRace.name:pot.name,shareBps:pot.shareBps,amountWei:preview?.rows.find(r=>r.id===pot.id)?.amountWei??null}];
  const tracks=sponsorTrackRows(pot,selectedRace.tracks),tracked=new Set(tracks.flatMap(t=>t.nodes.map(n=>n.id)));
  return [...tracks.map(track=>{
   const amounts=track.nodes.map(n=>preview?.rows.find(r=>r.id===n.id)?.amountWei??null);
   return {id:track.id,name:track.name,shareBps:track.shareBps,amountWei:preview&&amounts.every(n=>n!==null)?amounts.reduce<bigint>((sum,n)=>sum+n!,0n):null};
  }),...pot.children.filter(n=>!tracked.has(n.id)&&n.shareBps>0).map(n=>({id:n.id,name:n.name,shareBps:n.shareBps,amountWei:preview?.rows.find(r=>r.id===n.id)?.amountWei??null}))];
 });
 return <aside className={s.summary} aria-label={t('Campaign summary','Sažetak kampanje')}>{status?<span className={s.saved} data-saved={saved}>{status}</span>:null}<p className={s.smallLabel}>{t('Prize pool','Fond nagrada')}</p><strong className={s.total}>{setupAmount(preview?.budgetWei??null,hr)} <small>test MON</small></strong><div className={s.bar} aria-hidden="true">{rows.map((n,i)=><span key={n.id} style={{width:`${n.shareBps/100}%`,background:colors[i%colors.length]}}/>)}</div><dl className={s.summaryPots}>{rows.map((n,i)=><div key={n.id}><dt><i style={{background:colors[i%colors.length]}}/>{n.name}</dt><dd>{setupAmount(n.amountWei,hr)} <small>test MON</small></dd><dd>{n.shareBps/100}%</dd></div>)}</dl><dl className={s.summaryTerms}><div><dt>{t('Claim window','Rok preuzimanja')}</dt><dd>{c.policy?.claimWindowDays} {t('days','dana')}</dd></div><div><dt>{t('Unused funds','Neiskorištena sredstva')}</dt><dd>{c.policy?.treasuryReturn==='original_sender'?t('Back to the sponsor wallet','Povrat na novčanik sponzora'):t('RacesOn treasury','RacesOn riznica')}</dd></div></dl></aside>;
}
