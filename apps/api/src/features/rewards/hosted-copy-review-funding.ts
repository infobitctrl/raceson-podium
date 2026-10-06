import type {SponsorExecutionRecord} from '@raceson/domain/rewards/sponsor-execution';
import {observeSponsorProgramme,type SponsorChainReader} from '@raceson/rewards-chain/sponsor-v4';
import type {Hex} from 'viem';

/** Read-only, finalized chain evidence. A saved transaction hash is never a receipt. */
export async function hostedReviewFunding(execution:SponsorExecutionRecord|null,reader?:SponsorChainReader){
 const empty={fundedWei:null,remainingWei:null,paidWei:null,returnedWei:null,blockNumber:null,programmeAddress:null,pools:[]};
 if(!execution?.deploymentHash)return {state:'awaiting_contract' as const,...empty};
 if(!reader)return {state:'unverified' as const,...empty};
 try{
  const observation=await observeSponsorProgramme(reader,execution.plan,execution.deploymentHash as Hex,execution.fundingHash as Hex|undefined);
  const pools=observation.pots.filter(p=>BigInt(p.amountWei)>0n).map(p=>({slot:p.slot,budgetWei:p.amountWei,remainingWei:p.remainingWei,paidWei:p.paidWei,returnedWei:p.returnedWei}));
  const sum=(field:'remainingWei'|'paidWei'|'returnedWei')=>pools.reduce((total,p)=>total+BigInt(p[field]),0n).toString();
  return {state:observation.cancelled?'cancelled' as const:observation.funded?'funded' as const:'awaiting_funding' as const,
   fundedWei:observation.funded?execution.plan.budgetWei:'0',remainingWei:sum('remainingWei'),paidWei:sum('paidWei'),returnedWei:sum('returnedWei'),
   blockNumber:observation.blockNumber,programmeAddress:observation.address,pools};
 }catch{return {state:'unverified' as const,...empty};}
}
