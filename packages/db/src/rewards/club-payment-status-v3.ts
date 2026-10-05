import { createAdminSupabaseClient } from "../supabase.js";
import { RewardLedgerStoreError,copyRewardLedgerDocument as copy,type RewardLedgerRpc } from "./programme-ledger.js";
import { rewardDocumentObject as object,rewardDocumentUuid as uuid,rewardDocumentInteger as uint } from "./stored-documents.js";
import type { ClubClaimScopeV3 } from "./club-claims-v3.js";
import type { RewardAccountIdentity } from "./athlete-wallets.js";
function check(v:unknown):asserts v {if(!v)throw new RewardLedgerStoreError("invalid_reward_payment_status_v3");}
const hash=(v:unknown)=>{check(typeof v==="string" && /^0x[0-9a-f]{64}$/.test(v) && BigInt(v)!==0n);return v;};
export function decodeClubPaymentStatusV3(raw:unknown,s:ClubClaimScopeV3){
  const v=object(raw,["schema","chainId","uploadId","requestId","entitlementId","claimId","recipientAddress","amountWei","paymentId","state",
    "transactionHash","confirmed","blockNumber","blockHash","readinessHeld"]);
  check(v.schema==="raceson-club-payment-status-v3" && v.chainId===s.chainId && v.uploadId===s.uploadId && v.requestId===s.requestId
    && v.entitlementId===s.entitlementId && v.claimId===s.claimId && typeof v.recipientAddress==="string" && /^0x[0-9a-f]{40}$/.test(v.recipientAddress)
    && BigInt(v.recipientAddress)!==0n && uint(v.amountWei)>0n && typeof v.confirmed==="boolean" && typeof v.readinessHeld==="boolean"
    && typeof v.state==="string" && ["not_prepared","prepared","signed","queued","leased","broadcasting","submitted","confirmed"].includes(v.state));
  const paymentId=v.paymentId===null?null:uuid(v.paymentId),transactionHash=v.transactionHash===null?null:hash(v.transactionHash);
  check((v.state==="not_prepared")===(paymentId===null) && (["not_prepared","prepared"].includes(v.state))===(transactionHash===null)
    && (v.state==="confirmed")===v.confirmed && (v.blockNumber!==null)===v.confirmed && (v.blockHash!==null)===v.confirmed);
  if(v.confirmed){check(uint(v.blockNumber)>0n);hash(v.blockHash);}
  return {schema:"raceson-club-payment-status-v3" as const,chainId:s.chainId,uploadId:s.uploadId,requestId:s.requestId,
    entitlementId:s.entitlementId,claimId:s.claimId,recipientAddress:v.recipientAddress,amountWei:v.amountWei as string,paymentId,state:v.state,
    transactionHash,confirmed:v.confirmed,blockNumber:v.blockNumber as string|null,blockHash:v.blockHash as string|null,readinessHeld:v.readinessHeld};
}
export async function readClubPaymentStatusV3(actor:RewardAccountIdentity,input:ClubClaimScopeV3,rpc?:RewardLedgerRpc){
  const a={userId:uuid(actor.userId),sessionId:uuid(actor.sessionId)},s={chainId:input.chainId,uploadId:uuid(input.uploadId),requestId:uuid(input.requestId),
    entitlementId:hash(input.entitlementId),claimId:uuid(input.claimId),role:input.role};check([31337,10143].includes(s.chainId)&&["operator","recipient"].includes(s.role));
  const args={p_actor_user_id:a.userId,p_actor_session_id:a.sessionId,p_chain_id:s.chainId,p_upload_id:s.uploadId,p_request_id:s.requestId,
    p_entitlement_id:s.entitlementId,p_claim_id:s.claimId,p_role:s.role};
  let r;try{r=await(rpc??((name,body)=>createAdminSupabaseClient().rpc(name,body)))("service_read_reward_club_payment_status_v3",args);}
  catch{throw new RewardLedgerStoreError("reward_ledger_unavailable");}
  if(r.error){const m=(r.error as {message?:unknown}).message;throw new RewardLedgerStoreError(typeof m==="string" &&
    ["reward_account_session_required","reward_club_readiness_scope_required","reward_claim_scope_required"].includes(m)?m:"reward_ledger_unavailable");}
  return decodeClubPaymentStatusV3(copy(r.data),s);
}
