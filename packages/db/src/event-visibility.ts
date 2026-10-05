import { type ServerEnv } from "./env.js";
import { createAdminSupabaseClient } from "./supabase.js";

export type PublishedEventVisibility = {
  id: string;
  status: string;
  published_at: string | null;
  public_visibility: string | null;
  organizer_deleted_at: string | null;
};

// The athlete ID must come from the verified request session, never request input.
// Discovery visibility is independent of registration/participation eligibility.
export async function canViewPublishedEvent(
  edition: PublishedEventVisibility | null,
  athleteProfileId: string | null,
  env: ServerEnv,
) {
  if (!edition?.published_at || edition.status === "draft" || edition.organizer_deleted_at) return false;
  if (edition.public_visibility === "public") return true;
  if (edition.public_visibility !== "club_members" || !athleteProfileId) return false;

  const client = createAdminSupabaseClient(env);
  const { data: clubs, error: clubsError } = await client
    .from("event_eligible_clubs")
    .select("club_id")
    .eq("event_edition_id", edition.id)
    .returns<Array<{ club_id: string }>>();
  if (clubsError) throw clubsError;
  if (!clubs?.length) return false;
  const { data: memberships, error } = await client
    .from("club_memberships")
    .select("id")
    .eq("athlete_profile_id", athleteProfileId)
    .eq("status", "active")
    .in("club_id", clubs.map((club) => club.club_id))
    .limit(1);
  if (error) throw error;
  return Boolean(memberships?.length);
}
