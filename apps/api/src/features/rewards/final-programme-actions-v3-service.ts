import type { ProgrammeExecutionScopeV3, RewardAccountIdentity } from "@raceson/db/rewards";
import { requireReward } from "@raceson/domain/rewards";
import { decodeFinalProgrammeActionsV3, nextFinalProgrammeActionV3 } from "@raceson/domain/rewards/final-programme-actions-v3";
import { composeProgrammeActionsV3, type ProgrammeActionDependenciesV3 } from "./programme-actions-v3-service.js";
import { finalPublicationV3 } from "./final-publication-v3-service.js";

/** Final source adapter over the same prepare/queue engine. It neither creates
 * an attestation implicitly nor accepts browser clocks, signed bytes or awards. */
export async function finalProgrammeActionsV3(identity: RewardAccountIdentity, scope: ProgrammeExecutionScopeV3,
  change: unknown, deps: ProgrammeActionDependenciesV3) {
  requireReward(scope.slot === 5 || scope.slot === 6, "invalid_reward_final_programme_action");
  const state = await composeProgrammeActionsV3(identity, scope, change, deps, {
    read: (actor, s) => finalPublicationV3(actor, { ...s, slot: s.slot as 5 | 6 }, undefined, deps.rpc),
    next: nextFinalProgrammeActionV3,
    binding: p => { requireReward(p?.publicationBound && p.current && p.publication, "reward_final_publication_required"); return p.publication.binding; },
    stable: p => p,
  });
  return decodeFinalProgrammeActionsV3({ schema: "raceson-final-programme-actions-v3", ...state });
}
