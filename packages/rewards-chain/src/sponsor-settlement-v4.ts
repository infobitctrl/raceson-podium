import {decodeSponsorExecutionPlan,type SponsorExecutionPlan} from '@raceson/domain/rewards/sponsor-execution';
import {decodeEventLog,encodeFunctionData,parseAbi,type Address,type Hex} from 'viem';
import {observeSponsorProgrammePot,type SponsorChainReader} from './sponsor-v4.js';
import {demand,RewardProtocolError,uint} from './validation.js';

export const sponsorSettlementAbiV4=parseAbi([
 'function close()','function returnUnallocated()','function returnExpired()',
 'function unallocatedReturned() view returns(uint256)','function expiredReturned() view returns(uint256)',
 'event Closed()','event TreasuryReturned(address indexed treasury,uint256 amount)',
]);
export type SponsorSettlementActionV4='close'|'returnUnallocated'|'returnExpired';
export type SponsorSettlementInputV4={plan:SponsorExecutionPlan;slot:number;deploymentHash:Hex;fundingHash:Hex};
export type SponsorSettlementOperationV4={action:SponsorSettlementActionV4;recipient:string|null;amountWei:string};
const hash=(v:unknown):v is Hex=>typeof v==='string'&&/^0x[0-9a-f]{64}$/.test(v)&&BigInt(v)>0n;
function fixed(input:SponsorSettlementInputV4):SponsorSettlementInputV4{
 const plan=decodeSponsorExecutionPlan(input.plan),slot=input.slot;
 demand(Number.isInteger(slot)&&slot>=0&&slot<=5&&BigInt(plan.caps[slot]!)>0n&&hash(input.deploymentHash)&&hash(input.fundingHash),'invalid_sponsor_settlement');
 return{plan,slot,deploymentHash:input.deploymentHash,fundingHash:input.fundingHash};
}
export function sponsorSettlementDataV4(action:SponsorSettlementActionV4):Hex{
 demand(['close','returnUnallocated','returnExpired'].includes(action),'invalid_sponsor_settlement');
 return encodeFunctionData({abi:sponsorSettlementAbiV4,functionName:action});
}
/** Immutable original contract economics, independent of later sporting/profile
 * changes. This read never closes claims, approves recipients or returns funds. */
export async function observeSponsorSettlementV4(reader:SponsorChainReader,input:SponsorSettlementInputV4){
 const i=fixed(input);
 try{
  const o=await observeSponsorProgrammePot(reader,i.plan,i.deploymentHash,i.fundingHash,i.slot),pot=o.pots.find(p=>p.slot===i.slot);
  demand(o.funded&&!o.cancelled&&pot&&[1,2,3,4].includes(pot.state),'reward_sponsor_settlement_not_ready');
  const at={number:BigInt(o.blockNumber),hash:o.blockHash,timestamp:BigInt(o.blockTimestamp)},args={address:pot.address as Address,abi:sponsorSettlementAbiV4,blockNumber:at.number};
  const [unallocatedReturned,expiredReturned]=await Promise.all([
   reader.readContract({...args,functionName:'unallocatedReturned'}),reader.readContract({...args,functionName:'expiredReturned'}),
  ]);
  const unallocated=BigInt(pot.amountWei)-BigInt(pot.allocatedWei),expired=BigInt(pot.allocatedWei)-BigInt(pot.paidWei);
  // Each original lane returns its entire amount once. Claims cannot change
  // either lane after Closed, and paid awards are never a returnable liability.
  demand(typeof unallocatedReturned==='bigint'&&typeof expiredReturned==='bigint'&&unallocated>=0n&&expired>=0n
   &&(unallocatedReturned===0n||unallocatedReturned===unallocated)&&(expiredReturned===0n||expiredReturned===expired)
   &&unallocatedReturned+expiredReturned===BigInt(pot.returnedWei)
   &&(pot.state===4||unallocatedReturned+expiredReturned===0n),'reward_sponsor_settlement_accounting_mismatch');
  const lane=(recipient:string,original:bigint,returned:bigint)=>({recipient,originalWei:original.toString(),returnedWei:returned.toString(),remainingWei:(original-returned).toString()});
  const lanes={unallocated:lane(i.plan.unallocatedTreasury,unallocated,unallocatedReturned),expired:lane(i.plan.expiredTreasury,expired,expiredReturned)};
  const available:SponsorSettlementOperationV4[]=[];
  if(pot.state===3&&!pot.paused&&BigInt(pot.claimDeadline)>0n&&at.timestamp>=BigInt(pot.claimDeadline))available.push({action:'close',recipient:null,amountWei:'0'});
  if(pot.state===4){if(unallocated>unallocatedReturned)available.push({action:'returnUnallocated',recipient:lanes.unallocated.recipient,amountWei:lanes.unallocated.remainingWei});
   if(expired>expiredReturned)available.push({action:'returnExpired',recipient:lanes.expired.recipient,amountWei:lanes.expired.remainingWei});}
  const [chain,anchor,head]=await Promise.all([reader.getChainId(),reader.getBlock({blockNumber:at.number}),reader.getBlock({blockTag:'finalized'})]);
  demand(chain===i.plan.chainId&&anchor.number===at.number&&anchor.hash===at.hash&&anchor.timestamp===at.timestamp&&head.number!==null&&head.number>=at.number&&head.timestamp>=at.timestamp,'reward_chain_changed_during_observation');
  return{input:i,programmeAddress:o.address,pot,observedBlock:{number:o.blockNumber,hash:o.blockHash,timestamp:o.blockTimestamp},lanes,available};
 }catch(error){if(error instanceof RewardProtocolError)throw error;throw new RewardProtocolError('reward_sponsor_settlement_unavailable');}
}
export async function prepareSponsorSettlementV4(reader:SponsorChainReader,input:SponsorSettlementInputV4,action:SponsorSettlementActionV4){
 const observed=await observeSponsorSettlementV4(reader,input),operation=observed.available.find(o=>o.action===action);
 demand(operation,'reward_sponsor_settlement_not_ready');
 return{observed,operation,transaction:{chainId:observed.input.plan.chainId,from:observed.input.plan.operator,to:observed.pot.address,value:'0' as const,data:sponsorSettlementDataV4(action)}};
}
/** Exact finalized original-contract receipt and return log. A transaction hash,
 * nonce change or observed remaining balance alone is never a return receipt. */
export async function verifySponsorSettlementReceiptV4(reader:SponsorChainReader,input:SponsorSettlementInputV4,expected:SponsorSettlementOperationV4,transactionHash:Hex){
 const i=fixed(input),operation={...expected};
 demand(hash(transactionHash)&&/^(0|[1-9][0-9]*)$/.test(operation.amountWei),'invalid_sponsor_settlement');
 const amount=uint(BigInt(operation.amountWei)),data=sponsorSettlementDataV4(operation.action);
 demand(operation.action==='close'?operation.recipient===null&&amount===0n:amount>0n&&operation.recipient===(operation.action==='returnUnallocated'?i.plan.unallocatedTreasury:i.plan.expiredTreasury),'invalid_sponsor_settlement');
 try{
  const observed=await observeSponsorSettlementV4(reader,i);
  demand(observed.pot.state===4,'reward_sponsor_settlement_not_ready');
  const [tx,r]=await Promise.all([reader.getTransaction({hash:transactionHash}),reader.getTransactionReceipt({hash:transactionHash})]);
  const same=(a:string|null,b:string)=>a?.toLowerCase()===b;
  demand(tx.chainId===i.plan.chainId&&same(tx.hash,transactionHash)&&same(r.transactionHash,transactionHash)
   &&same(tx.from,i.plan.operator)&&same(r.from,i.plan.operator)&&same(tx.to,observed.pot.address)&&same(r.to,observed.pot.address)
   &&tx.value===0n&&tx.input===data&&r.status==='success'&&r.contractAddress===null&&tx.blockNumber===r.blockNumber&&tx.blockHash===r.blockHash
   &&tx.transactionIndex===r.transactionIndex&&r.blockNumber<=BigInt(observed.observedBlock.number),'reward_sponsor_settlement_receipt_mismatch');
  const block=await reader.getBlock({blockNumber:r.blockNumber});
  demand(block.hash===r.blockHash&&block.number===r.blockNumber&&block.timestamp>=BigInt(observed.pot.claimDeadline),'reward_sponsor_settlement_receipt_mismatch');
  const logs=r.logs.filter(l=>same(l.address,observed.pot.address));
  demand(logs.length===1,'reward_sponsor_settlement_receipt_mismatch');const log=logs[0]!;
  demand(!log.removed&&same(log.transactionHash,transactionHash)&&log.blockHash===r.blockHash&&log.blockNumber===r.blockNumber,'reward_sponsor_settlement_receipt_mismatch');
  const event=decodeEventLog({abi:sponsorSettlementAbiV4,data:log.data,topics:log.topics,strict:true});
  if(operation.action==='close')demand(event.eventName==='Closed','reward_sponsor_settlement_receipt_mismatch');
  else{
   const lane=operation.action==='returnUnallocated'?observed.lanes.unallocated:observed.lanes.expired;
   demand(event.eventName==='TreasuryReturned'&&event.args.treasury.toLowerCase()===operation.recipient&&event.args.amount===amount
    &&lane.originalWei===operation.amountWei&&lane.returnedWei===operation.amountWei&&lane.remainingWei==='0','reward_sponsor_settlement_receipt_mismatch');
  }
  const [chain,anchor,receiptBlock,head]=await Promise.all([reader.getChainId(),reader.getBlock({blockNumber:BigInt(observed.observedBlock.number)}),reader.getBlock({blockNumber:r.blockNumber}),reader.getBlock({blockTag:'finalized'})]);
  demand(chain===i.plan.chainId&&anchor.hash===observed.observedBlock.hash&&anchor.timestamp.toString()===observed.observedBlock.timestamp&&receiptBlock.hash===r.blockHash&&receiptBlock.timestamp===block.timestamp
   &&head.number!==null&&head.number>=BigInt(observed.observedBlock.number),'reward_chain_changed_during_observation');
  return{action:operation.action,slot:i.slot,campaignAddress:observed.pot.address,recipient:operation.recipient,amountWei:operation.amountWei,transactionHash,blockNumber:r.blockNumber.toString(),blockHash:r.blockHash,blockTimestamp:block.timestamp.toString()};
 }catch(error){if(error instanceof RewardProtocolError)throw error;throw new RewardProtocolError('reward_sponsor_settlement_unavailable');}
}
