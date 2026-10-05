import { encodeAbiParameters, encodeEventTopics, type Hex, type Transaction, type TransactionReceipt } from "viem";
import { rewardCampaignAbi } from "./abi.js";
import { encodeRewardLifecycle, normalizeRewardLifecyclePlan, rewardLifecycleClocks, type RewardLifecyclePlan } from "./lifecycle.js";
import { verifyRewardRuntime } from "./deployment.js";
import { bytes32, demand, uint, walletAddress } from "./validation.js";

export type RewardLifecycleObservation={observedChainId:number;transaction:Transaction;receipt:TransactionReceipt;runtimeCode:Hex;
  canonicalActionBlock:{number:bigint;hash:Hex;timestamp:bigint};finalizedBlock:{number:bigint;hash:Hex;timestamp:bigint}};

/** Exact successful action receipt, not a permission grant or current claimability.
 * transactionHash must come from the cryptographically verified saved attempt. */
export function rewardLifecycleFromObservation(input:RewardLifecyclePlan,transactionHash:Hex,observed:RewardLifecycleObservation) {
  const p=normalizeRewardLifecyclePlan(input);const encoded=encodeRewardLifecycle(p);const u=p.upload;const hash=bytes32(transactionHash);
  const {transaction:tx,receipt}=observed;
  demand(observed.observedChainId===encoded.chainId && tx.chainId===encoded.chainId,"reward_lifecycle_transaction_chain_mismatch");
  demand(receipt.status==="success","reward_lifecycle_reverted");
  demand(bytes32(receipt.transactionHash)===hash && bytes32(tx.hash)===hash,"reward_lifecycle_transaction_mismatch");
  demand(receipt.to!==null && tx.to!==null && walletAddress(receipt.to)===encoded.to && walletAddress(tx.to)===encoded.to
    && receipt.contractAddress===null,"reward_lifecycle_destination_mismatch");
  demand(walletAddress(receipt.from)===p.deployment.operatorAddress && walletAddress(tx.from)===p.deployment.operatorAddress,"reward_lifecycle_sender_mismatch");
  demand(Number.isSafeInteger(tx.nonce) && tx.nonce===encoded.nonce,"reward_lifecycle_nonce_mismatch");
  demand(tx.type==="eip1559" && tx.value===0n && tx.input===encoded.data && (tx.accessList?.length??0)===0,"reward_lifecycle_input_mismatch");
  const blockNumber=uint(receipt.blockNumber);const blockHash=bytes32(receipt.blockHash);const blockTimestamp=uint(observed.canonicalActionBlock.timestamp);
  const finalizedBlock={number:uint(observed.finalizedBlock.number),hash:bytes32(observed.finalizedBlock.hash),timestamp:uint(observed.finalizedBlock.timestamp)};
  demand(tx.blockNumber===blockNumber && tx.blockHash!==null && bytes32(tx.blockHash)===blockHash
    && Number.isSafeInteger(receipt.transactionIndex) && receipt.transactionIndex>=0 && tx.transactionIndex===receipt.transactionIndex,"reward_lifecycle_receipt_mismatch");
  demand(blockNumber<=finalizedBlock.number && blockTimestamp<=finalizedBlock.timestamp,"reward_lifecycle_not_finalized");
  demand(observed.canonicalActionBlock.number===blockNumber && bytes32(observed.canonicalActionBlock.hash)===blockHash
    && (blockNumber!==finalizedBlock.number || (blockHash===finalizedBlock.hash && blockTimestamp===finalizedBlock.timestamp)),"reward_lifecycle_not_canonical");
  const runtimeCodeHash=verifyRewardRuntime(p.deployment,observed.runtimeCode);
  const activationNotBefore=p.action==="stage_allocation" ? (u.latestPublicationAt+rewardLifecycleClocks.publicationReview>blockTimestamp+rewardLifecycleClocks.allocationReview
    ?u.latestPublicationAt+rewardLifecycleClocks.publicationReview:blockTimestamp+rewardLifecycleClocks.allocationReview) :null;
  const claimDeadline=p.action==="activate"?blockTimestamp+rewardLifecycleClocks.claimLifetime:null;
  if(p.action==="stage_allocation")demand(u.latestPublicationAt<=blockTimestamp,"reward_lifecycle_publication_in_future");
  const expected=p.action==="upload_awards" ? u.awards.slice(p.batchStart,p.batchStart+p.batchSize).map(award=>({
    topics:encodeEventTopics({abi:rewardCampaignAbi,eventName:"AwardUploaded",args:{entitlementId:award.entitlementId,beneficiaryId:award.beneficiaryId,pot:award.pot}}),
    data:encodeAbiParameters([{type:"uint256"},{type:"bytes32"},{type:"uint8"}],[award.amount,award.explanationHash,award.beneficiaryKind])
  })) :p.action==="stage_allocation" ? [{
    topics:encodeEventTopics({abi:rewardCampaignAbi,eventName:"AllocationStaged",args:{allocationDigest:u.allocationDigest,snapshotDigest:u.snapshotDigest}}),
    data:encodeAbiParameters([{type:"uint256"},{type:"uint256"}],[u.entitlementCount,activationNotBefore!])
  }] : [{topics:encodeEventTopics({abi:rewardCampaignAbi,eventName:"Activated",args:{allocationDigest:u.allocationDigest}}),
    data:encodeAbiParameters([{type:"uint256"}],[claimDeadline!])}];
  demand(Array.isArray(receipt.logs) && receipt.logs.length===expected.length,"reward_lifecycle_event_count_mismatch");
  let previous=-1;
  for(let i=0;i<expected.length;i++) {
    const log=receipt.logs[i];const e=expected[i];
    demand(log.removed===false && log.logIndex!==null && Number.isSafeInteger(log.logIndex) && log.logIndex>previous,"invalid_reward_lifecycle_log");
    demand(log.blockNumber===blockNumber && log.blockHash===blockHash && log.transactionHash===hash && log.transactionIndex===receipt.transactionIndex,
      "reward_lifecycle_log_receipt_mismatch");
    demand(walletAddress(log.address)===encoded.to && log.data.toLowerCase()===e.data && log.topics.length===e.topics.length
      && log.topics.every((topic,index)=>topic.toLowerCase()===e.topics[index]),"reward_lifecycle_event_mismatch");
    previous=log.logIndex;
  }
  return {schemaVersion:1 as const,action:p.action,chainId:encoded.chainId,contractAddress:encoded.to.toLowerCase() as Hex,
    operatorAddress:p.deployment.operatorAddress.toLowerCase() as Hex,transactionHash:hash,nonce:p.nonce,blockNumber,blockHash,blockTimestamp,
    firstLogIndex:receipt.logs[0].logIndex!,lastLogIndex:previous,batchStart:p.action==="upload_awards"?p.batchStart:null,
    batchSize:p.action==="upload_awards"?p.batchSize:null,allocationDigest:u.allocationDigest,activationNotBefore,claimDeadline,runtimeCodeHash,finalizedBlock};
}
