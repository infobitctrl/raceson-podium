import type {RewardSetupNode,previewRewardSetup} from '@raceson/domain/rewards/distribution-setup';
import {setupAmount} from '../model/setupAmount';
import s from './SponsorStudio.module.css';

/** Preview only: hidden source categories keep their IDs and stored rules. */
export default function SponsorReviewPrizes({pot,preview,hr}:{pot:RewardSetupNode;preview:ReturnType<typeof previewRewardSetup>|null;hr:boolean}){
 const categories=pot.children.filter(n=>n.shareBps>0),t=(en:string,local:string)=>hr?local:en;
 if(!categories.length)return <p>{t('Choose categories','Odaberite kategorije')}</p>;
 return <div className={s.reviewPrizes}><table><caption>{t('Planned prizes by place','Planirane nagrade po mjestu')}</caption>
  <thead><tr><th>{t('Category','Kategorija')}</th><th>{t('Place','Mjesto')}</th><th>{t('Prize · test MON','Nagrada · test MON')}</th></tr></thead>
  <tbody>{categories.flatMap(category=>{
   const row=preview?.rows.find(r=>r.id===category.id),shares=category.rule?.sharesBps??[];
   if(!shares.length)return [<tr key={category.id}><th scope="row">{category.name}<small>{category.shareBps/100}% {t('of pot','fonda')}</small></th><td>{t('Contribution','Doprinos')}</td><td>{setupAmount(row?.amountWei??null,hr)}</td></tr>];
   return shares.map((_share,i)=><tr key={`${category.id}:${i}`}>
    {i===0?<th scope="rowgroup" rowSpan={shares.length}>{category.name}<small>{category.shareBps/100}% {t('of pot','fonda')}</small></th>:null}
    <td>#{i+1}</td><td>{setupAmount(row?.slots[i]??null,hr)}</td>
   </tr>);
  })}</tbody>
 </table></div>;
}
