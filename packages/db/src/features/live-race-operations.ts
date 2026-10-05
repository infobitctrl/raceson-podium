import { conflict, notFound } from "../errors.js";
import type { ServerEnv } from "../env.js";
import { createAdminSupabaseClient } from "../supabase.js";

type LifecycleRow = { status: string; organizer_deleted_at: string | null };

export function assertLiveRaceLifecycle(edition: LifecycleRow, category: LifecycleRow) {
  if (
    ["completed", "archived", "cancelled"].includes(edition.status)
    || ["completed", "closed"].includes(category.status)
    || edition.organizer_deleted_at
    || category.organizer_deleted_at
  ) {
    throw conflict("This race has finished or been closed. Use results review for corrections.");
  }
}

// Call after permission checks, before reusing a session or recording new timing.
// The database trigger also checks inserts atomically against concurrent finish.
export async function requireLiveRaceOperations(
  editionId: string,
  categoryId: string,
  env: ServerEnv,
) {
  const { data, error } = await createAdminSupabaseClient(env)
    .from("event_categories")
    .select("status,organizer_deleted_at,event_editions!inner(status,organizer_deleted_at)")
    .eq("id", categoryId)
    .eq("event_edition_id", editionId)
    .maybeSingle<LifecycleRow & { event_editions: LifecycleRow }>();
  if (error) throw error;
  if (!data) throw notFound("Race not found in this race");
  assertLiveRaceLifecycle(data.event_editions, data);
}
