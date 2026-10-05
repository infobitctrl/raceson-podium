import {decodeSponsorSourceRequestV4,decodeSponsorSourceViewV4,type SponsorSourceRequestV4} from "@raceson/domain/rewards/sponsor-source";
import {setupId} from "@raceson/domain/rewards/distribution-setup";
import {createAdminSupabaseClient} from "../supabase.js";
import {RewardLedgerStoreError,type RewardLedgerRpc} from "./programme-ledger.js";
import type {RewardAccountIdentity} from "./athlete-wallets.js";

export async function resolveSponsorSourceV4(identity:RewardAccountIdentity,chainId:31337|10143,request:SponsorSourceRequestV4,rpc?:RewardLedgerRpc){
 if(!setupId(identity.userId)||!setupId(identity.sessionId)||![31337,10143].includes(chainId))throw Error("invalid_reward_sponsor_source");
 const selection=decodeSponsorSourceRequestV4(request),saved="setupId" in selection;
 const result=await (rpc??((name,args)=>createAdminSupabaseClient().rpc(name,args)))("service_resolve_reward_sponsor_source_v4",{
   p_actor_user_id:identity.userId,p_actor_session_id:identity.sessionId,p_chain_id:chainId,
   p_setup_id:saved?selection.setupId:null,p_source_league_id:saved?null:selection.sourceLeagueId,
   p_source_season_id:saved?null:selection.sourceSeasonId,p_event_edition_id:saved?null:selection.eventEditionId,
 });
 if(result.error){const code=String((result.error as {message?:unknown}).message);
   throw new RewardLedgerStoreError(["reward_account_session_required","reward_sponsor_source_not_found","reward_sponsor_source_stale","invalid_reward_sponsor_source"].includes(code)?code:"reward_ledger_unavailable");}
 const view=decodeSponsorSourceViewV4(result.data);
 if(!saved&&(view.sourceLeagueId!==selection.sourceLeagueId||view.sourceSeasonId!==selection.sourceSeasonId||view.eventEditionId!==selection.eventEditionId))throw Error("invalid_reward_sponsor_source");
 if(saved&&view.eventEditionId!==null)throw Error("invalid_reward_sponsor_source");
 return view;
}
