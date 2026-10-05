import { encodeAbiParameters,encodeEventTopics,type Hex,type Transaction,type TransactionReceipt } from "viem";
import { rewardCampaignAbi } from "./abi.js";
import { requireLiveRewardClaim } from "./claims.js";
import { verifyRewardRuntime } from "./deployment.js";
import { encodeRewardAthletePayment,normalizeRewardAthletePaymentPlan,type RewardAthletePaymentPlan } from "./payments.js";
import { bytes32,demand,uint,walletAddress } from "./validation.js";

export type RewardAthletePaymentObservation={observedChainId:number;transaction:Transaction;receipt:TransactionReceipt;
  canonicalPaymentBlock:{number:bigint;hash:Hex;timestamp:bigint};finalizedBlock:{number:bigint;hash:Hex;timestamp:bigint};runtimeCode:Hex};

/** The hash must come from a verified stored signed attempt. This synchronous
 * exact-receipt validator is not RPC consensus, signature recovery or a DB commit.
 * EOA athlete path only: a successful claim emits exactly one vault event. */
export function rewardAthletePaymentFromObservation(input:RewardAthletePaymentPlan,transactionHash:Hex,observed:RewardAthletePaymentObservation){
  const p=normalizeRewardAthletePaymentPlan(input);const encoded=encodeRewardAthletePayment(p);const hash=bytes32(transactionHash);
  const {receipt:r,transaction:tx}=observed;const block={number:uint(observed.canonicalPaymentBlock.number),hash:bytes32(observed.canonicalPaymentBlock.hash),
    timestamp:uint(observed.canonicalPaymentBlock.timestamp)};const finalizedBlock={number:uint(observed.finalizedBlock.number),hash:bytes32(observed.finalizedBlock.hash),timestamp:uint(observed.finalizedBlock.timestamp)};
  demand(observed.observedChainId===encoded.chainId&&tx.chainId===encoded.chainId,"reward_payment_transaction_chain_mismatch");
  demand(r.status==="success","reward_payment_reverted");
  demand(bytes32(r.transactionHash)===hash&&bytes32(tx.hash)===hash,"reward_payment_transaction_mismatch");
  demand(r.to!==null&&tx.to!==null&&walletAddress(r.to)===encoded.to&&walletAddress(tx.to)===encoded.to&&r.contractAddress===null,"reward_payment_destination_mismatch");
  demand(walletAddress(r.from)===p.relayerAddress&&walletAddress(tx.from)===p.relayerAddress,"reward_payment_sender_mismatch");
  demand(Number.isSafeInteger(tx.nonce)&&tx.nonce===encoded.nonce,"reward_payment_nonce_mismatch");
  demand(tx.type==="eip1559"&&tx.value===0n&&tx.input===encoded.data&&(tx.accessList?.length??0)===0,"reward_payment_input_mismatch");
  demand(r.blockNumber===block.number&&bytes32(r.blockHash)===block.hash&&tx.blockNumber===block.number&&tx.blockHash!==null&&bytes32(tx.blockHash)===block.hash
    &&Number.isSafeInteger(r.transactionIndex)&&r.transactionIndex>=0&&tx.transactionIndex===r.transactionIndex,"reward_payment_receipt_mismatch");
  demand(block.number<=finalizedBlock.number&&block.timestamp<=finalizedBlock.timestamp,"reward_payment_not_finalized");
  demand(block.number!==finalizedBlock.number||(block.hash===finalizedBlock.hash&&block.timestamp===finalizedBlock.timestamp),"reward_payment_not_canonical");
  // Receipt-time validity, not current-time validity. Later expiry cannot erase
  // a successful payment. The exact pinned contract enforces its campaign clock.
  requireLiveRewardClaim(p.deployment.context,p.claim,block.timestamp,p.claim.expiresAt);
  const runtimeCodeHash=verifyRewardRuntime(p.deployment,observed.runtimeCode);
  const topics=encodeEventTopics({abi:rewardCampaignAbi,eventName:"RewardPaid",args:{entitlementId:p.claim.entitlementId,recipient:p.claim.recipient,pot:p.claim.pot==="race"?0:1}});
  const data=encodeAbiParameters([{type:"uint256"},{type:"uint256"}],[p.claim.amount,p.claim.nonce]);
  demand(Array.isArray(r.logs)&&r.logs.length===1,"reward_payment_event_count_mismatch");
  const log=r.logs[0];demand(log.removed===false&&log.logIndex!==null&&Number.isSafeInteger(log.logIndex)&&log.logIndex>=0,"invalid_reward_payment_log");
  demand(log.blockNumber===block.number&&log.blockHash===block.hash&&log.transactionHash===hash&&log.transactionIndex===r.transactionIndex,"reward_payment_log_receipt_mismatch");
  demand(walletAddress(log.address)===encoded.to&&log.data.toLowerCase()===data&&log.topics.length===topics.length
    &&log.topics.every((topic,i)=>topic.toLowerCase()===topics[i]),"reward_payment_event_mismatch");
  demand(tx.gas>0n&&uint(r.gasUsed)<=tx.gas&&tx.maxFeePerGas!==undefined&&uint(r.effectiveGasPrice)<=tx.maxFeePerGas,"reward_payment_gas_mismatch");
  return{schemaVersion:1 as const,action:"pay_athlete" as const,chainId:encoded.chainId,contractAddress:encoded.to.toLowerCase() as Hex,
    relayerAddress:p.relayerAddress.toLowerCase() as Hex,transactionHash:hash,nonce:p.nonce,blockNumber:block.number,blockHash:block.hash,
    blockTimestamp:block.timestamp,logIndex:log.logIndex,entitlementId:p.claim.entitlementId,recipient:p.claim.recipient.toLowerCase() as Hex,
    amount:p.claim.amount,pot:p.claim.pot,authorizationNonce:p.claim.nonce,allocationDigest:p.claim.allocationDigest,
    // Monad charges the signed gas LIMIT, not Ethereum's refunded gas-used
    // quantity. Preserve both; this formula is not a measured account debit.
    gasLimit:tx.gas,gasUsed:r.gasUsed,effectiveGasPrice:r.effectiveGasPrice,
    monadGasLimitFee:uint(tx.gas*r.effectiveGasPrice),runtimeCodeHash,finalizedBlock};
}
