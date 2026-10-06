import {hostedCopyClubCreationStore,type HostedClubCreation} from '@raceson/db/rewards';
import {prepareRewardClubSafeCreation,verifyRewardClubSafeCreation,rewardClubSafeCreationPlan,rewardClubSafeTestnetDependencies,
 rewardClubSafeDeploymentAbi,type RewardClubSafeCreationReader,type RewardClubSafeDeploymentReader,type RewardClubSafeCreationInput} from '@raceson/rewards-chain';
import type {Address,Hex} from 'viem';
type Store=ReturnType<typeof hostedCopyClubCreationStore>;
type Reader=RewardClubSafeCreationReader&RewardClubSafeDeploymentReader;
export type HostedClubCreationCommand={action:'request';requestId:string;clubId:string;proofId:string;owners:string[]}
 |{action:'prepare';proofId:string}|{action:'submitted'|'verify';transactionHash:Hex};
function input(record:HostedClubCreation):RewardClubSafeCreationInput{
 return{environment:'monad-testnet',chainId:10143,sender:record.sender as Address,owners:record.owners as Address[],saltNonce:BigInt(record.saltNonce),dependencies:{...rewardClubSafeTestnetDependencies}};
}
const publicValue=(value:unknown)=>JSON.parse(JSON.stringify(value,(_,v)=>typeof v==='bigint'?v.toString():v));
/** Session-bound intent and chain proof only. No provider signer, transaction
 * broadcast, nomination, owner attestation, prize consent or review activation. */
export async function hostedClubCreation(requestId:string,command:HostedClubCreationCommand|undefined,deps:{store:Store;reader:Reader}){
 const {store,reader}=deps;
 if(command?.action==='request'&&command.requestId!==requestId)throw Error('invalid_reward_club_creation');
 let record=command?.action==='request'?await store.request(command):await store.read(requestId);
 if(command?.action==='prepare'){
  record=await store.authorize(requestId,command.proofId);
  if(!record.current||record.verified||record.transactions.length)throw Error('reward_club_creation_recovery_required');
  const quote=await prepareRewardClubSafeCreation(reader,input(record));
  const current=await store.authorize(requestId,command.proofId);
  if(JSON.stringify(current)!==JSON.stringify(record)||!current.current)throw Error('reward_club_owner_required');
  return{schema:'podium-club-safe-creation-v1',record,prepared:publicValue(quote)};
 }
 if(command?.action==='submitted'||command?.action==='verify'){
  const hash=command.transactionHash.toLowerCase() as Hex;
  if(await reader.getChainId()!==10143)throw Error('reward_observed_chain_mismatch');
  const at=await reader.getBlock({blockTag:'finalized'});if(at.number===null||!at.hash)throw Error('reward_finalized_block_missing');
  const proxyCreation=await reader.readContract({address:rewardClubSafeTestnetDependencies.factoryAddress,abi:rewardClubSafeDeploymentAbi,functionName:'proxyCreationCode',blockNumber:at.number});
  const plan=rewardClubSafeCreationPlan(input(record),proxyCreation),tx=await reader.getTransaction({hash});
  if(tx.hash.toLowerCase()!==hash||tx.chainId!==10143||tx.from.toLowerCase()!==record.sender||tx.to?.toLowerCase()!==plan.factoryAddress.toLowerCase()||tx.value!==0n||tx.input.toLowerCase()!==plan.transaction.data)throw Error('reward_club_creation_intent_mismatch');
  if(await reader.getChainId()!==10143)throw Error('reward_observed_chain_mismatch');
  // A transaction hash supplied by the browser is recorded only after the
  // server sees this exact call. It still is not a deployment receipt.
  record=await store.submitted(requestId,hash);
  if(command.action==='verify'){
   const verified=await verifyRewardClubSafeCreation(reader,input(record),hash);
   record=await store.verified(requestId,{transactionHash:hash,safeAddress:verified.safe.context.verifyingContract.toLowerCase(),blockNumber:verified.deploymentBlock.number.toString(),blockHash:verified.deploymentBlock.hash,initializerHash:verified.initializerHash});
  }
 }
 return{schema:'podium-club-safe-creation-v1',record,prepared:null};
}
