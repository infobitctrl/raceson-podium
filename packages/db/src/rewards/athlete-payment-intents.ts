import { parseRewardSourceTimestamp } from "@raceson/domain/rewards";
import { createAdminSupabaseClient } from "../supabase.js";
import { copyRewardLedgerDocument as copy,RewardLedgerStoreError,type RewardLedgerRpc } from "./programme-ledger.js";
import { rewardDocumentObject as object,rewardDocumentUuid as uuid,rewardDocumentInteger as integer } from "./stored-documents.js";
import { decodeRewardAthleteClaimProofContext } from "./athlete-claim-proofs.js";
import { decodeRewardClaimWitness } from "./athlete-claims.js";
import type { RewardAccountIdentity } from "./athlete-wallets.js";

function demand(value:unknown):asserts value {if(!value)throw new RewardLedgerStoreError("invalid_reward_payment_document");}
const same=(a:unknown,b:unknown)=>JSON.stringify(copy(a))===JSON.stringify(copy(b));
function key(value:unknown):string{demand(typeof value==="string"&&value.length>=8&&value.length<=128);return value;}
function timestamp(value:unknown):string{parseRewardSourceTimestamp(value);return value as string;}
function hash(value:unknown):`0x${string}`{demand(typeof value==="string"&&/^0x[0-9a-f]{64}$/.test(value)&&BigInt(value)>0n);return value as `0x${string}`;}
function address(value:unknown):`0x${string}`{demand(typeof value==="string"&&/^0x[0-9a-f]{40}$/.test(value)&&BigInt(value)>0n);return value as `0x${string}`;}
function nonce(value:unknown){const n=integer(value);demand(n<=BigInt(Number.MAX_SAFE_INTEGER));return n;}
type Scope={identity:RewardAccountIdentity;claimIntentId:string};
const scope=(identity:RewardAccountIdentity,claimIntentId:string):Scope=>({identity:{userId:uuid(identity.userId),sessionId:uuid(identity.sessionId)},claimIntentId:uuid(claimIntentId)});
const args=(s:Scope)=>({p_actor_user_id:s.identity.userId,p_actor_session_id:s.identity.sessionId,p_claim_intent_id:s.claimIntentId});
function decodeContext(value:unknown,s:Scope){
  const c=object(value,["claimContext","paymentIntent"]);
  const claimContext=decodeRewardAthleteClaimProofContext(c.claimContext,s.identity,{intentId:s.claimIntentId,role:"operator"});
  let paymentIntent=null;
  if(c.paymentIntent!==null){
    const i=object(c.paymentIntent,["paymentIntentId","claimIntentId","chainId","relayerAddress","nonce","recipientProofId","operatorProofId",
      "preparedByUserId","preparedSessionId","preparedAt","idempotencyKey","chainWitness"]);
    const claim=claimContext.intent;const u=claimContext.upload.body;const witness=decodeRewardClaimWitness(i.chainWitness);
    demand(i.claimIntentId===s.claimIntentId&&i.chainId===u.chainId&&i.preparedByUserId===s.identity.userId);
    const relayerAddress=address(i.relayerAddress);demand(![u.operatorAddress,u.treasuryAddress,claim.recipientAddress].includes(relayerAddress));
    const recipient=claimContext.proofs.find(p=>p.role==="recipient");const operator=claimContext.proofs.find(p=>p.role==="operator");
    demand(recipient&&operator&&i.recipientProofId===recipient.proofId&&i.operatorProofId===operator.proofId);
    demand(same(witness.deployment,claimContext.checkpoint.deployment)&&witness.recipient===claim.recipientAddress
      &&same(witness.award,operator.chainWitness.award)&&same(witness.observation.accounting.budgets,u.budgets)
      &&same(witness.observation.accounting.allocated,u.allocated)&&witness.observation.accounting.allocationDigest===u.allocationDigest
      &&witness.observation.accounting.snapshotDigest===u.snapshotDigest&&witness.observation.accounting.uploadDigest===u.uploadDigest
      &&witness.observation.accounting.entitlementCount===u.entitlementCount&&witness.observation.accounting.accountedFunding===u.budgets[u.enabledPot]
      &&witness.observation.accounting.activationNotBefore>=u.sourceReviewEndsAt
      &&witness.observation.accounting.state===3&&!witness.observation.accounting.paused
      &&witness.observation.finalizedBlock.timestamp>=witness.observation.accounting.activationNotBefore
      &&witness.observation.finalizedBlock.timestamp<witness.observation.accounting.claimDeadline
      &&witness.observation.finalizedBlock.timestamp>=claim.issuedAt&&witness.observation.finalizedBlock.timestamp<claim.expiresAt);
    for(const earlier of [claim.chainWitness,recipient.chainWitness,operator.chainWitness]){
      const a=witness.observation.finalizedBlock;const b=earlier.observation.finalizedBlock;
      demand(a.number>=b.number&&a.timestamp>=b.timestamp&&(a.number!==b.number||same(a,b)));
    }
    paymentIntent={paymentIntentId:uuid(i.paymentIntentId),claimIntentId:s.claimIntentId,chainId:u.chainId,relayerAddress,nonce:nonce(i.nonce),
      recipientProofId:recipient.proofId,operatorProofId:operator.proofId,preparedByUserId:s.identity.userId,preparedSessionId:uuid(i.preparedSessionId),
      preparedAt:timestamp(i.preparedAt),idempotencyKey:key(i.idempotencyKey),chainWitness:witness};
  }
  return{claimContext,paymentIntent};
}
export type RewardAthletePaymentContext=ReturnType<typeof decodeContext>;
const safeErrors=new Set(["reward_account_session_required","reward_operator_permission_required","reward_claim_proof_scope_required",
  "reward_payment_approvals_required","reward_payment_intent_required","reward_payment_attempt_required","reward_payment_already_planned",
  "reward_payment_nonce_exhausted","reward_separate_relayer_required","invalid_reward_payment_request","invalid_reward_payment_attempt",
  "reward_payment_attempt_mismatch","reward_payment_transaction_already_recorded","reward_ledger_idempotency_conflict",
  "reward_claim_readiness_required","reward_claim_not_live","reward_claim_observation_stale","reward_claim_observation_regressed",
  "invalid_reward_claim_witness","reward_claim_campaign_not_ready","reward_review_source_changed","reward_review_superseded",
  "reward_record_source_changed","reward_record_source_not_ready","reward_record_approval_withdrawn","reward_record_approval_superseded"]);
async function call(name:Parameters<RewardLedgerRpc>[0],params:Record<string,unknown>,rpc?:RewardLedgerRpc){
  let r:{data:unknown;error:unknown};try{r=await(rpc??((method,body)=>createAdminSupabaseClient().rpc(method,body)))(name,params);}
  catch{throw new RewardLedgerStoreError("reward_ledger_unavailable");}
  if(r.error){const message=typeof r.error==="object"?(r.error as Record<string,unknown>).message:null;
    throw new RewardLedgerStoreError(typeof message==="string"&&safeErrors.has(message)?message:"reward_ledger_store_failed");}return r.data;
}
/** Private capabilities and identity evidence; never an HTTP/browser projection. */
export async function readRewardAthletePaymentContext(identity:RewardAccountIdentity,input:{claimIntentId:string},rpc?:RewardLedgerRpc){
  const s=scope(identity,input.claimIntentId);return decodeContext(await call("service_read_reward_athlete_payment_context",args(s),rpc),s);
}
export async function reserveRewardAthletePaymentIntent(identity:RewardAccountIdentity,input:{claimIntentId:string;relayerAddress:`0x${string}`;
  idempotencyKey:string;observedChainId:number;pendingNonce:bigint;witness:unknown;observedAt:string},rpc?:RewardLedgerRpc){
  const s=scope(identity,input.claimIntentId);const relayerAddress=address(input.relayerAddress);const idempotencyKey=key(input.idempotencyKey);
  const chain=input.observedChainId;demand(chain===10143||chain===31337);demand(typeof input.pendingNonce==="bigint");
  const pendingNonce=nonce(input.pendingNonce.toString());const witness=copy(input.witness);decodeRewardClaimWitness(witness);const observedAt=timestamp(input.observedAt);
  const c=decodeContext(await call("service_reserve_reward_athlete_payment",{...args(s),p_relayer_address:relayerAddress,p_idempotency_key:idempotencyKey,
    p_observed_chain_id:chain,p_pending_nonce:pendingNonce.toString(),p_witness:witness,p_observed_at:observedAt},rpc),s);
  demand(c.paymentIntent?.relayerAddress===relayerAddress&&c.paymentIntent.idempotencyKey===idempotencyKey&&c.paymentIntent.chainId===chain);return c;
}
function decodeAttempt(value:unknown){
  const a=object(value,["schemaVersion","action","chainId","relayerAddress","nonce","contractAddress","transactionHash","signedTransaction","buildId",
    "calldataHash","entitlementId","recipient","amount","pot","authorizationNonce","issuedAt","expiresAt","allocationDigest","operatorDigest","recipientDigest",
    "value","gasLimit","maxFeePerGas","maxPriorityFeePerGas"]);
  demand(a.schemaVersion===1&&a.action==="pay_athlete"&&(a.chainId===10143||a.chainId===31337)&&(a.pot==="race"||a.pot==="league")
    &&typeof a.buildId==="string"&&a.buildId.length>0&&a.buildId.length<=100
    &&typeof a.signedTransaction==="string"&&/^0x02(?:[0-9a-f]{2}){1,2048}$/.test(a.signedTransaction));
  const amount=integer(a.amount);const issuedAt=integer(a.issuedAt);const expiresAt=integer(a.expiresAt);const valueWei=integer(a.value);
  const gasLimit=integer(a.gasLimit);const maxFeePerGas=integer(a.maxFeePerGas);const maxPriorityFeePerGas=integer(a.maxPriorityFeePerGas);
  demand(amount>0n&&valueWei===0n&&issuedAt>0n&&expiresAt>issuedAt&&expiresAt-issuedAt<=86400n&&expiresAt<(1n<<64n)
    &&gasLimit>0n&&gasLimit<(1n<<64n)&&maxFeePerGas>0n&&maxPriorityFeePerGas<=maxFeePerGas);integer((gasLimit*maxFeePerGas).toString());
  return{schemaVersion:1 as const,action:"pay_athlete" as const,chainId:a.chainId,relayerAddress:address(a.relayerAddress),nonce:nonce(a.nonce),
    contractAddress:address(a.contractAddress),transactionHash:hash(a.transactionHash),signedTransaction:a.signedTransaction as `0x02${string}`,
    buildId:a.buildId,calldataHash:hash(a.calldataHash),entitlementId:hash(a.entitlementId),recipient:address(a.recipient),amount,pot:a.pot,
    authorizationNonce:integer(a.authorizationNonce),issuedAt,expiresAt,allocationDigest:hash(a.allocationDigest),operatorDigest:hash(a.operatorDigest),
    recipientDigest:hash(a.recipientDigest),value:valueWei,gasLimit,maxFeePerGas,maxPriorityFeePerGas};
}
export async function storeRewardAthletePaymentAttempt(identity:RewardAccountIdentity,input:{claimIntentId:string;paymentIntentId:string;idempotencyKey:string;
  attempt:unknown;witness:unknown;observedAt:string},rpc?:RewardLedgerRpc){
  const s=scope(identity,input.claimIntentId);const paymentIntentId=uuid(input.paymentIntentId);const idempotencyKey=key(input.idempotencyKey);
  const body=copy(input.attempt);const checked=decodeAttempt(body);const witness=copy(input.witness);decodeRewardClaimWitness(witness);const observedAt=timestamp(input.observedAt);
  const r=object(await call("service_record_reward_athlete_payment_attempt",{...args(s),p_payment_intent_id:paymentIntentId,p_idempotency_key:idempotencyKey,
    p_attempt:body,p_witness:witness,p_observed_at:observedAt},rpc),["attemptId","paymentIntentId","claimIntentId","recordedByUserId","recordedAt","transactionHash"]);
  demand(r.paymentIntentId===paymentIntentId&&r.claimIntentId===s.claimIntentId&&r.recordedByUserId===s.identity.userId&&r.transactionHash===checked.transactionHash);
  return{attemptId:uuid(r.attemptId),paymentIntentId,claimIntentId:s.claimIntentId,recordedByUserId:s.identity.userId,
    recordedAt:timestamp(r.recordedAt),transactionHash:checked.transactionHash};
}
export async function readRewardAthletePaymentAttempt(identity:RewardAccountIdentity,input:{claimIntentId:string;paymentIntentId:string;attemptId?:string;idempotencyKey?:string},rpc?:RewardLedgerRpc){
  const s=scope(identity,input.claimIntentId);const paymentIntentId=uuid(input.paymentIntentId);
  const attemptId=input.attemptId===undefined?null:uuid(input.attemptId);const idempotencyKey=input.idempotencyKey===undefined?null:key(input.idempotencyKey);
  demand((attemptId===null)!==(idempotencyKey===null));
  const value=await call("service_read_reward_athlete_payment_attempt",{...args(s),p_payment_intent_id:paymentIntentId,p_attempt_id:attemptId,p_idempotency_key:idempotencyKey},rpc);
  if(value===null){demand(idempotencyKey!==null);return null;}
  const r=object(value,["context","attempt"]);const c=decodeContext(r.context,s);const i=c.paymentIntent;demand(i&&i.paymentIntentId===paymentIntentId);
  const a=object(r.attempt,["attemptId","paymentIntentId","body","recordedByUserId","recordedSessionId","recordedAt","idempotencyKey"]);
  demand(a.paymentIntentId===paymentIntentId&&a.recordedByUserId===s.identity.userId&&(attemptId===null||a.attemptId===attemptId)
    &&(idempotencyKey===null||a.idempotencyKey===idempotencyKey));
  const body=decodeAttempt(a.body);const claim=c.claimContext.intent;const u=c.claimContext.upload.body;
  demand(body.chainId===i.chainId&&body.relayerAddress===i.relayerAddress&&body.nonce===i.nonce&&body.recipient===claim.recipientAddress
    &&body.entitlementId===c.claimContext.entitlement.onChainId&&body.amount===c.claimContext.entitlement.amountWei&&body.authorizationNonce===claim.nonce
    &&body.issuedAt===claim.issuedAt&&body.expiresAt===claim.expiresAt&&body.allocationDigest===u.allocationDigest
    &&body.pot===(u.enabledPot===0?"race":"league")&&body.contractAddress===c.claimContext.checkpoint.deployment.contractAddress
    &&body.buildId===c.claimContext.checkpoint.deployment.buildId&&body.operatorDigest===c.claimContext.proofs.find(p=>p.role==="operator")?.digest
    &&body.recipientDigest===c.claimContext.proofs.find(p=>p.role==="recipient")?.digest);
  return{context:c,attempt:{attemptId:uuid(a.attemptId),paymentIntentId,body,recordedByUserId:s.identity.userId,
    recordedSessionId:uuid(a.recordedSessionId),recordedAt:timestamp(a.recordedAt),idempotencyKey:key(a.idempotencyKey)}};
}
