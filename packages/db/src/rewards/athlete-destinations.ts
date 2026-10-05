import { parseRewardSourceTimestamp } from "@raceson/domain/rewards";
import { createAdminSupabaseClient } from "../supabase.js";
import { RewardLedgerStoreError,type RewardLedgerRpc } from "./programme-ledger.js";
import { rewardDocumentObject as object,rewardDocumentUuid as uuid } from "./stored-documents.js";
import type { RewardAccountIdentity } from "./athlete-wallets.js";
export { decode as decodeRewardAthleteDestination };

const scope=(s:RewardAccountIdentity)=>({userId:uuid(s.userId),sessionId:uuid(s.sessionId)});
function demand(value:unknown):asserts value{if(!value)throw new RewardLedgerStoreError("invalid_reward_destination_document");}
function key(value:unknown):string{demand(typeof value==="string" && value.length>=8 && value.length<=128);return value;}
function timestamp(value:unknown):string{parseRewardSourceTimestamp(value);return value as string;}
const safe=new Set(["reward_account_session_required","invalid_reward_destination_request","reward_destination_profile_required",
  "reward_destination_proof_required","reward_destination_not_found","reward_destination_withdraw_first","reward_wallet_challenge_expired","reward_ledger_idempotency_conflict"]);
async function call(name:Parameters<RewardLedgerRpc>[0],args:Record<string,unknown>,rpc?:RewardLedgerRpc){
  let result:{data:unknown;error:unknown};
  try{result=await(rpc??((method,params)=>createAdminSupabaseClient().rpc(method,params)))(name,args);}
  catch{throw new RewardLedgerStoreError("reward_ledger_unavailable");}
  if(result.error){const msg=typeof result.error==="object"?(result.error as Record<string,unknown>).message:null;
    throw new RewardLedgerStoreError(typeof msg==="string" && safe.has(msg)?msg:"reward_ledger_store_failed");}return result.data;
}
function decode(raw:unknown,userId:string){
  const d=object(raw,["requestId","userId","sessionId","athleteProfileId","proofId","address","chainId","requestedAt","idempotencyKey","withdrawnAt","status"]);
  demand(d.userId===userId && (d.chainId===10143||d.chainId===31337));
  demand(typeof d.address==="string" && /^0x[0-9a-f]{40}$/.test(d.address) && BigInt(d.address)>0n);
  demand(d.status==="pending_review"||d.status==="identity_hold"||d.status==="withdrawn");
  const requestedAt=timestamp(d.requestedAt);const withdrawnAt=d.withdrawnAt===null?null:timestamp(d.withdrawnAt);
  demand((d.status==="withdrawn")===(withdrawnAt!==null) && (withdrawnAt===null||Date.parse(withdrawnAt)>=Date.parse(requestedAt)));
  return{requestId:uuid(d.requestId),userId,sessionId:uuid(d.sessionId),athleteProfileId:uuid(d.athleteProfileId),proofId:uuid(d.proofId),
    address:d.address as `0x${string}`,chainId:d.chainId as 10143|31337,requestedAt,idempotencyKey:key(d.idempotencyKey),withdrawnAt,status:d.status};
}
export async function requestRewardAthleteDestination(identity:RewardAccountIdentity,input:{athleteProfileId:string;proofId:string;idempotencyKey:string},rpc?:RewardLedgerRpc){
  const s=scope(identity);const athleteProfileId=uuid(input.athleteProfileId);const proofId=uuid(input.proofId);const idempotencyKey=key(input.idempotencyKey);
  const result=decode(await call("service_request_reward_athlete_destination",{p_user_id:s.userId,p_session_id:s.sessionId,
    p_athlete_profile_id:athleteProfileId,p_proof_id:proofId,p_idempotency_key:idempotencyKey},rpc),s.userId);
  demand(result.sessionId===s.sessionId && result.athleteProfileId===athleteProfileId && result.proofId===proofId && result.idempotencyKey===idempotencyKey);return result;
}
export async function readRewardAthleteDestination(identity:RewardAccountIdentity,requestId:string,rpc?:RewardLedgerRpc){
  const s=scope(identity);const id=uuid(requestId);
  const result=decode(await call("service_read_reward_athlete_destination",{p_user_id:s.userId,p_session_id:s.sessionId,p_request_id:id},rpc),s.userId);
  demand(result.requestId===id);return result;
}
export async function listRewardAthleteDestinations(identity:RewardAccountIdentity,afterId:string|null=null,rpc?:RewardLedgerRpc){
  const s=scope(identity);const after=afterId===null?null:uuid(afterId);
  const body=object(await call("service_list_reward_athlete_destinations",{p_user_id:s.userId,p_session_id:s.sessionId,p_after_id:after},rpc),["items","nextCursor"]);
  demand(Array.isArray(body.items) && body.items.length<=50);
  let previous=after;
  const items=body.items.map(raw=>{const d=decode(raw,s.userId);demand(previous===null||d.requestId>previous);previous=d.requestId;return d;});
  const nextCursor=body.nextCursor===null?null:uuid(body.nextCursor);
  demand(nextCursor===null||(items.length===50 && nextCursor===previous));return{items,nextCursor};
}
export async function withdrawRewardAthleteDestination(identity:RewardAccountIdentity,requestId:string,rpc?:RewardLedgerRpc){
  const s=scope(identity);const id=uuid(requestId);
  const result=decode(await call("service_withdraw_reward_athlete_destination",{p_user_id:s.userId,p_session_id:s.sessionId,p_request_id:id},rpc),s.userId);
  demand(result.requestId===id && result.status==="withdrawn");return result;
}
