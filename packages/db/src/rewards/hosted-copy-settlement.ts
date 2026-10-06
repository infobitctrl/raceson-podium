import {decodeSponsorExecutionPlan} from '@raceson/domain/rewards/sponsor-execution';
import type {SponsorSettlementActionV4} from '@raceson/rewards-chain';
import {RewardLedgerStoreError,copyRewardLedgerDocument as copy,type RewardLedgerRpc} from './programme-ledger.js';
import {rewardDocumentUuid as uuid,rewardDocumentObject as object,rewardDocumentArray as array} from './stored-documents.js';
const actions=['close','returnUnallocated','returnExpired'] as const;
const demand=(c:unknown)=>{if(!c)throw Error('controller_receipt_invalid');};
const hash=(v:unknown):v is string=>typeof v==='string'&&/^0x[0-9a-f]{64}$/.test(v)&&BigInt(v)>0n;
const uint=(v:unknown):v is string=>typeof v==='string'&&/^(0|[1-9][0-9]{0,24})$/.test(v);
export type HostedSettlementReceipt={schema:'podium-sponsor-settlement-receipt-v1';action:SponsorSettlementActionV4;slot:number;campaignAddress:string;recipient:string|null;amountWei:string;transactionHash:string;blockNumber:string;blockHash:string;blockTimestamp:string};
/** Fixed native actor, immutable original escrow; no sporting/profile exception. */
export function hostedCopySettlementFacts(actor:{subject:string;wallet:string},setupId:string,slot:number,rpc:RewardLedgerRpc){
 const subject=actor.subject,wallet=actor.wallet,id=uuid(setupId);
 if(!/^did:privy:[a-zA-Z0-9_-]{1,100}$/.test(subject)||!/^0x[0-9a-f]{40}$/.test(wallet)||!Number.isInteger(slot)||slot<0||slot>5)throw Error('controller_scope_required');
 return async(write?:{requestId:string;body:HostedSettlementReceipt})=>{
  const input=write?{requestId:uuid(write.requestId),body:copy(write.body)}:{};
  const r=await rpc('service_reward_demo_copy_settlement',{p_subject:subject,p_sender:wallet,p_setup_id:id,p_slot:slot,p_action:write?'receipt':'read',p_input:input});
  if(r.error){const code=String((r.error as {message?:unknown}).message);throw new RewardLedgerStoreError(['controller_scope_required','controller_source_not_ready','controller_receipt_invalid','controller_receipt_conflict','controller_invalid_request'].includes(code)?code:'controller_store_unavailable');}
  const raw=object(copy(r.data),['setupId','slot','execution','receipts']),e=object(raw.execution,['plan','deploymentHash','fundingHash']);
  demand(raw.setupId===id&&raw.slot===slot);const plan=decodeSponsorExecutionPlan(e.plan);
  demand(plan.chainId===10143&&plan.operator===wallet&&BigInt(plan.caps[slot]!)>0n);
  demand((e.deploymentHash===null||hash(e.deploymentHash))&&(e.fundingHash===null||hash(e.fundingHash))&&(e.fundingHash===null||e.deploymentHash!==null));
  const receipts=array(raw.receipts,3,v=>{
   const row=object(v,['id','body']),b=object(row.body,['schema','action','slot','campaignAddress','recipient','amountWei','transactionHash','blockNumber','blockHash','blockTimestamp']);
   const receiptId=uuid(row.id);demand(b.schema==='podium-sponsor-settlement-receipt-v1'&&actions.includes(b.action as SponsorSettlementActionV4)&&b.slot===slot
    &&typeof b.campaignAddress==='string'&&/^0x[0-9a-f]{40}$/.test(b.campaignAddress)&&BigInt(b.campaignAddress)>1n&&hash(b.transactionHash)&&hash(b.blockHash)
    &&uint(b.amountWei)&&BigInt(b.amountWei)<=BigInt(plan.caps[slot]!)&&uint(b.blockNumber)&&BigInt(b.blockNumber)>0n&&BigInt(b.blockNumber)<2n**64n
    &&uint(b.blockTimestamp)&&BigInt(b.blockTimestamp)>0n&&BigInt(b.blockTimestamp)<2n**64n);
   demand(b.action==='close'?b.recipient===null&&b.amountWei==='0':BigInt(b.amountWei as string)>0n&&b.recipient===(b.action==='returnUnallocated'?plan.unallocatedTreasury:plan.expiredTreasury));
   return{id:receiptId,body:b as HostedSettlementReceipt};
  });
  demand(new Set(receipts.map(r=>r.body.action)).size===receipts.length&&new Set(receipts.map(r=>r.body.transactionHash)).size===receipts.length
   &&(receipts.length===0||e.deploymentHash!==null&&e.fundingHash!==null));
  return{setupId:id,slot,execution:{plan,deploymentHash:e.deploymentHash as string|null,fundingHash:e.fundingHash as string|null},receipts};
 };
}
