import {createHash} from 'node:crypto';
import type {Hex} from 'viem';
import {canonicalRewardJson as canonical,observeSponsorSettlementV4,prepareSponsorSettlementV4,verifySponsorSettlementReceiptV4,type SponsorSettlementActionV4,type SponsorSettlementOperationV4} from '@raceson/rewards-chain';
import type {hostedCopySettlementFacts} from '@raceson/db/rewards';
import type {SponsorCreationDeps} from './sponsor-creation-service.js';
export type SettlementFactsReader=ReturnType<typeof hostedCopySettlementFacts>;
export type SettlementDeps={readFacts:SettlementFactsReader;reader:SponsorCreationDeps['reader'];assertActive:()=>Promise<void>};
export async function originalSettlementFacts(d:SettlementDeps){
 await d.assertActive();const facts=await d.readFacts();
 const source=canonical({setupId:facts.setupId,slot:facts.slot,execution:facts.execution});
 const sourceHash=createHash('sha256').update(source).digest('hex');
 const input=facts.execution.deploymentHash&&facts.execution.fundingHash?{plan:facts.execution.plan,slot:facts.slot,deploymentHash:facts.execution.deploymentHash as Hex,fundingHash:facts.execution.fundingHash as Hex}:null;
 return{facts,source,sourceHash,input};
}
export async function fenceSettlement(d:SettlementDeps,source:string){if((await originalSettlementFacts(d)).source!==source)throw Error('controller_source_not_ready');await d.assertActive();}
export async function currentSettlement(d:SettlementDeps){
 const f=await originalSettlementFacts(d);if(!f.input)throw Error('controller_source_not_ready');
 const observed=await observeSponsorSettlementV4(d.reader,f.input);await fenceSettlement(d,f.source);
 return{...f,input:f.input,observed};
}
export async function preparedSettlement(d:SettlementDeps,action:SponsorSettlementActionV4,expectedSourceHash:string){
 const f=await originalSettlementFacts(d);if(!f.input||f.sourceHash!==expectedSourceHash)throw Error('controller_source_not_ready');
 const prepared=await prepareSponsorSettlementV4(d.reader,f.input,action);await fenceSettlement(d,f.source);
 return{...f,input:f.input,...prepared};
}
export async function recordSettlementReceipt(d:SettlementDeps,requestId:string,transactionHash:Hex,operation:SponsorSettlementOperationV4,expectedSource?:string){
 const f=await originalSettlementFacts(d);if(!f.input||expectedSource&&expectedSource!==f.source)throw Error('controller_source_not_ready');
 const body={schema:'podium-sponsor-settlement-receipt-v1' as const,...await verifySponsorSettlementReceiptV4(d.reader,f.input,operation,transactionHash)};
 await fenceSettlement(d,f.source);await d.readFacts({requestId,body});await fenceSettlement(d,f.source);
 return body;
}
export async function settlementView(d:SettlementDeps){
 const f=await originalSettlementFacts(d),observed=f.input?await observeSponsorSettlementV4(d.reader,f.input):null;
 await fenceSettlement(d,f.source);
 return{schema:'podium-sponsor-settlement-view-v1',setupId:f.facts.setupId,slot:f.facts.slot,sourceHash:f.sourceHash,
  operator:f.facts.execution.plan.operator,pot:observed?.pot??null,lanes:observed?.lanes??null,available:observed?.available??[],observedBlock:observed?.observedBlock??null,receipts:f.facts.receipts};
}
/** Manual recovery accepts only an action/hash; amounts and destinations are
 * derived from the original finalized escrow, never supplied by a client. */
export async function recoverSettlementReceipt(d:SettlementDeps,requestId:string,transactionHash:Hex,action:SponsorSettlementActionV4){
 const f=await currentSettlement(d),lane=action==='returnUnallocated'?f.observed.lanes.unallocated:f.observed.lanes.expired;
 const operation={action,recipient:action==='close'?null:lane.recipient,amountWei:action==='close'?'0':lane.originalWei};
 await recordSettlementReceipt(d,requestId,transactionHash,operation,f.source);return settlementView(d);
}
