import { parseTransaction,type Hex } from "viem";
import { rewardCampaignAbi } from "./abi.js";
import { readVerifiedRewardCampaign,type RewardCampaignReader } from "./campaign-checkpoint.js";
import { requireRewardCreationBytecode } from "./deployment.js";
import { normalizeRewardAthletePaymentPlan,verifySignedRewardAthletePayment,type RewardAthletePaymentPlan } from "./payments.js";
import { rewardAthletePaymentFromObservation } from "./payment-receipts.js";
import { bytes32,demand,RewardProtocolError,walletAddress } from "./validation.js";

const sameSignatureScalar=(value:unknown,expected:Hex|undefined)=>typeof value==="string"&&/^0x[0-9a-fA-F]{1,64}$/.test(value)
  &&expected!==undefined&&BigInt(value)===BigInt(expected);

/** Read-only exact signed-attempt reconciliation. The selected RPC is trusted.
 * Current pause/expiry does not erase a historical receipt. No source/identity
 * approval, signing, broadcast, DB payment projection or execution lease here. */
export async function readVerifiedRewardAthletePayment(reader:RewardCampaignReader,input:RewardAthletePaymentPlan,signedTransaction:Hex,creationCode:Hex){
  const p=normalizeRewardAthletePaymentPlan(input);const code=requireRewardCreationBytecode(creationCode);
  try{
    const attempt=await verifySignedRewardAthletePayment(p,signedTransaction);
    const checkpoint=await readVerifiedRewardCampaign(reader,p.deployment,code);const f=checkpoint.observation.finalizedBlock;
    const [transaction,receipt]=await Promise.all([reader.getTransaction({hash:attempt.transactionHash}),reader.getTransactionReceipt({hash:attempt.transactionHash})]);
    demand(receipt.blockNumber<=f.number,"reward_payment_not_finalized");
    demand(receipt.blockNumber>=checkpoint.deployment.deploymentBlockNumber,"reward_payment_before_deployment");
    const signed=parseTransaction(attempt.signedTransaction);
    demand(transaction.gas===attempt.gasLimit&&transaction.maxFeePerGas===attempt.maxFeePerGas&&transaction.maxPriorityFeePerGas===attempt.maxPriorityFeePerGas
      // RPC scalar quantities may omit padding retained by viem's parsed
      // signature. Compare exact bounded scalar values, not hex presentation.
      &&sameSignatureScalar(transaction.r,signed.r)&&sameSignatureScalar(transaction.s,signed.s)
      &&transaction.yParity===signed.yParity,"reward_payment_signed_transaction_mismatch");
    const [block,runtimeCode,row]=await Promise.all([reader.getBlock({blockNumber:receipt.blockNumber}),
      reader.getCode({address:p.deployment.context.verifyingContract,blockNumber:f.number}),
      reader.readContract({address:p.deployment.context.verifyingContract,abi:rewardCampaignAbi,functionName:"entitlements",args:[p.claim.entitlementId],blockNumber:f.number})]);
    demand(block.number===receipt.blockNumber&&block.hash!==null,"reward_payment_not_canonical");
    demand(runtimeCode!==undefined,"reward_deployment_code_missing");
    const payment=rewardAthletePaymentFromObservation(p,attempt.transactionHash,{observedChainId:checkpoint.deployment.chainId,transaction,receipt,runtimeCode,
      canonicalPaymentBlock:{number:block.number,hash:block.hash,timestamp:block.timestamp},finalizedBlock:f});
    const u=p.upload;const a=checkpoint.observation.accounting;const award=u.awards.find(e=>e.entitlementId===p.claim.entitlementId)!;
    demand([3,4].includes(a.state)&&a.accountedFunding===u.budgets[u.enabledPot]&&a.budgets[u.enabledPot]===u.budgets[u.enabledPot]
      &&a.allocated[u.enabledPot]===u.allocated[u.enabledPot]&&a.paid[u.enabledPot]>=p.claim.amount&&a.entitlementCount===u.entitlementCount
      &&a.uploadDigest===u.uploadDigest&&a.snapshotDigest===u.snapshotDigest&&a.allocationDigest===u.allocationDigest,"reward_payment_checkpoint_mismatch");
    demand(bytes32(row[0])===award.beneficiaryId&&row[1]===p.claim.amount&&bytes32(row[2])===award.explanationHash&&row[3]===p.claim.nonce+1n
      &&walletAddress(row[4])===p.claim.recipient&&row[5]===award.pot&&row[6]===true&&row[7]===0,"reward_payment_award_mismatch");
    const [chainAfter,finalityAfter,checkpointAfter,paymentAfter]=await Promise.all([reader.getChainId(),reader.getBlock({blockTag:"finalized"}),
      reader.getBlock({blockNumber:f.number}),reader.getBlock({blockNumber:receipt.blockNumber})]);
    demand(chainAfter===attempt.chainId,"reward_observed_chain_mismatch");
    demand(finalityAfter.number!==null&&finalityAfter.hash!==null&&finalityAfter.number>=f.number,"reward_finality_regressed");
    demand(checkpointAfter.number===f.number&&checkpointAfter.hash!==null&&bytes32(checkpointAfter.hash)===f.hash&&checkpointAfter.timestamp===f.timestamp
      &&(finalityAfter.number!==f.number||bytes32(finalityAfter.hash)===f.hash)&&paymentAfter.number===receipt.blockNumber&&paymentAfter.hash!==null
      &&bytes32(paymentAfter.hash)===payment.blockHash&&paymentAfter.timestamp===payment.blockTimestamp,"reward_chain_changed_during_observation");
    return{payment,checkpoint};
  }catch(error){if(error instanceof RewardProtocolError)throw error;throw new RewardProtocolError("reward_payment_observation_unavailable");}
}
