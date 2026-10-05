import { createAdminSupabaseClient } from "../supabase.js";
import { RewardLedgerStoreError,type RewardLedgerRpc } from "./programme-ledger.js";
import { rewardDocumentObject as object,rewardDocumentUuid as uuid,rewardDocumentInteger as integer } from "./stored-documents.js";
import type { RewardAccountIdentity } from "./athlete-wallets.js";

export type RewardJobKind="deployment"|"funding"|"lifecycle"|"athlete_payment"|"club_payment";
export type RewardOperatorQueueJob={kind:RewardJobKind;jobId:string;campaignId:string;intentId:string;attemptId:string;
  transactionHash:`0x${string}`;signerAddress:`0x${string}`;nonce:bigint;state:"queued"|"leased"|"broadcasting"|"submitted"};
function demand(v:unknown):asserts v{if(!v)throw new RewardLedgerStoreError("invalid_reward_operator_queue");}
const address=(v:unknown):v is `0x${string}`=>typeof v==="string"&&/^0x[0-9a-f]{40}$/.test(v)&&BigInt(v)>0n;
const safeErrors=new Set(["reward_account_session_required","reward_operator_permission_required","invalid_reward_operator_queue"]);

/** Read-only selection, never execution permission. Missing jobs means only
 * that this programme has no queued work outside the excluded signer lanes. */
export async function nextRewardOperatorJob(identity:RewardAccountIdentity,input:{programmeId:string;chainId:10143|31337;excludedSigners:readonly string[]},rpc?:RewardLedgerRpc):Promise<RewardOperatorQueueJob|null>{
  const actor=uuid(identity.userId);const session=uuid(identity.sessionId);const programmeId=uuid(input.programmeId);const chainId=input.chainId;
  demand(chainId===10143||chainId===31337);demand(Array.isArray(input.excludedSigners)&&input.excludedSigners.length<=100);
  const excludedSigners=[...input.excludedSigners];demand(excludedSigners.every(address)&&new Set(excludedSigners).size===excludedSigners.length);
  let result:{data:unknown;error:unknown};
  try{result=await(rpc??((n,a)=>createAdminSupabaseClient().rpc(n,a)))("service_next_reward_operator_job",{
    p_programme_id:programmeId,p_actor_user_id:actor,p_actor_session_id:session,p_chain_id:chainId,p_excluded_signers:excludedSigners});}
  catch{throw new RewardLedgerStoreError("reward_ledger_unavailable");}
  if(result.error){const code=typeof result.error==="object"?(result.error as Record<string,unknown>).message:null;
    throw new RewardLedgerStoreError(typeof code==="string"&&safeErrors.has(code)?code:"reward_ledger_store_failed");}
  const body=object(result.data,["schemaVersion","programmeId","chainId","job"]);
  demand(body.schemaVersion===1&&body.programmeId===programmeId&&body.chainId===chainId);
  if(body.job===null)return null;
  const j=object(body.job,["kind","jobId","campaignId","intentId","attemptId","transactionHash","signerAddress","nonce","state"]);
  demand(typeof j.kind==="string"&&["deployment","funding","lifecycle","athlete_payment","club_payment"].includes(j.kind)
    &&typeof j.state==="string"&&["queued","leased","broadcasting","submitted"].includes(j.state)
    &&typeof j.transactionHash==="string"&&/^0x[0-9a-f]{64}$/.test(j.transactionHash)&&BigInt(j.transactionHash)>0n
    &&address(j.signerAddress)&&!excludedSigners.includes(j.signerAddress));
  const nonce=integer(j.nonce);demand(nonce<=BigInt(Number.MAX_SAFE_INTEGER));
  return{kind:j.kind as RewardJobKind,jobId:uuid(j.jobId),campaignId:uuid(j.campaignId),intentId:uuid(j.intentId),attemptId:uuid(j.attemptId),
    transactionHash:j.transactionHash as `0x${string}`,signerAddress:j.signerAddress,nonce,state:j.state as RewardOperatorQueueJob["state"]};
}
