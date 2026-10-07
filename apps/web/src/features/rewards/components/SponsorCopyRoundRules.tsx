import {useState} from 'react';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import type {RewardDistributionSetup} from '@raceson/domain/rewards/distribution-setup';
import {existingRoundCompatibility,type ExistingCategoryKeys} from '../model/copyExistingRoundRules';
import s from './SponsorRaceScope.module.css';
import {Copy} from 'lucide-react';
import d from './SponsorCopyRoundRules.module.css';

export default function SponsorCopyRoundRules({configuration:c,sourceId,keys,hr,disabled,onApply}:{configuration:RewardDistributionSetup;sourceId:string;keys:ExistingCategoryKeys;hr:boolean;disabled:boolean;onApply:(ids:string[])=>boolean}){
 const [open,setOpen]=useState(false),[selected,setSelected]=useState<string[]>([]),[done,setDone]=useState(false),t=(en:string,local:string)=>hr?local:en;
 const targets=c.root.children.filter(p=>p.id!==sourceId&&p.shareBps>0&&c.guided?.pots.some(g=>g.nodeId===p.id&&g.slot>0));
 return <div className={d.toolbar}><button type="button" className={d.copy} disabled={disabled||!targets.length} onClick={()=>{setOpen(true);setSelected([]);setDone(false);}}><Copy size={18}/>{t('Copy rules to other rounds','Kopiraj pravila u druga kola')}</button><p>{t('Reuse this round’s category shares and prizes.','Primijenite udjele kategorija i nagrade ovog kola.')}</p>
 {done?<p role="status">{t('Rules copied. Save the campaign to keep them.','Pravila su kopirana. Spremite kampanju za pohranu.')}</p>:null}
 <Dialog open={open} onOpenChange={setOpen}><DialogContent className={d.dialog}><DialogTitle>{t('Copy rules to other rounds','Kopiraj pravila u druga kola')}</DialogTitle><DialogDescription>{t('Selected rounds keep their budgets and official categories. Their category shares and prizes will be replaced.','Odabrana kola zadržavaju fondove i službene kategorije. Udjeli kategorija i nagrade bit će zamijenjeni.')}</DialogDescription>
 <div className={d.options}>{targets.map(p=>{const compatible=existingRoundCompatibility(c,sourceId,p.id,keys);return <label key={p.id}><input type="checkbox" checked={selected.includes(p.id)} disabled={disabled||!compatible} onChange={event=>setSelected(ids=>event.target.checked?[...ids,p.id]:ids.filter(id=>id!==p.id))}/><span>{p.name}{!compatible?<small>{t('Not compatible · missing category or locked rules','Nije kompatibilno · nedostaje kategorija ili su pravila zaključana')}</small>:null}</span></label>;})}</div>
 <button type="button" className={s.apply} disabled={disabled||!selected.length} onClick={()=>{if(onApply(selected)){setOpen(false);setDone(true);}}}>{t('Copy to selected rounds','Kopiraj u odabrana kola')}</button>
 </DialogContent></Dialog></div>;
}
