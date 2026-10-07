import {parseEther} from 'viem';
import type {RewardDistributionSetup} from '@raceson/domain/rewards/distribution-setup';
import {previewRewardSetup} from '@raceson/domain/rewards/distribution-setup';
import {sponsorColors} from '../model/sponsorCatalogue';
import CampaignChart from './CampaignChart';
export default function SavedBudgetGraphic({configuration,hr}:{configuration:RewardDistributionSetup;hr:boolean}){
 try{const preview=previewRewardSetup(configuration),rows=configuration.root.children.filter(n=>n.shareBps>0).map((node,i)=>({label:node.name,value:(preview.rows.find(r=>r.id===node.id)?.amountWei??0n).toString(),color:sponsorColors[i%sponsorColors.length]}));
 const total=parseEther(configuration.budgetMon),allocated=rows.reduce((sum,r)=>sum+BigInt(r.value),0n);
 if(allocated<total)rows.push({label:hr?'Neraspoređeno':'Unallocated',value:(total-allocated).toString(),color:'#e1e2db'});
 return <CampaignChart compact title={hr?'Planirana raspodjela':'Planned allocation'} description={hr?'Planirane raspodjele nagradnih fondova':'Planned prize pool splits'} rows={rows} total={total.toString()} hr={hr}/>;}catch{return <small>{hr?"Raspodjela nije dostupna":"Allocation unavailable"}</small>;}
}
