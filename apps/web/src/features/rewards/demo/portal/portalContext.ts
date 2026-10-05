import { listPlanningDrafts, readPlanningDraft } from "../../data/planningDrafts";
import { readSourceMapping } from "../../data/sourceMapping";
import { requestFinaleBindingV3 } from "../../data/finaleBindingV3";
import { apiRequest } from "@/lib/api";

/** Uses only existing, scoped API-contract v1.1 reads. URL selectors cannot
 * supply ownership, publication state, ranks or amounts. No ingestion here. */
export async function loadPortalContexts(organizationId: string, scope: { draft: string | null; event: string | null; season: string | null }) {
  let eventId = scope.event;
  if (eventId && !/^[0-9a-f]{8}-[0-9a-f-]{27}$/.test(eventId)) {
    // Classic event pages canonicalize UUID URLs to slugs. Resolve only through
    // the existing authenticated, organization-scoped host endpoint.
    const event = await apiRequest<{ id: string; organizationId: string } | null>({
      path: `/v1/organizer/events/${encodeURIComponent(eventId)}?organization=${encodeURIComponent(organizationId)}`, cache: "no-store" });
    if (!event) return [];
    if (event.organizationId !== organizationId || typeof event.id !== "string") throw new Error("reward_host_scope_changed");
    eventId = event.id;
  }
  const records = (await listPlanningDrafts()).filter(record => record.organizationId === organizationId
    && (!scope.draft || record.draftId === scope.draft) && (!scope.season || record.seasonId === scope.season));
  const contexts = await Promise.all(records.map(async candidate => {
    const record = await readPlanningDraft(candidate);
    if (record.organizationId !== organizationId || record.seasonId !== candidate.seasonId) throw new Error("reward_host_scope_changed");
    const workspace = await readSourceMapping(record);
    // Imported programmes bind their real local practice finale separately.
    const finale = await requestFinaleBindingV3(record);
    return { record, workspace, finale };
  }));
  return contexts.filter(({ workspace, finale }) => !eventId
    || workspace.catalogue.rounds.some(round => round.editionId === eventId)
    || finale.binding?.editionId === eventId);
}
export type PortalContext = Awaited<ReturnType<typeof loadPortalContexts>>[number];
