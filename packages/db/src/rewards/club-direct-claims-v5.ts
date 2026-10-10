import {z} from 'zod';
import {decodeDirectClaimFactsV5,type DirectClaimReceiptV5} from './direct-claims-v5.js';
import type {RewardAccountIdentity} from './athlete-wallets.js';
import {RewardLedgerStoreError,type RewardLedgerRpc} from './programme-ledger.js';
const address=z.string().regex(/^0x[0-9a-f]{40}$/).refine(v=>BigInt(v)>1n),hash=z.string().regex(/^0x[0-9a-f]{64}$/),uuid=z.string().uuid();
const treasurySchema=z.object({creationId:uuid,clubId:uuid,owners:z.array(address).length(3),ownerDisplay:z.array(z.object({address,name:z.string().trim().min(1).max(1000)}).strict()).max(3).optional(),safeAddress:address,deploymentTransactionHash:hash}).strict();
export async function clubDirectClaimFactsV5(actor:RewardAccountIdentity,approvalId:string,entitlementId:string,creationId:string,rpc:RewardLedgerRpc,
 input:{proofId?:string;receipt?:DirectClaimReceiptV5}={}){
 const identity={userId:uuid.parse(actor.userId),sessionId:uuid.parse(actor.sessionId)};
 const r=await rpc('service_reward_demo_copy_club_direct_claim_display',{p_user_id:identity.userId,p_session_id:identity.sessionId,
  p_approval_id:uuid.parse(approvalId),p_entitlement_id:hash.parse(entitlementId),p_creation_id:uuid.parse(creationId),
  p_proof_id:input.proofId?uuid.parse(input.proofId):null,p_receipt:input.receipt??null});
 if(r.error){const code=String((r.error as {message?:unknown}).message);throw new RewardLedgerStoreError([
  'reward_account_session_required','reward_claim_scope_required','reward_sponsor_claim_not_ready','invalid_sponsor_claim',
  'reward_destination_proof_required','reward_wallet_challenge_expired','reward_sponsor_claim_conflict','reward_club_treasury_required','reward_club_owner_required',
 ].includes(code)?code:'reward_ledger_unavailable');}
 const {treasury,...rest}=z.object({treasury:treasurySchema}).passthrough().parse(r.data);
 if(treasury.creationId!==creationId||new Set(treasury.owners).size!==3||treasury.owners.includes(treasury.safeAddress))throw new RewardLedgerStoreError('invalid_sponsor_claim');
 if(treasury.ownerDisplay&&(new Set(treasury.ownerDisplay.map(o=>o.address)).size!==treasury.ownerDisplay.length||treasury.ownerDisplay.some(o=>!treasury.owners.includes(o.address))))throw new RewardLedgerStoreError('invalid_sponsor_claim');
 const facts=decodeDirectClaimFactsV5(rest,identity,approvalId,entitlementId,input.proofId,1);
 if(facts.challenge&&!treasury.owners.includes(facts.challenge.address)||facts.receipt&&facts.receipt.recipient!==treasury.safeAddress)throw new RewardLedgerStoreError('invalid_sponsor_claim');
 return {...facts,treasury};
}
