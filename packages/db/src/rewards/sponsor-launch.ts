import {decodeSponsorLaunchView, sponsorLaunchPlan, sponsorLaunchSourcesReady} from "@raceson/domain/rewards/sponsor-launch";
import {setupId} from "@raceson/domain/rewards/distribution-setup";
import {createAdminSupabaseClient} from "../supabase.js";
import {RewardLedgerStoreError, type RewardLedgerRpc} from "./programme-ledger.js";
import type {RewardAccountIdentity} from "./athlete-wallets.js";
import {resolveSponsorSourceV4} from "./sponsor-source-v4.js";

export async function rewardSponsorLaunch(identity: RewardAccountIdentity, chainId: 10143 | 31337, id: string,
  change?: {requestId: string; expectedRevision: number}, rpc?: RewardLedgerRpc) {
  if (!setupId(identity.userId) || !setupId(identity.sessionId) || !setupId(id) || ![10143, 31337].includes(chainId)
    || change && (!setupId(change.requestId) || !Number.isInteger(change.expectedRevision) || change.expectedRevision < 1 || change.expectedRevision > 2147483645)) throw Error("invalid_sponsor_launch");
  if (change) {
    const current = await rewardSponsorLaunch(identity, chainId, id, undefined, rpc);
    // Preserve exact retries of historical launches, including the unbound ones
    // that motivated this guard. SQL still serializes the expected revision.
    if (current.setup.revision === change.expectedRevision && current.launch?.setup.revision !== change.expectedRevision) {
      if (!sponsorLaunchSourcesReady(current.setup)) throw new RewardLedgerStoreError("reward_launch_sources_required");
      const c=current.setup.configuration,selection=c.sponsorSelection;
      if(selection?.raceId){
        // Discovery metadata is intent, not source authority. Resolve the exact
        // published event and check every funded reward against its chosen track.
        const source=await resolveSponsorSourceV4(identity,chainId,{
          sourceLeagueId:selection.sourceLeagueId,sourceSeasonId:selection.sourceSeasonId,eventEditionId:selection.eventEditionId,
        },rpc).catch(error=>{
          if(error instanceof RewardLedgerStoreError&&["reward_sponsor_source_not_found","reward_sponsor_source_stale"].includes(error.code)){
            throw new RewardLedgerStoreError("reward_launch_sources_required");
          }
          throw error;
        });
        const round=source.catalogue.rounds.find(r=>r.id===source.selectedRoundId),track=round?.races.find(r=>r.id===selection.raceId);
        const matches=Boolean(track&&round&&c.context?.draftId===source.context.draftId&&c.context.catalogueHash===source.context.catalogueHash&&
          c.root.children.filter(p=>p.shareBps>0).every(p=>{
            const pot=c.guided!.pots.find(v=>v.nodeId===p.id);
            return pot?.roundId===round.id&&pot.slot===source.selectedSlot&&p.children.filter(g=>g.shareBps>0).every(g=>{
              const group=c.guided!.groups.find(v=>v.nodeId===g.id),category=source.catalogue.categories.find(v=>v.id===g.rule?.source?.categoryId);
              return group?.type==="athlete_standings"&&category?.target==="individual"&&category.competitionId===track.competitionId;
            });
          }));
        if(!matches)throw new RewardLedgerStoreError("reward_launch_sources_required");
      }
    }
  }
  const result = await (rpc ?? ((name, args) => createAdminSupabaseClient().rpc(name, args)))("service_reward_sponsor_launch", {
    p_actor_user_id: identity.userId, p_actor_session_id: identity.sessionId, p_chain_id: chainId,
    p_setup_id: id, p_request_id: change?.requestId ?? null, p_expected_revision: change?.expectedRevision ?? null,
  });
  if (result.error) {
    const code = (result.error as {message?: unknown}).message;
    throw new RewardLedgerStoreError(typeof code === "string" && ["reward_account_session_required", "reward_setup_not_found", "reward_setup_conflict", "reward_launch_incomplete", "invalid_sponsor_launch"].includes(code) ? code : "reward_ledger_unavailable");
  }
  const view = decodeSponsorLaunchView(result.data, chainId, id);
  if (change && (!view.launch || view.launch.setup.revision !== change.expectedRevision || !sponsorLaunchPlan(view.launch.setup).complete)) throw Error("invalid_sponsor_launch");
  return view;
}
