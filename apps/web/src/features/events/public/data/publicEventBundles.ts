import { raceFeeAt, type RaceFeePeriod } from "@raceson/domain/categories";
import type { SupabaseClient } from "@supabase/supabase-js";

type JsonRecord = Record<string, unknown>;

type PublicEventDetailEditionRow = JsonRecord & {
  id: string;
  event_series_id: string;
  slug: string;
  name: string;
  activity_type: string | null;
  start_date: string;
  end_date: string | null;
  timezone: string | null;
  location_name: string | null;
  status: string | null;
  registration_open_at: string | null;
  registration_close_at: string | null;
  cover_image_url: string | null;
  about_text: string | null;
  organizer_rules: string | null;
  website_url: string | null;
  instagram_url: string | null;
  facebook_url: string | null;
  general_timeline_json: unknown;
};

type PublicEventDetailSeriesRow = JsonRecord & {
  id: string;
  name: string | null;
  organization_id: string | null;
  description: string | null;
  location_name: string | null;
  country_code: string | null;
};

export type PublicEventDetailCategoryRow = JsonRecord & {
  id: string;
  event_edition_id: string;
  slug: string;
  name: string;
  cover_image_url: string | null;
  sport_code: string | null;
  distance_km: number | null;
  elevation_gain_m: number | null;
  capacity: number | null;
  registration_fee_cents: number | null;
  registration_fee_periods?: RaceFeePeriod[];
  currency: string | null;
  start_at: string | null;
  minimum_age: number | null;
  maximum_age: number | null;
  allowed_genders: unknown;
  eligibility_note: string | null;
  results_mode: string | null;
  display_order: number | null;
  status: string | null;
};

type PublicEventDetailDocumentRow = JsonRecord & {
  title: string;
  document_type: string | null;
  storage_path: string;
};

type PublicEventDetailPreviousEditionRow = JsonRecord & {
  slug: string;
  name: string | null;
  start_date: string;
};

export type PublicEventDetailLocationRow = JsonRecord & {
  id: string;
  location_type: string;
  label: string;
  description: string | null;
  place_label: string | null;
  latitude: number | string | null;
  longitude: number | string | null;
  display_order: number | null;
};

type PublicEventDetailSportRow = JsonRecord & {
  sport_code: string;
  is_primary: boolean;
};

type PublicEventDetailOrganizationRow = JsonRecord & {
  name: string;
  country_code: string | null;
  region: string | null;
  city: string | null;
  description: string | null;
  website_url: string | null;
  instagram_url: string | null;
  facebook_url: string | null;
  linkedin_url: string | null;
  youtube_url: string | null;
  tiktok_url: string | null;
  x_url: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  logo_image_url: string | null;
  profile_visibility: string | null;
  contact_details_visibility: string | null;
};

export type PublicEventRegistrationCountRow = JsonRecord & {
  event_category_id: string;
  registered_count: number | null;
  confirmed_count: number | null;
  waitlisted_count: number | null;
  dns_count: number | null;
  checked_in_count: number | null;
  starter_count: number | null;
  finisher_count: number | null;
};

type PublicEventDetailSnapshotRow = JsonRecord & {
  id: string;
  event_category_id: string;
  track_template_id: string;
  track_version_id: string | null;
};

type PublicEventDetailTrackTemplateRow = JsonRecord & {
  id: string;
  slug: string;
  name: string;
};

type PublicEventDetailLeagueRoundRow = JsonRecord & {
  league_season_id: string;
  event_edition_id: string;
  round_number: number;
};

type PublicEventDetailLeagueSeasonRow = JsonRecord & {
  id: string;
  league_id: string;
};

type PublicEventDetailLeagueRow = JsonRecord & {
  id: string;
  slug: string;
  name: string;
};

export type PublicEventDetailBundle = {
  edition: PublicEventDetailEditionRow;
  series: PublicEventDetailSeriesRow | null;
  categories: PublicEventDetailCategoryRow[];
  documents: PublicEventDetailDocumentRow[];
  previous_editions: PublicEventDetailPreviousEditionRow[];
  locations: PublicEventDetailLocationRow[];
  sports: PublicEventDetailSportRow[];
  organization: PublicEventDetailOrganizationRow | null;
  registration_counts: PublicEventRegistrationCountRow[];
  snapshots: PublicEventDetailSnapshotRow[];
  published_track_version_ids: string[];
  track_templates: PublicEventDetailTrackTemplateRow[];
  league_rounds: PublicEventDetailLeagueRoundRow[];
  league_seasons: PublicEventDetailLeagueSeasonRow[];
  leagues: PublicEventDetailLeagueRow[];
};

export type PublicEventGeometryBundleRow = JsonRecord & {
  event_category_id: string;
  track_snapshot_id: string;
  polyline_json: unknown;
  elevation_profile_json: unknown;
  checkpoints_json: unknown;
  checkpoint_rows: JsonRecord[];
};

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function records(value: unknown) {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function strings(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export async function loadPublicEventDetailBundle(
  supabase: SupabaseClient,
  slug: string,
): Promise<PublicEventDetailBundle | null> {
  const { data, error } = await supabase.rpc("public_event_detail_bundle", {
    target_event_slug: slug,
  });
  if (error) throw error;
  if (!isRecord(data) || !isRecord(data.edition)) return null;
  if (
    typeof data.edition.id !== "string"
    || typeof data.edition.event_series_id !== "string"
    || typeof data.edition.slug !== "string"
    || typeof data.edition.name !== "string"
  ) {
    return null;
  }

  return {
    edition: data.edition as PublicEventDetailBundle["edition"],
    series: isRecord(data.series) ? data.series as PublicEventDetailBundle["series"] : null,
    categories: records(data.categories) as PublicEventDetailBundle["categories"],
    documents: records(data.documents) as PublicEventDetailBundle["documents"],
    previous_editions: records(data.previous_editions) as PublicEventDetailBundle["previous_editions"],
    locations: records(data.locations) as PublicEventDetailBundle["locations"],
    sports: records(data.sports) as PublicEventDetailBundle["sports"],
    organization: isRecord(data.organization)
      ? data.organization as PublicEventDetailBundle["organization"]
      : null,
    registration_counts: records(data.registration_counts) as PublicEventDetailBundle["registration_counts"],
    snapshots: records(data.snapshots) as PublicEventDetailBundle["snapshots"],
    published_track_version_ids: strings(data.published_track_version_ids),
    track_templates: records(data.track_templates) as PublicEventDetailBundle["track_templates"],
    league_rounds: records(data.league_rounds) as PublicEventDetailBundle["league_rounds"],
    league_seasons: records(data.league_seasons) as PublicEventDetailBundle["league_seasons"],
    leagues: records(data.leagues) as PublicEventDetailBundle["leagues"],
  };
}

export async function loadPublicEventGeometryBundle(
  supabase: SupabaseClient,
  eventEditionId: string,
): Promise<PublicEventGeometryBundleRow[]> {
  const { data, error } = await supabase.rpc("public_event_geometry_bundle", {
    target_event_edition_id: eventEditionId,
  });
  if (error) throw error;

  return records(data).flatMap((row) => (
    typeof row.event_category_id === "string" && typeof row.track_snapshot_id === "string"
      ? [{
          ...row,
          event_category_id: row.event_category_id,
          track_snapshot_id: row.track_snapshot_id,
          polyline_json: row.polyline_json,
          elevation_profile_json: row.elevation_profile_json,
          checkpoints_json: row.checkpoints_json,
          checkpoint_rows: records(row.checkpoint_rows),
        } satisfies PublicEventGeometryBundleRow]
      : []
  ));
}
