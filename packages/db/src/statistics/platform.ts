import type { RequestSession } from "@raceson/domain/auth";
import type { PlatformStatisticsPeriod } from "@raceson/domain";
import { createAdminSupabaseClient } from "../supabase.js";
import { requirePlatformCapability } from "../platform-capabilities.js";
import { loadServerEnv, type ServerEnv } from "../env.js";
import { buildPlatformStatistics, type PlatformStatisticsSource } from "./platform-model.js";

const PAGE_SIZE = 500;
const MAX_ROWS = 100_000;
const projections = {
  athletes: ["athlete_profiles", "id,created_at,status,merged_into_athlete_profile_id"],
  organizations: ["organizations", "id,created_at,name,status"],
  series: ["event_series", "id,organization_id"],
  editions: ["event_editions", "id,created_at,event_series_id,published_at,status,is_practice,organizer_deleted_at"],
  categories: ["event_categories", "id,created_at,event_edition_id,status,results_mode,organizer_deleted_at"],
  registrations: ["registrations", "id,created_at,event_category_id,athlete_profile_id,status,source"],
  clubs: ["clubs", "id,created_at,status,merged_into_club_id"],
  leagues: ["leagues", "id,created_at"],
  seasons: ["league_seasons", "id,created_at,league_id,published_at"],
  rounds: ["league_rounds", "id,league_season_id,event_edition_id"],
  routes: ["track_templates", "id,created_at"],
  versions: ["track_versions", "id,track_template_id,published_at"],
  snapshots: ["event_category_track_snapshots", "id,track_template_id,event_category_id"],
} as const;

export async function getPlatformStatistics(session: RequestSession, period: PlatformStatisticsPeriod, env: ServerEnv = loadServerEnv()) {
  requirePlatformCapability(session, "platform.records.view");
  const client = createAdminSupabaseClient(env);
  const asOf = new Date();
  const source = { accounts: [] } as unknown as PlatformStatisticsSource;
  // Bounded parallel batches avoid a request storm; short pages are not silently truncated.
  const keys = Object.keys(projections) as Array<keyof typeof projections>;
  for (let batch = 0; batch < keys.length; batch += 4) {
    await Promise.all(keys.slice(batch, batch + 4).map(async (key) => {
      const [table, columns] = projections[key];
      const rows: unknown[] = [];
      for (let offset = 0; ; offset += PAGE_SIZE) {
        const { data, error } = await client.from(table).select(columns).order("id").range(offset, offset + PAGE_SIZE - 1).abortSignal(AbortSignal.timeout(15_000));
        if (error) throw error;
        rows.push(...(data ?? []));
        if ((data ?? []).length < PAGE_SIZE) break;
        if (rows.length >= MAX_ROWS) throw new Error("Platform statistics source exceeds the supported read size.");
      }
      Object.assign(source, { [key]: rows });
    }));
  }
  // Auth identities stay on the server. Only id/date enter the aggregate builder.
  for (let page = 1; ; page++) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: PAGE_SIZE });
    if (error) throw error;
    for (const user of data.users) {
      if (!(user as { deleted_at?: string }).deleted_at && !user.is_anonymous) source.accounts.push({ id: user.id, created_at: user.created_at });
    }
    if (data.users.length < PAGE_SIZE) break;
    if (page * PAGE_SIZE >= MAX_ROWS) throw new Error("Platform statistics accounts exceed the supported read size.");
  }
  return buildPlatformStatistics(source, period, asOf);
}
