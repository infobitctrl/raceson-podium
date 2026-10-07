import {randomUUID} from "node:crypto";
import {z} from "zod";
import {keccak256,parseTransaction,recoverTransactionAddress,type Hex,type PublicClient,type TransactionSerialized} from "viem";
import {rewardSponsorCreation,rewardSponsorCreationAvailable,rewardSponsorExecution,type RewardLedgerRpc,type RewardAccountIdentity} from "@raceson/db/rewards";
import {sponsorDeploymentData,sponsorFactoryData,verifySponsorFactory,observeSponsorProgramme,type SponsorChainReader,type SponsorChainObservation} from "@raceson/rewards-chain/sponsor-v4";
import type {SponsorExecutionRecord} from "@raceson/domain/rewards/sponsor-execution";

const uint=z.string().regex(/^(0|[1-9][0-9]*)$/),hex=z.string().regex(/^0x[0-9a-f]+$/),address=z.string().regex(/^0x[0-9a-f]{40}$/);
const txSchema=z.object({chainId:z.literal(10143),to:address.optional(),data:hex,value:z.literal("0"),nonce:uint,gas:uint,gasPrice:uint}).strict();
const jobSchema=z.object({sender:address,transaction:txSchema,signedTransaction:hex.nullable(),hash:z.string().regex(/^0x[0-9a-f]{64}$/).nullable(),leaseId:z.string().uuid(),leaseUntil:z.string(),confirmed:z.boolean()}).strict();
export type CreationTransaction=z.infer<typeof txSchema>;
type Job=z.infer<typeof jobSchema>;
export type SponsorCreationState={status:"unavailable"|"ready"|"processing"|"submitted"|"confirmed"|"failed";hash:string|null;reason:"configuration"|"capacity"|"gas"|"balance"|"connection"|"reverted"|"controller_busy"|null};
export type SponsorCreationSigner={address:string;factoryAddress?:Hex;verifyReady?:()=>Promise<void>;sign:(transaction:CreationTransaction)=>Promise<Hex>};
export type SponsorCreationDeps={reader:SponsorChainReader & Pick<PublicClient,"estimateGas"|"getGasPrice"|"getTransactionCount"|"sendRawTransaction">;signer:SponsorCreationSigner|null;rpc?:RewardLedgerRpc};
const cap=3_000_000_000_000_000_000n;
const decode=(v:unknown)=>v===null?null:jobSchema.parse(v);
const status=(status:SponsorCreationState["status"],reason:SponsorCreationState["reason"]=null,hash:string|null=null):SponsorCreationState=>({status,reason,hash});
export async function sponsorCreationStatus(identity:RewardAccountIdentity,id:string,record:SponsorExecutionRecord|null,configured:boolean,rpc?:RewardLedgerRpc,sender?:string):Promise<SponsorCreationState>{
 if(record?.deploymentHash)return status("confirmed",null,record.deploymentHash);
 if(!configured)return status("unavailable","configuration");
 if(!record)return status("ready");
 const job=decode(await rewardSponsorCreation(identity,id,{},rpc));
 if(!job&&sender&&!await rewardSponsorCreationAvailable(identity,id,sender.toLowerCase(),rpc))return status("unavailable","controller_busy");
 return !job?status("ready"):status(job.confirmed?"confirmed":job.hash?"submitted":"processing",null,job.hash);
}
/** Only exact server-built deployment transactions; no method/calldata supplied by a
 * caller, no oracle signature or deposit, and no new nonce on retry. */
export async function advanceSponsorCreation(identity:RewardAccountIdentity,id:string,record:SponsorExecutionRecord,deps:SponsorCreationDeps):Promise<SponsorCreationState & {observation?:SponsorChainObservation}>{
 if(record.deploymentHash)return status("confirmed",null,record.deploymentHash);
 const {reader,signer,rpc}=deps,plan=record.plan;
 if(!signer||plan.chainId!==10143)return status("unavailable","configuration");
 const sender=signer.address.toLowerCase();
 if(!address.safeParse(sender).success||/^0x0{40}$/.test(sender)||[plan.funder].includes(sender)||!signer.factoryAddress&&[plan.operator,plan.unallocatedTreasury,plan.expiredTreasury].includes(sender))return status("unavailable","configuration");
 const data=signer.factoryAddress?sponsorFactoryData(plan):sponsorDeploymentData(plan);
 const leaseId=randomUUID();let job:Job|null=null;
 try{
  if(await reader.getChainId()!==10143)throw Error("sponsor_creation_connection");
  await signer.verifyReady?.();
  job=decode(await rewardSponsorCreation(identity,id,{},rpc));
  if(job&&job.sender!==sender)return status("unavailable","configuration",job.hash);
  let transaction=job?.transaction;
  if(!transaction){
   if(signer.factoryAddress)await verifySponsorFactory(reader,signer.factoryAddress,10143,undefined,plan.version);
   const [estimate,price,balance,nonce]=await Promise.all([
    reader.estimateGas({account:sender as Hex,...(signer.factoryAddress?{to:signer.factoryAddress}:{}),data,value:0n}),reader.getGasPrice(),
    reader.getBalance({address:sender as Hex,blockTag:"pending"}),reader.getTransactionCount({address:sender as Hex,blockTag:"pending"}),
   ]);
   const gas=(estimate*12n+9n)/10n;
   if(gas<=0n||gas>30_000_000n||price<=0n||gas*price>cap)return status("failed","gas");
   if(balance<gas*price)return status("failed","balance");
   transaction={chainId:10143,...(signer.factoryAddress?{to:signer.factoryAddress}:{}),data,value:"0",nonce:String(nonce),gas:String(gas),gasPrice:String(price)};
  }
  // Recheck current ownership before reserving/signing. SQL repeats under locks.
  const fresh=await rewardSponsorExecution(identity,10143,id,undefined,rpc);
  if(fresh?.deploymentHash)return status("confirmed",null,fresh.deploymentHash);
  if(JSON.stringify(fresh?.plan)!==JSON.stringify(plan))throw Error("invalid_sponsor_creation");
  job=decode(await rewardSponsorCreation(identity,id,{action:"reserve",leaseId,sender,transaction},rpc));
  if(!job)return status("processing");
  if(job.leaseId!==leaseId)return status(job.hash?"submitted":"processing",null,job.hash);
  const tx=job.transaction;
  if(tx.data!==data||tx.to!==signer.factoryAddress||tx.value!=="0"||tx.chainId!==10143||BigInt(tx.gas)<=0n||BigInt(tx.gas)>30_000_000n||BigInt(tx.gasPrice)<=0n||BigInt(tx.gas)*BigInt(tx.gasPrice)>cap||!Number.isSafeInteger(Number(tx.nonce)))throw Error("invalid_sponsor_creation");
  const live=async()=>{
   if(Date.parse(job!.leaseUntil)<=Date.now()+2000||await reader.getChainId()!==10143)throw Error("sponsor_creation_lease");
   const current=await rewardSponsorExecution(identity,10143,id,undefined,rpc);
   if(current?.deploymentHash&&current.deploymentHash!==job!.hash||JSON.stringify(current?.plan)!==JSON.stringify(plan))throw Error("invalid_sponsor_creation");
  };
  if(!job.signedTransaction){
   await live();
   const signed=await signer.sign(tx);
   const parsed=parseTransaction(signed as TransactionSerialized),recovered=await recoverTransactionAddress({serializedTransaction:signed as TransactionSerialized});
   if(parsed.type!=="legacy"||parsed.chainId!==10143||(parsed.to?.toLowerCase()??undefined)!==tx.to||parsed.data!==tx.data||(parsed.value??0n)!==0n||parsed.nonce!==Number(tx.nonce)||parsed.gas!==BigInt(tx.gas)||parsed.gasPrice!==BigInt(tx.gasPrice)||recovered.toLowerCase()!==sender)throw Error("invalid_sponsor_creation");
   await live();
   job=decode(await rewardSponsorCreation(identity,id,{action:"signed",leaseId,signedTransaction:signed,hash:keccak256(signed)},rpc))!;
  }
  if(!job?.hash||!job.signedTransaction)throw Error("invalid_sponsor_creation");
  const bytes=job.signedTransaction as TransactionSerialized;
  const stored=parseTransaction(bytes),storedSender=await recoverTransactionAddress({serializedTransaction:bytes});
  if(keccak256(bytes)!==job.hash||stored.type!=="legacy"||stored.chainId!==10143||(stored.to?.toLowerCase()??undefined)!==tx.to||stored.data!==tx.data||(stored.value??0n)!==0n||stored.nonce!==Number(tx.nonce)||stored.gas!==BigInt(tx.gas)||stored.gasPrice!==BigInt(tx.gasPrice)||storedSender.toLowerCase()!==sender)throw Error("invalid_sponsor_creation");
  // Recovery first: a lost broadcast response never starts another deployment.
  try{
   const observed=await observeSponsorProgramme(reader,plan,job.hash as Hex);
   if(observed.deploymentHash===job.hash){await live();await rewardSponsorCreation(identity,id,{action:"confirm",leaseId,hash:job.hash},rpc);return {...status("confirmed",null,job.hash),observation:observed};}
  }catch{/* Pending/finality errors are not permission to change transaction bytes. */}
  let receipt;try{receipt=await reader.getTransactionReceipt({hash:job.hash as Hex});}catch{/* May not have broadcast. */}
  if(receipt)return receipt.status==="reverted"?status("failed","reverted",job.hash):status("submitted",null,job.hash);
  if(await reader.getBalance({address:sender as Hex,blockTag:"pending"})<BigInt(tx.gas)*BigInt(tx.gasPrice))return status("failed","balance",job.hash);
  await live();
  try{await reader.sendRawTransaction({serializedTransaction:job.signedTransaction as Hex});}catch{/* Retry only these exact journaled bytes, including after timeout. */}
  return status("submitted",null,job.hash);
 }catch(error){
  const code=error instanceof Error?error.message:"";
  if(["reward_account_session_required","reward_setup_not_found"].includes(code))throw error;
  if(code==="sponsor_creation_busy")return status("processing","controller_busy");
  return status("failed",code==="sponsor_creation_capacity"?"capacity":"connection",job?.hash??null);
 }
}
