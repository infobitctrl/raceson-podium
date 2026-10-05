import type { createAdminSupabaseClient } from "../supabase.js";

export type ResultRunSnapshotRow = {
  id: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  summary_json: Record<string, unknown> | null;
};

export const RESULT_RUN_SNAPSHOT_COLUMNS = "id,status,started_at,completed_at,summary_json";

// A migrated final-time snapshot is not a recording of native checkpoint
// punches. Recomputing one from those absent punches loses its evidence.
export async function loadImportedResultSnapshot(
  client: ReturnType<typeof createAdminSupabaseClient>,
  categoryId: string,
) {
  const { data, error } = await client.from("result_runs")
    .select(RESULT_RUN_SNAPSHOT_COLUMNS)
    .eq("event_category_id", categoryId)
    .eq("status", "succeeded")
    .in("summary_json->>rankingMethod", ["preserved_legacy_rank", "legacy_official_rank"])
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle<ResultRunSnapshotRow>();
  if (error) throw error;
  return data;
}

export function selectResultSnapshotRun(input: {
  runs: ResultRunSnapshotRow[];
  preferredRunId?: string | null;
  publishedRunId?: string | null;
  importedRunId?: string | null;
}) {
  const hasRun = (id: string | null | undefined) => id && input.runs.some((run) => run.id === id);
  if (hasRun(input.preferredRunId)) return input.preferredRunId!;
  // Publications remain authoritative, including explicitly corrected versions.
  // Keep later native drafts in history; do not delete or waive their anomalies.
  if (input.importedRunId) {
    return hasRun(input.publishedRunId) ? input.publishedRunId! : input.importedRunId;
  }
  return input.runs.find((run) => run.status === "succeeded")?.id ?? input.publishedRunId ?? null;
}
