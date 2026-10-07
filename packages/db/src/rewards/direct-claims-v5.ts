import {decodeSponsorExecutionPlan} from '@raceson/domain/rewards/sponsor-execution';
import {rewardDocumentObject as object,rewardDocumentUuid as uuid} from './stored-documents.js';
import {decodeRewardWalletChallenge,type RewardAccountIdentity} from './athlete-wallets.js';
import {RewardLedgerStoreError,copyRewardLedgerDocument as copy,type RewardLedgerRpc} from './programme-ledger.js';
const hex=(x:unknown):x is `0x${string}`=>typeof x==='string'&&/^0x[0-9a-f]{64}$/.test(x)&&BigInt(x)!==0n;
export type DirectClaimReceiptV5={transactionHash:string;amountWei:string;recipient:string;blockNumber:string;blockHash:string};
export async function directClaimFactsV5(actor:RewardAccountIdentity,approvalId:string,entitlementId:string,rpc:RewardLedgerRpc,
 input:{proofId?:string;receipt?:DirectClaimReceiptV5}={}){
 const identity={userId:uuid(actor.userId),sessionId:uuid(actor.sessionId)},id=uuid(approvalId);
 if(!hex(entitlementId))throw new RewardLedgerStoreError('invalid_sponsor_claim');
 const r=await rpc('service_reward_demo_copy_direct_claim_v5',{p_user_id:identity.userId,p_session_id:identity.sessionId,
  p_approval_id:id,p_entitlement_id:entitlementId,p_proof_id:input.proofId?uuid(input.proofId):null,p_receipt:input.receipt??null});
 if(r.error){const code=String((r.error as {message?:unknown}).message);throw new RewardLedgerStoreError([
  'reward_account_session_required','reward_claim_scope_required','reward_sponsor_claim_not_ready','invalid_sponsor_claim',
  'reward_destination_proof_required','reward_wallet_challenge_expired','reward_sponsor_claim_conflict',
 ].includes(code)?code:'reward_ledger_unavailable');}
 const v=object(copy(r.data),['approvalId','slot','plan','deploymentHash','fundingHash','award','challenge','receipt','rehearsalPolicy']);
 const plan=decodeSponsorExecutionPlan(v.plan),award=object(v.award,['entitlementId','beneficiaryId','pot','amount','explanationHash','beneficiaryKind']);
 if(v.approvalId!==id||plan.version!==5||plan.chainId!==10143||!Number.isInteger(v.slot)||Number(v.slot)<0||Number(v.slot)>5
  ||!hex(v.deploymentHash)||!hex(v.fundingHash)||award.entitlementId!==entitlementId||!hex(award.beneficiaryId)||!hex(award.explanationHash)
  ||award.beneficiaryKind!==0||award.pot!==(v.slot===0?1:0)||typeof award.amount!=='string'||!/^[1-9][0-9]{0,24}$/.test(award.amount)
  ||v.rehearsalPolicy!=='podium-demo-alias-rehearsal-v1')throw new RewardLedgerStoreError('invalid_sponsor_claim');
 const challenge=v.challenge===null?null:decodeRewardWalletChallenge(v.challenge,identity);
 if(input.proofId&&(!challenge?.proof||challenge.proof.proofId!==input.proofId)||!input.proofId&&challenge!==null
  ||challenge&&(challenge.chainId!==10143||challenge.origin!=='https://podium.raceson.com'
   ||Date.parse(challenge.checkedAt)<Date.parse(challenge.issuedAt)||Date.parse(challenge.checkedAt)>=Date.parse(challenge.expiresAt)))throw new RewardLedgerStoreError('reward_destination_proof_required');
 let receipt:DirectClaimReceiptV5|null=null;
 if(v.receipt!==null){const p=object(v.receipt,['transactionHash','amountWei','recipient','blockNumber','blockHash']);
  if(!hex(p.transactionHash)||!hex(p.blockHash)||p.amountWei!==award.amount||typeof p.recipient!=='string'||!/^0x[0-9a-f]{40}$/.test(p.recipient)
   ||typeof p.blockNumber!=='string'||!/^\d+$/.test(p.blockNumber))throw new RewardLedgerStoreError('invalid_sponsor_claim');
  receipt=p as DirectClaimReceiptV5;}
 return {approvalId:id,scope:{plan,deploymentHash:v.deploymentHash,fundingHash:v.fundingHash,slot:Number(v.slot),entitlementId,
  beneficiaryId:award.beneficiaryId,beneficiaryKind:0 as const,amountWei:award.amount,explanationHash:award.explanationHash},challenge,receipt,
  rehearsalPolicy:'podium-demo-alias-rehearsal-v1' as const};
}
