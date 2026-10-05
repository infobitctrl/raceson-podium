import {useState} from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import type {ResultDisplay} from '../data/resultDisplay';
import {setupAmount} from '../model/setupAmount';
import RewardResultsTable from './RewardResultsTable';
import RewardReviewOverview from './RewardReviewOverview';
import s from './RewardRoleWorkspace.module.css';

export default function RewardReviewViews({data,budgetWei,hr=false,approved=false}:{data:ResultDisplay;budgetWei:string;hr?:boolean;approved?:boolean}){
 const [view,setView]=useState('standings'),t=(en:string,local:string)=>hr?local:en;
 const totals=[...(data.recipientTotals??[])].sort((a,b)=>{const x=BigInt(a.amountWei??'0'),y=BigInt(b.amountWei??'0');return x===y?a.key.localeCompare(b.key):x>y?-1:1;});
 const reserved=data.distribution?.filter(group=>group.held||BigInt(group.retainedWei)>0n)??[];
 return <Tabs.Root value={view} onValueChange={setView}>
  <Tabs.List className={s.tabs} aria-label={t('Review views','Prikazi pregleda')}>{[
   ['standings',t('Standings & awards','Poredak i nagrade')],['recipients',t('Recipient totals','Ukupno po primatelju')],['reserved',t('Reserved funds','Rezervirana sredstva')],['distribution',t('Distribution','Raspodjela')],
  ].map(([id,label])=><Tabs.Trigger key={id} value={id}>{label}</Tabs.Trigger>)}</Tabs.List>
  <Tabs.Content value="standings"><RewardResultsTable groupByCategory data={data} budgetWei={budgetWei} hr={hr} approved={approved}/></Tabs.Content>
  <Tabs.Content value="recipients">
   <div className={s.reviewSummary}><p>{t('Recipient total','Ukupno primateljima')}<strong>{data.blocked?t('Pending review','Čeka pregled'):`${setupAmount(BigInt(data.allocatedWei),hr)} test MON`}</strong></p><p>{t('Calculation','Izračun')}<strong>{data.estimated?t('Estimate','Procjena'):approved?t('Approved','Odobreno'):t('For review','Za pregled')}</strong></p></div>
   {data.recipientTotals===undefined?<p role="status" className={s.empty}>{t('Combined recipient totals are unavailable for this record. Review the official rows in Standings & awards.','Zbrojevi po primatelju nisu dostupni za ovaj zapis. Pregledajte službene retke u Poredak i nagrade.')}</p>:totals.length?<div className={s.reviewTable}><table><caption>{t('Exact totals for this prize pot, combined by sporting identity. Shared names are never merged.','Točni zbrojevi ovog fonda, objedinjeni prema sportskom identitetu. Ista imena nikad se ne spajaju.')}</caption><thead><tr><th>{t('Recipient','Primatelj')}</th><th>{t('Categories','Kategorije')}</th><th>{t('Total','Ukupno')}</th></tr></thead><tbody>{totals.map(row=><tr key={row.key}><th scope="row">{row.name??t('Name unavailable','Ime nije dostupno')}<small>{row.kind==='club'?t('Club','Klub'):t('Athlete','Sportaš')}</small></th><td>{row.categoryCount}</td><td>{row.amountWei===null?t('Pending review','Čeka pregled'):`${setupAmount(BigInt(row.amountWei),hr)} test MON`}</td></tr>)}</tbody></table></div>:<p className={s.empty}>{t('No recipient allocation is available yet. Check the official-source review.','Raspodjela po primateljima još nije dostupna. Provjerite pregled službenog izvora.')}</p>}
  </Tabs.Content>
  <Tabs.Content value="reserved"><div className={s.reviewSummary}><p>{t('Reserved remainder','Rezervirani ostatak')}<strong>{setupAmount(BigInt(data.retainedWei),hr)} test MON</strong></p></div>
   <p className={s.description}>{t('These amounts remain in this pot under its saved rules. Recipient wallet and consent readiness are reviewed separately; this is not a list of walletless athletes.','Ovi iznosi ostaju u fondu prema spremljenim pravilima. Spremnost novčanika i pristanak provjeravaju se zasebno; ovo nije popis sportaša bez novčanika.')}</p>
   {reserved.length?<ul className={s.reserved}>{reserved.map(group=><li key={group.id}><div><strong>{group.name}</strong><small>{group.held?t('Source review required · category allocation is on hold','Potreban pregled izvora · raspodjela kategorije je na čekanju'):t('Remainder after the current reward calculation','Ostatak nakon trenutnog izračuna nagrada')}</small></div><strong>{setupAmount(BigInt(group.retainedWei),hr)} test MON</strong></li>)}</ul>:<p className={s.empty}>{t('No category remainder is listed in this calculation.','U ovom izračunu nije naveden ostatak kategorije.')}</p>}
  </Tabs.Content>
  <Tabs.Content value="distribution"><RewardReviewOverview data={data} budgetWei={budgetWei} hr={hr}/></Tabs.Content>
 </Tabs.Root>;
}
