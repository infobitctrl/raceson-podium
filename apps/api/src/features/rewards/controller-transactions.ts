import {createHash,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {getContractAddress,keccak256,parseTransaction,recoverTransactionAddress,type Hex,type TransactionSerialized} from 'viem';
import {rewardControllerTransaction,rewardControllerFacts,decodeSponsorLifecycleFactsV4,copyRewardLedgerDocument as copy,type RewardLedgerRpc} from '@raceson/db/rewards';
import {sponsorFactoryBuild,verifySponsorFactory} from '@raceson/rewards-chain/sponsor-v4';
import {canonicalRewardJson as canonical} from '@raceson/rewards-chain';
import {observeSponsorLifecycleV4,sponsorLifecycleDataV4,verifySponsorActionReceiptV4} from '@raceson/rewards-chain/sponsor-lifecycle-v4';
import {sponsorLifecycleInputV4} from './sponsor-lifecycle-v4-service.js';
import type {SponsorCreationDeps} from './sponsor-creation-service.js';
const uint=z.string().regex(/^(0|[1-9][0-9]*)$/),hex=z.string().regex(/^0x[0-9a-f]+$/),address=z.string().regex(/^0x[0-9a-f]{40}$/);
const context=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('factory'),build:z.literal(sponsorFactoryBuild.creationCodeHash)}).strict(),
 z.object({kind:z.literal('distribution'),setupId:z.string().uuid(),approvalId:z.string().uuid(),action:z.enum(['upload','stage','activate']),start:z.number().int().min(0),end:z.number().int().min(0),source:z.string()}).strict(),
]);
const tx=z.object({chainId:z.literal(10143),to:address.optional(),data:hex,value:z.literal('0'),nonce:uint,gas:uint,gasPrice:uint}).strict();
const job=z.object({id:z.string().uuid(),subject:z.string(),sender:address,context,transaction:tx,signedTransaction:hex.nullable(),hash:z.string().regex(/^0x[0-9a-f]{64}$/).nullable(),confirmed:z.boolean()}).strict();
type Job=z.infer<typeof job>;
type Actor={subject:string;wallet:string};
type Deps={actor:Actor;reader:SponsorCreationDeps['reader'];rpc?:RewardLedgerRpc;assertActive:()=>Promise<void>};
export const controllerTransactionRequest=z.union([
 z.object({action:z.literal('prepare'),kind:z.literal('factory')}).strict(),
 z.object({action:z.literal('prepare'),kind:z.literal('distribution'),setupId:z.string().uuid(),approvalId:z.string().uuid(),expectedDocumentHash:z.string().regex(/^[0-9a-f]{64}$/).optional()}).strict(),
 z.object({action:z.literal('submit'),id:z.string().uuid(),signedTransaction:hex.max(250000)}).strict(),
 z.object({action:z.literal('resume'),id:z.string().uuid()}).strict(),
]);
export function controllerFactoryId(actor:Actor){const h=createHash('sha256').update(`${actor.subject}:${actor.wallet}:${sponsorFactoryBuild.creationCodeHash}`).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;}
const decode=(v:unknown)=>v===null?null:job.parse(v);
const publicJob=(j:Job|null)=>j?{id:j.id,context:j.context,transaction:j.transaction,hash:j.hash,confirmed:j.confirmed,factory:j.context.kind==='factory'?getContractAddress({from:j.sender as Hex,nonce:BigInt(j.transaction.nonce)}).toLowerCase():null}:null;
async function read(d:Deps,id?:string){return decode(await rewardControllerTransaction(d.actor,'read',{id},d.rpc));}
export async function controllerTransactionStatus(d:Deps){
 await d.assertActive();
 const [pending,factory]=await Promise.all([read(d),read(d,controllerFactoryId(d.actor))]);
 for(const j of [pending,factory])if(j&&(j.subject!==d.actor.subject||j.sender!==d.actor.wallet))throw Error('controller_scope_required');
 // Diagnostic only: a consumed nonce is neither this request's receipt nor authority to release it.
 let nonceStatus:null|{state:'unused'|'pending'|'consumed'|'unavailable';finalizedNonce:string|null;pendingNonce:string|null;observedAt:string|null}=null;
 if(pending){
  nonceStatus={state:'unavailable',finalizedNonce:null,pendingNonce:null,observedAt:null};
  try{
   if(await d.reader.getChainId()!==10143)throw Error('controller_chain_unavailable');
   const address=pending.sender as Hex;
   const finalized=await d.reader.getTransactionCount({address,blockTag:'finalized'});
   const queued=await d.reader.getTransactionCount({address,blockTag:'pending'});
   if(!Number.isSafeInteger(finalized)||!Number.isSafeInteger(queued)||finalized<0||queued<finalized)throw Error('controller_chain_unavailable');
   const reserved=BigInt(pending.transaction.nonce);
   nonceStatus={state:BigInt(finalized)>reserved?'consumed':BigInt(queued)>reserved?'pending':'unused',finalizedNonce:String(finalized),pendingNonce:String(queued),observedAt:new Date().toISOString()};
  }catch{/* Keep the reservation visible when the public provider cannot be checked. */}
 }
 await d.assertActive();return {pending:publicJob(pending),factory:publicJob(factory),nonceStatus};
}
async function currentDistribution(d:Deps,setupId:string,approvalId:string){
 const raw=await rewardControllerFacts(d.actor,{setupId,approvalId},undefined,d.rpc);
 const slot=z.object({upload:z.object({document:z.object({slot:z.number().int().min(0).max(5)})})}).parse(raw).upload.document.slot;
 const facts=decodeSponsorLifecycleFactsV4(raw,{chainId:10143,setupId,approvalId,slot});
 if(!facts.publication?.current||!facts.upload.current||facts.upload.execution.plan.operator!==d.actor.wallet)throw Error('controller_source_not_ready');
 const binding=sponsorLifecycleInputV4(facts);
 const source=canonical({upload:facts.upload,publication:facts.publication});
 return {binding,source};
}
async function distribution(d:Deps,setupId:string,approvalId:string){
 const {binding,source}=await currentDistribution(d,setupId,approvalId);
 const observed=await observeSponsorLifecycleV4(d.reader,binding);
 if((await currentDistribution(d,setupId,approvalId)).source!==source)throw Error('controller_source_not_ready');
 return {binding,observed,source};
}
function verifyJob(d:Deps,j:Job){
 if(j.subject!==d.actor.subject||j.sender!==d.actor.wallet)throw Error('controller_scope_required');
 const t=j.transaction,c=j.context;
 if(BigInt(t.gas)<=0n||BigInt(t.gas)>30_000_000n||BigInt(t.gasPrice)<=0n||!Number.isSafeInteger(Number(t.nonce)))throw Error('controller_transaction_invalid');
 if(BigInt(t.gas)*BigInt(t.gasPrice)>(c.kind==='factory'?3_000_000_000_000_000_000n:500_000_000_000_000_000n))throw Error('controller_gas_limit');
 if(c.kind==='factory'){if(t.to||t.data!==sponsorFactoryBuild.bytecode)throw Error('controller_transaction_invalid');}
}
function verifyDistributionBinding(j:Job,f:Awaited<ReturnType<typeof currentDistribution>>){
 const c=j.context,t=j.transaction;
 if(c.kind!=='distribution'||c.source!==f.source||t.to!==f.binding.campaignAddress||t.data!==sponsorLifecycleDataV4(f.binding,c.action,c.start,c.end))throw Error('controller_source_not_ready');
}
async function verifyContext(d:Deps,j:Job,requireNext:boolean){
 verifyJob(d,j);const c=j.context;
 if(c.kind==='distribution'){const f=await distribution(d,c.setupId,c.approvalId);
  verifyDistributionBinding(j,f);
  if(requireNext&&(f.observed.next!==c.action||f.observed.start!==c.start||f.observed.end!==c.end))throw Error('controller_source_not_ready');
 }
 await d.assertActive();if(await d.reader.getChainId()!==10143)throw Error('controller_chain_unavailable');
}
async function checkBytes(j:Job,bytes:string){
 const serialized=bytes as TransactionSerialized,p=parseTransaction(serialized),t=j.transaction;
 if(p.type!=='legacy'||p.chainId!==10143||(p.to?.toLowerCase()??undefined)!==t.to||p.data!==t.data||(p.value??0n)!==0n||p.nonce!==Number(t.nonce)||p.gas!==BigInt(t.gas)||p.gasPrice!==BigInt(t.gasPrice)||(await recoverTransactionAddress({serializedTransaction:serialized})).toLowerCase()!==j.sender)throw Error('controller_transaction_invalid');
 return keccak256(serialized);
}
function checkReviewedSource(source:string,expectedDocumentHash:string|undefined){
 if(expectedDocumentHash===undefined)return; // Compatibility with existing clients.
 try{if(JSON.parse(source)?.upload?.documentHash===expectedDocumentHash)return;}catch{/* Fail closed. */}
 throw Error('controller_source_not_ready');
}
export async function advanceControllerTransaction(d:Deps,input:unknown){
 const r=controllerTransactionRequest.parse(input);await d.assertActive();if(await d.reader.getChainId()!==10143)throw Error('controller_chain_unavailable');
 if(r.action==='prepare'){
  const existing=r.kind==='factory'?await read(d,controllerFactoryId(d.actor)):await read(d);
  if(existing){if(existing.context.kind!==r.kind||r.kind==='distribution'&&(existing.context.kind!=='distribution'||existing.context.setupId!==r.setupId||existing.context.approvalId!==r.approvalId))throw Error('controller_transaction_pending');
   if(r.kind==='distribution'&&existing.context.kind==='distribution')checkReviewedSource(existing.context.source,r.expectedDocumentHash);
   await verifyContext(d,existing,!existing.hash);return publicJob(existing);}
  let c:Job['context'],to:Hex|undefined,data:Hex;
  if(r.kind==='factory'){c={kind:'factory',build:sponsorFactoryBuild.creationCodeHash};data=sponsorFactoryBuild.bytecode;}
  else {const f=await distribution(d,r.setupId,r.approvalId);checkReviewedSource(f.source,r.expectedDocumentHash);if(!f.observed.next)throw Error('controller_source_not_ready');
   c={kind:'distribution',setupId:r.setupId,approvalId:r.approvalId,action:f.observed.next,start:f.observed.start,end:f.observed.end,source:f.source};to=f.binding.campaignAddress;data=sponsorLifecycleDataV4(f.binding,c.action,c.start,c.end);}
  const [estimated,price,nonce,balance]=await Promise.all([d.reader.estimateGas({account:d.actor.wallet as Hex,...(to?{to}:{}),data,value:0n}),d.reader.getGasPrice(),d.reader.getTransactionCount({address:d.actor.wallet as Hex,blockTag:'pending'}),d.reader.getBalance({address:d.actor.wallet as Hex,blockTag:'pending'})]);
  const gas=(estimated*12n+9n)/10n,transaction={chainId:10143 as const,...(to?{to}:{}),data,value:'0' as const,nonce:String(nonce),gas:String(gas),gasPrice:String(price)};
  if(balance<gas*price)throw Error('controller_balance_required');
  const candidate:Job={id:r.kind==='factory'?controllerFactoryId(d.actor):randomUUID(),subject:d.actor.subject,sender:d.actor.wallet,context:c,transaction,signedTransaction:null,hash:null,confirmed:false};
  // Gas estimation already follows a full fresh observation. Before reserving,
  // recheck source/authority and fees; the reserved job still gets a full new
  // next-action observation below, including a concurrent on-chain change.
  verifyJob(d,candidate);
  if(c.kind==='distribution')verifyDistributionBinding(candidate,await currentDistribution(d,c.setupId,c.approvalId));
  await d.assertActive();if(await d.reader.getChainId()!==10143)throw Error('controller_chain_unavailable');
  const reserved=decode(await rewardControllerTransaction(d.actor,'reserve',{id:candidate.id,context:c,transaction},d.rpc));if(!reserved)throw Error('controller_transaction_invalid');await verifyContext(d,reserved,true);return publicJob(reserved);
 }
 let j=await read(d,r.id);if(!j)throw Error('controller_transaction_invalid');
 if(j.confirmed)return publicJob(j);
 if(r.action==='submit'){
  const hash=await checkBytes(j,r.signedTransaction);await verifyContext(d,j,!j.hash);
  j=decode(await rewardControllerTransaction(d.actor,'signed',{id:j.id,signed:r.signedTransaction,hash},d.rpc))!;
 }
 if(!j.hash||!j.signedTransaction)throw Error('controller_confirmation_required');
 if(await checkBytes(j,j.signedTransaction)!==j.hash)throw Error('controller_transaction_invalid');
 let receipt;try{receipt=await d.reader.getTransactionReceipt({hash:j.hash as Hex});}catch{/* Exact bytes can be retried. */}
 if(receipt){
  if(receipt.transactionHash.toLowerCase()!==j.hash)throw Error('controller_transaction_invalid');
  if(receipt.status!=='success')throw Error('controller_transaction_reverted');
  const finalized=await d.reader.getBlock({blockTag:'finalized'});if(finalized.number===null||finalized.number<receipt.blockNumber)return publicJob(j);
  verifyJob(d,j);
  if(j.context.kind==='factory'){
   await verifyContext(d,j,false);
   const factory=getContractAddress({from:j.sender as Hex,nonce:BigInt(j.transaction.nonce)});
   const chainTx=await d.reader.getTransaction({hash:j.hash as Hex}),block=await d.reader.getBlock({blockNumber:receipt.blockNumber});
   if(chainTx.chainId!==10143||chainTx.hash.toLowerCase()!==j.hash||receipt.from.toLowerCase()!==j.sender||chainTx.blockHash!==receipt.blockHash||chainTx.blockNumber!==receipt.blockNumber||chainTx.transactionIndex!==receipt.transactionIndex||block.hash!==receipt.blockHash)throw Error('controller_transaction_invalid');
   if(receipt.contractAddress?.toLowerCase()!==factory.toLowerCase()||receipt.to!==null||chainTx.from.toLowerCase()!==j.sender||chainTx.to!==null||chainTx.input!==sponsorFactoryBuild.bytecode||chainTx.nonce!==Number(j.transaction.nonce)||chainTx.value!==0n)throw Error('controller_transaction_invalid');
   await verifySponsorFactory(d.reader,factory,10143,receipt.blockNumber);await verifySponsorFactory(d.reader,factory);
  }else {const c=j.context,f=await currentDistribution(d,c.setupId,c.approvalId);
   verifyDistributionBinding(j,f);
   // The receipt verifier performs the full fresh runtime/state/finality check.
   // Do not repeat that same observation twice before invoking it. Source facts
   // are fenced on both sides of its network IO before the receipt is recorded.
   const body=await verifySponsorActionReceiptV4(d.reader,f.binding,{action:c.action,start:c.start,end:c.end},j.hash as Hex);
   if((await currentDistribution(d,c.setupId,c.approvalId)).source!==f.source)throw Error('controller_source_not_ready');
   await d.assertActive();await rewardControllerFacts(d.actor,{setupId:c.setupId,approvalId:c.approvalId},{requestId:j.id,receipt:copy(body)},d.rpc);}
  await d.assertActive();return publicJob(decode(await rewardControllerTransaction(d.actor,'confirm',{id:j.id,hash:j.hash},d.rpc)));
 }
 await verifyContext(d,j,true);
 if(await d.reader.getBalance({address:j.sender as Hex,blockTag:'pending'})<BigInt(j.transaction.gas)*BigInt(j.transaction.gasPrice))throw Error('controller_balance_required');
 try{await d.reader.sendRawTransaction({serializedTransaction:j.signedTransaction as Hex});}catch{/* Keep the same hash/nonce after an ambiguous response. */}
 return publicJob(j);
}
