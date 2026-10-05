import type {RewardSetupNode,SetupPreviewRow} from '@raceson/domain/rewards/distribution-setup';
import type {ResultDisplay} from '../data/resultDisplay';

/** Percentages describe geometry only; displayed amounts are server integers. */
export function resultDistributionChart(data:ResultDisplay,budgetWei:string){
 const groups=data.distribution;if(!groups?.length)return null;
 const budget=BigInt(budgetWei),share=(value:bigint,total:bigint)=>total>0n?Number(value*10000n/total):0;
 if(groups.reduce((sum,g)=>sum+BigInt(g.budgetWei),0n)!==budget)return null;
 if(groups.reduce((sum,g)=>sum+BigInt(g.allocatedWei),0n)!==BigInt(data.allocatedWei)||groups.reduce((sum,g)=>sum+BigInt(g.retainedWei),0n)!==BigInt(data.retainedWei))return null;
 if(groups.some(g=>BigInt(g.allocatedWei)+BigInt(g.retainedWei)!==BigInt(g.budgetWei)||g.prizes.reduce((sum,p)=>sum+BigInt(p.amountWei),0n)>BigInt(g.allocatedWei)))return null;
 const root:RewardSetupNode={id:'review-pot',name:data.name,shareBps:10000,locked:true,children:[],rule:null};
 const row=(id:string,amountWei:bigint|null,retainedWei:bigint|null,slots:bigint[]=[]):SetupPreviewRow=>({id,amountWei,retainedWei,slots,totalShareBps:10000,pathShare:1,issue:null});
 const rows=[row(root.id,budget,BigInt(data.retainedWei))];
 root.children=groups.map(g=>{
  const amount=BigInt(g.budgetWei),slots=Array.from({length:Math.max(0,...g.prizes.map(p=>p.rank))},(_,i)=>BigInt(g.prizes.find(p=>p.rank===i+1)?.amountWei??'0'));
  rows.push(row(g.id,amount,BigInt(g.retainedWei),data.blocked||g.held?[]:slots));
  return {id:g.id,name:g.name,shareBps:share(amount,budget),locked:true,children:[],rule:slots.length&&!data.blocked&&!g.held?{basis:'race_position',source:null,sharesBps:slots.map(v=>share(v,amount))}:null};
 });
 return {root,rows};
}
