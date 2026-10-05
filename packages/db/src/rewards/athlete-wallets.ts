import { parseRewardSourceTimestamp } from "@raceson/domain/rewards";
import { isRewardWalletOrigin } from "@raceson/domain/rewards/environment";
import { createAdminSupabaseClient } from "../supabase.js";
import { copyRewardLedgerDocument as copy,RewardLedgerStoreError,type RewardLedgerRpc } from "./programme-ledger.js";
import { rewardDocumentObject as object,rewardDocumentArray as array,rewardDocumentUuid as uuid,rewardDocumentInteger as integer } from "./stored-documents.js";

/** This must come from a verified RacesOn login token, not request JSON. SQL
 * independently checks that its exact user/session still exists and is active. */
export type RewardAccountIdentity={userId:string;sessionId:string};
export { decode as decodeRewardWalletChallenge };
const scope=(input:RewardAccountIdentity)=>({userId:uuid(input.userId),sessionId:uuid(input.sessionId)});
function demand(value:unknown):asserts value{if(!value)throw new RewardLedgerStoreError("invalid_reward_wallet_document");}
function stamp(value:unknown):string{parseRewardSourceTimestamp(value);return value as string;}
function key(value:unknown):string{demand(typeof value==="string" && value.length>=8 && value.length<=128);return value;}
function address(value:unknown):`0x${string}`{demand(typeof value==="string" && /^0x[0-9a-f]{40}$/.test(value) && BigInt(value)!==0n);return value as `0x${string}`;}
function hash(value:unknown):`0x${string}`{demand(typeof value==="string" && /^0x[0-9a-f]{64}$/.test(value) && BigInt(value)!==0n);return value as `0x${string}`;}
function signature(value:unknown):`0x${string}`{demand(typeof value==="string" && /^0x[0-9a-f]{130}$/.test(value));return value as `0x${string}`;}
const safeErrors=new Set(["reward_account_session_required","reward_wallet_challenge_not_found","invalid_reward_wallet_request","invalid_reward_wallet_proof",
  "reward_wallet_rate_limited","reward_wallet_challenge_expired","reward_ledger_idempotency_conflict"]);
async function call(name:Parameters<RewardLedgerRpc>[0],args:Record<string,unknown>,rpc?:RewardLedgerRpc){
  let result:{data:unknown;error:unknown};try{result=await(rpc??((method,params)=>createAdminSupabaseClient().rpc(method,params)))(name,args);}
  catch{throw new RewardLedgerStoreError("reward_ledger_unavailable");}
  if(result.error){const message=typeof result.error==="object"?(result.error as Record<string,unknown>).message:null;
    throw new RewardLedgerStoreError(typeof message==="string" && safeErrors.has(message)?message:"reward_ledger_store_failed");}return result.data;
}
function decode(raw:unknown,identity:RewardAccountIdentity,challengeId?:string){
  const c=object(raw,["challengeId","userId","sessionId","chainId","address","origin","nonce","issuedAt","expiresAt","idempotencyKey","checkedAt","proof"]);
  demand(c.userId===identity.userId && c.sessionId===identity.sessionId && (challengeId===undefined||c.challengeId===challengeId) && (c.chainId===10143||c.chainId===31337));
  demand(typeof c.origin==="string" && isRewardWalletOrigin(c.origin,c.chainId,true));
  demand(typeof c.nonce==="string" && /^[0-9a-f]{64}$/.test(c.nonce));
  const issuedAt=stamp(c.issuedAt);const expiresAt=stamp(c.expiresAt);const checkedAt=stamp(c.checkedAt);
  demand(Date.parse(issuedAt)%1000===0 && Date.parse(expiresAt)-Date.parse(issuedAt)===600000);
  let proof=null;
  if(c.proof!==null){const p=object(c.proof,["proofId","messageHash","signature","verifiedAt"]);
    const verifiedAt=stamp(p.verifiedAt);demand(Date.parse(verifiedAt)>=Date.parse(issuedAt) && Date.parse(verifiedAt)<Date.parse(expiresAt));
    proof={proofId:uuid(p.proofId),messageHash:hash(p.messageHash),signature:signature(p.signature),verifiedAt};}
  return{challengeId:uuid(c.challengeId),...identity,chainId:c.chainId as 10143|31337,address:address(c.address),origin:c.origin,nonce:c.nonce,
    issuedAt,expiresAt,idempotencyKey:key(c.idempotencyKey),checkedAt,proof};
}
export async function createRewardWalletChallenge(identity:RewardAccountIdentity,input:{chainId:number;address:string;origin:string;idempotencyKey:string},rpc?:RewardLedgerRpc){
  const s=scope(identity);const chainId=input.chainId;const addr=address(input.address);const origin=input.origin;const idempotencyKey=key(input.idempotencyKey);
  demand((chainId===10143||chainId===31337) && typeof origin==="string" && origin.length<=100 && isRewardWalletOrigin(origin,chainId));
  const c=decode(await call("service_create_reward_wallet_challenge",{p_user_id:s.userId,p_session_id:s.sessionId,p_chain_id:chainId,p_address:addr,p_origin:origin,p_idempotency_key:idempotencyKey},rpc),s);
  demand(c.chainId===chainId && c.address===addr && c.origin===origin && c.idempotencyKey===idempotencyKey);return c;
}
export async function readRewardWalletChallenge(identity:RewardAccountIdentity,challengeId:string,rpc?:RewardLedgerRpc){
  const s=scope(identity);const id=uuid(challengeId);
  return decode(await call("service_read_reward_wallet_challenge",{p_user_id:s.userId,p_session_id:s.sessionId,p_challenge_id:id},rpc),s,id);
}
export async function confirmRewardWalletProof(identity:RewardAccountIdentity,input:{challengeId:string;messageHash:string;signature:string},rpc?:RewardLedgerRpc){
  const s=scope(identity);const id=uuid(input.challengeId);const messageHash=hash(input.messageHash);const signed=signature(input.signature);
  const c=decode(await call("service_confirm_reward_wallet_proof",{p_user_id:s.userId,p_session_id:s.sessionId,p_challenge_id:id,p_message_hash:messageHash,p_signature:signed},rpc),s,id);
  demand(c.proof && c.proof.messageHash===messageHash && c.proof.signature===signed);return c;
}
export async function readOwnRewardAwards(identity:RewardAccountIdentity,afterId:string|null=null,rpc?:RewardLedgerRpc){
  const s=scope(identity);const after=afterId===null?null:uuid(afterId);
  const body=object(copy(await call("service_read_own_reward_awards",{p_user_id:s.userId,p_session_id:s.sessionId,p_after_id:after},rpc)),["items","nextCursor"]);
  const items=array(body.items,50,value=>{
    const a=object(value,["entitlementId","campaignId","pot","scopeKey","chainId","environment","athleteProfileId","identityChanged","amountWei","ageStatus"]);
    demand((a.pot==="race"||a.pot==="league") && typeof a.identityChanged==="boolean" && ["minor","unknown","unverified_adult"].includes(a.ageStatus as string));
    demand((a.chainId===10143 && a.environment==="testnet_pilot")||(a.chainId===31337 && a.environment==="local_simulation"));
    const scopeKey=a.pot==="league"?(demand(a.scopeKey==="rounds-1-5"),"rounds-1-5"):uuid(a.scopeKey);
    const amountWei=integer(a.amountWei);demand(amountWei>0n);
    return{entitlementId:uuid(a.entitlementId),campaignId:uuid(a.campaignId),pot:a.pot,scopeKey,chainId:a.chainId,environment:a.environment,
      athleteProfileId:uuid(a.athleteProfileId),identityChanged:a.identityChanged,amountWei,ageStatus:a.ageStatus as "minor"|"unknown"|"unverified_adult"};
  });
  let previous=after;for(const item of items){demand(previous===null||item.entitlementId>previous);previous=item.entitlementId;}
  const nextCursor=body.nextCursor===null?null:uuid(body.nextCursor);demand(nextCursor===null||(items.length===50 && nextCursor===items.at(-1)?.entitlementId));
  return{items,nextCursor};
}
