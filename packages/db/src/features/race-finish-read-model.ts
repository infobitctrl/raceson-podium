import type { ServerEnv } from "../env.js";
import { createAdminSupabaseClient } from "../supabase.js";

type FinishCategory = {
  id: string;
  status: string;
  latestPublicationState?: string | null;
  finishedWithoutResults?: boolean;
};
type FinishEvent = { id: string; categories: FinishCategory[] };

/** Enrich only events already authorized by the organizer read boundary. */
export async function withRaceFinishEvidence<T extends FinishEvent>(events: T[], env: ServerEnv): Promise<T[]> {
  const editionIds = events.filter((event) => event.categories.some((category) =>
    category.status === "completed" && !category.latestPublicationState,
  )).map((event) => event.id);
  if (!editionIds.length) return events;

  const client = createAdminSupabaseClient(env);
  const skippedByEdition = new Map<string, Set<string>>();
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    // Return only completion IDs, never the actor or the confidential reason.
    const { data, error } = await client.from("domain_events")
      .select("aggregate_id,skipped:payload_json->skippedResultCategoryIds")
      .eq("event_type", "race.finish.completed")
      .eq("aggregate_type", "event_edition")
      .in("aggregate_id", editionIds)
      .order("id")
      .range(offset, offset + pageSize - 1)
      .returns<Array<{ aggregate_id: string; skipped: unknown }>>();
    if (error) throw error;
    for (const row of data ?? []) {
      if (!editionIds.includes(row.aggregate_id) || !Array.isArray(row.skipped)) continue;
      const ids = skippedByEdition.get(row.aggregate_id) ?? new Set<string>();
      for (const id of row.skipped) if (typeof id === "string") ids.add(id);
      skippedByEdition.set(row.aggregate_id, ids);
    }
    if (!data || data.length < pageSize) break;
  }
  return events.map((event) => ({
    ...event,
    categories: event.categories.map((category) => ({
      ...category,
      finishedWithoutResults: category.status === "completed"
        && !category.latestPublicationState
        && Boolean(skippedByEdition.get(event.id)?.has(category.id)),
    })),
  }));
}
