import {createHash} from "node:crypto";
import {createAdminSupabaseClient} from "../supabase.js";
import {canonicalRewardProposalV2} from "@raceson/domain/rewards/frozen-proposal-v2";
import {copyRewardLedgerDocument as copy,RewardLedgerStoreError,type RewardLedgerRpc} from "./programme-ledger.js";
import {rewardDocumentObject as object,rewardDocumentUuid as uuid} from "./stored-documents.js";
import {decodeLeaguePolicyFactsV3} from "./league-policy-v3.js";
import type {RewardAccountIdentity} from "./athlete-wallets.js";
const check=(v:unknown)=>{if(!v)throw new RewardLedgerStoreError("invalid_reward_league_publication");};
const hash=(v:unknown)=>{check(typeof v==="string"&&/^[0-9a-f]{64}$/.test(v as string));return v as string;};
const time=(v:unknown)=>{check(typeof v==="string"&&Number.isFinite(Date.parse(v as string)));return new Date(v as string).toISOString();};
export const leaguePublicationHashV3=(v:unknown)=>createHash("sha256").update(canonicalRewardProposalV2(v)).digest("hex");
export type LeaguePublicationScopeV3={chainId:31337|10143;draftId:string;requestId?:string};
export type LeaguePublicationWriteV3={previousPublicationId:string|null;sourceGuardHash:string;document:unknown;decision:"published"|"held"};
const safe=new Set(["reward_account_session_required","reward_planning_not_found","reward_planning_revision_changed","reward_historical_source_missing",
  "reward_league_publication_conflict","reward_league_publication_not_ready","invalid_reward_league_publication"]);
/** Private authoritative source and immutable publication documents. HTTP must
 * use the application projection, never expose these raw facts or SQL guards. */
export async function leaguePublicationFactsV3(identity:RewardAccountIdentity,input:LeaguePublicationScopeV3,write?:LeaguePublicationWriteV3,rpc?:RewardLedgerRpc){
  const actor={userId:uuid(identity.userId),sessionId:uuid(identity.sessionId)},scope={chainId:input.chainId,draftId:uuid(input.draftId),requestId:input.requestId?uuid(input.requestId):null};
  check([31337,10143].includes(scope.chainId));if(write)check(scope.requestId&&["published","held"].includes(write.decision));
  const args={p_actor_user_id:actor.userId,p_actor_session_id:actor.sessionId,p_chain_id:scope.chainId,p_draft_id:scope.draftId,p_request_id:scope.requestId,
    p_decision:write?.decision??null,p_previous_publication_id:write?.previousPublicationId?uuid(write.previousPublicationId):null,
    p_source_guard_hash:write?hash(write.sourceGuardHash):null,p_document_text:write?canonicalRewardProposalV2(copy(write.document)):null};
  let r;try{r=await(rpc??((name,args)=>createAdminSupabaseClient().rpc(name,args)))("service_reward_league_publication_v3",args);}
  catch{throw new RewardLedgerStoreError("reward_ledger_unavailable");}
  if(r.error){const m=(r.error as {message?:unknown}).message;throw new RewardLedgerStoreError(typeof m==="string"&&safe.has(m)?m:"reward_ledger_unavailable");}
  return decodeLeaguePublicationFactsV3(r.data,actor,scope);
}
/** Reused by a surrounding source-locked allocation transaction. */
export function decodeLeaguePublicationFactsV3(value:unknown,actor:RewardAccountIdentity,scope:{chainId:31337|10143;draftId:string;requestId:string|null}){
  const v=object(copy(value),["policy","guardHash","publication","recorded","observedAt"]),guardHash=hash(v.guardHash),observedAt=time(v.observedAt);
  const policy=decodeLeaguePolicyFactsV3(v.policy,{...scope,requestId:null});
  const record=(value:unknown)=>{
    if(value===null)return null;
    const p=object(value,["id","draftId","previousPublicationId","sourceGuardHash","documentHash","document","decision","publishedAt","publishedByUserId","evidenceHash"]);
    check(p.draftId===scope.draftId&&["published","held"].includes(String(p.decision))&&p.previousPublicationId!==p.id);
    const document=copy(p.document),documentHash=hash(p.documentHash);check(leaguePublicationHashV3(document)===documentHash);
    const publishedAt=time(p.publishedAt);check(publishedAt<=observedAt);
    return{id:uuid(p.id),draftId:scope.draftId,previousPublicationId:p.previousPublicationId===null?null:uuid(p.previousPublicationId),
      sourceGuardHash:hash(p.sourceGuardHash),documentHash,document,decision:p.decision as "published"|"held",publishedAt,
      publishedByUserId:uuid(p.publishedByUserId),evidenceHash:hash(p.evidenceHash)};
  };
  const publication=record(v.publication),recorded=record(v.recorded);
  if(recorded)check(recorded.id===scope.requestId&&recorded.publishedByUserId===actor.userId);
  return{policy,guardHash,publication,recorded,observedAt};
}
