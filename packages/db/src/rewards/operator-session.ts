import { createAdminSupabaseClient } from "../supabase.js";
import { copyRewardLedgerDocument, RewardLedgerStoreError, type RewardLedgerRpc } from "./programme-ledger.js";
import { rewardDocumentObject as object, rewardDocumentUuid as uuid } from "./stored-documents.js";
import type { RewardAccountIdentity } from "./athlete-wallets.js";

const methods = new Set<string>([
  "service_read_reward_deployment_context", "service_read_reward_deployment_attempt",
  "service_read_reward_campaign_checkpoint", "service_record_reward_campaign_checkpoint",
  "service_read_reward_deployment_job", "service_step_reward_deployment_job",
  "service_read_reward_funding_context", "service_read_reward_funding_attempt",
  "service_read_reward_funding_job", "service_step_reward_funding_job", "service_confirm_reward_funding_job",
  "service_read_reward_lifecycle_context", "service_read_reward_lifecycle_attempt",
  "service_read_reward_lifecycle_job", "service_step_reward_lifecycle_job", "service_confirm_reward_lifecycle_job",
  "service_read_reward_athlete_payment_context", "service_read_reward_athlete_payment_attempt",
  "service_read_reward_athlete_payment_job", "service_step_reward_athlete_payment_job", "service_confirm_reward_athlete_payment_job",
  "service_read_reward_club_payment_context", "service_read_reward_club_payment_attempt",
  "service_read_reward_club_payment_job", "service_step_reward_club_payment_job", "service_confirm_reward_club_payment_job",
]);
function demand(value: unknown): asserts value {
  if (!value) throw new RewardLedgerStoreError("invalid_reward_operator_session_call");
}

/** Internal runner transport only. Each allowed RPC executes inside one SQL
 * transaction with current session checks before AND after it. No ordinary
 * portal route, arbitrary RPC proxy, signing, queue creation or session minting.
 * Identity is supplied by the authenticated operator entry point, not a browser
 * body. The underlying repositories still decode their private result/errors. */
export function withRewardOperatorSession(identity: RewardAccountIdentity, injected?: RewardLedgerRpc): RewardLedgerRpc {
  const actorUserId = uuid(identity.userId); const actorSessionId = uuid(identity.sessionId);
  const rpc: RewardLedgerRpc = injected ?? ((name, args) => createAdminSupabaseClient().rpc(name, args));
  return async (name, input) => {
    demand(methods.has(name));
    const args = copyRewardLedgerDocument(input);
    demand(args !== null && typeof args === "object" && !Array.isArray(args)
      && args.p_actor_user_id === actorUserId
      && (!("p_actor_session_id" in args) || args.p_actor_session_id === actorSessionId)
      && new TextEncoder().encode(JSON.stringify(args)).length <= 131_072);
    const response = await rpc("service_reward_operator_session_call", {
      p_actor_user_id: actorUserId, p_actor_session_id: actorSessionId, p_method: name, p_arguments: args,
    });
    if (response.error) return { data: null, error: response.error };
    const body = object(response.data, ["schemaVersion", "actorUserId", "actorSessionId", "method", "result"]);
    demand(body.schemaVersion === 1 && body.actorUserId === actorUserId && body.actorSessionId === actorSessionId && body.method === name);
    return { data: body.result, error: null };
  };
}
