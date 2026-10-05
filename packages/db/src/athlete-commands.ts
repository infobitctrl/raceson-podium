import type { RequestSession } from "@raceson/domain/auth";
import { badRequest, conflict, forbidden, notFound } from "./errors.js";
import { loadServerEnv, type ServerEnv } from "./env.js";
import { requireAthleteProfileId, requireVerifiedEmail } from "./permissions.js";
import { createAdminSupabaseClient } from "./supabase.js";

const TRACK_CONDITION_META_MARKER = "\n\n[tport-condition-meta]";
const TRACK_REVIEW_META_MARKER = "\n\n[tport-review-meta]";

export type TrackConditionStatus = "good" | "caution" | "warning" | "closed";

export type SubmitTrackConditionReportInput = {
  trackSlug: string;
  status: TrackConditionStatus;
  title?: string | null;
  note: string;
  cautionType?: string | null;
  lat?: number | null;
  lng?: number | null;
  distKm?: number | null;
  elev?: number | null;
};

export type SubmitTrackReviewInput = {
  trackSlug: string;
  rating: number;
  text: string;
  difficulty?: string | null;
  terrainLabels?: string[];
  navigationQuality?: string | null;
  bestForTags?: string[];
};

export type ClubMembershipState = "pending" | "active";
export type AthleteFavoriteKind = "athlete" | "club";

export type ClubMembershipCommandResult = {
  membershipId: string | null;
  clubId: string;
  status: ClubMembershipState | "removed";
  changed: boolean;
};

type PostgrestErrorLike = {
  code?: string;
  message?: string;
};

function throwAthleteCommandError(error: PostgrestErrorLike): never {
  if (error.code === "P0002") {
    throw notFound(error.message ?? "Requested resource not found");
  }
  if (error.code === "42501") {
    throw forbidden(error.message ?? "This action is not allowed");
  }
  if (error.code === "P0001" && /up to 3 clubs/i.test(error.message ?? "")) {
    throw conflict("You can join up to 3 clubs at the same time.");
  }
  if (error.code === "22023") {
    throw badRequest(error.message ?? "Invalid command");
  }
  throw error;
}

function normalizeSelections(values: string[] | undefined) {
  return Array.from(
    new Set(
      (values ?? [])
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
}

function serializeConditionNote(input: SubmitTrackConditionReportInput) {
  const note = input.note.trim() || "Use extra caution around this section of the route.";
  const metadata = {
    cautionType: input.cautionType?.trim() || undefined,
    lat: input.lat ?? undefined,
    lng: input.lng ?? undefined,
    distKm: input.distKm ?? undefined,
    elev: input.elev ?? undefined,
  };
  return `${note}${TRACK_CONDITION_META_MARKER}${JSON.stringify(metadata)}`;
}

function serializeReviewBody(input: SubmitTrackReviewInput) {
  const body = input.text.trim();
  const metadata = {
    difficulty: input.difficulty?.trim() || undefined,
    terrainLabels: normalizeSelections(input.terrainLabels),
    navigationQuality: input.navigationQuality?.trim() || undefined,
    bestForTags: normalizeSelections(input.bestForTags),
  };
  const hasMetadata = Boolean(
    metadata.difficulty
      || metadata.terrainLabels.length
      || metadata.navigationQuality
      || metadata.bestForTags.length,
  );
  return hasMetadata
    ? `${body}${TRACK_REVIEW_META_MARKER}${JSON.stringify(metadata)}`
    : body;
}

function buildReviewTitle(input: SubmitTrackReviewInput) {
  const primaryBestFor = normalizeSelections(input.bestForTags)[0];
  if (primaryBestFor) return `${primaryBestFor} review`;

  const body = input.text.trim();
  const firstSentence = body.split(/(?<=[.!?])\s+/)[0]?.trim() || body;
  return firstSentence.length <= 72
    ? firstSentence
    : `${firstSentence.slice(0, 69).trimEnd()}...`;
}

export async function submitTrackConditionReport(
  session: RequestSession,
  input: SubmitTrackConditionReportInput,
  env: ServerEnv = loadServerEnv(),
) {
  requireVerifiedEmail(session);
  const athleteProfileId = requireAthleteProfileId(session);
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient.rpc("service_submit_track_condition_report", {
    p_actor_user_id: session.account.userId,
    p_athlete_profile_id: athleteProfileId,
    p_track_slug: input.trackSlug.trim(),
    p_status: input.status,
    p_title: input.title?.trim() || null,
    p_note: serializeConditionNote(input),
  });

  if (error) throwAthleteCommandError(error);
  return data;
}

export async function upsertTrackReview(
  session: RequestSession,
  input: SubmitTrackReviewInput,
  env: ServerEnv = loadServerEnv(),
) {
  requireVerifiedEmail(session);
  const athleteProfileId = requireAthleteProfileId(session);
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient.rpc("service_upsert_track_review", {
    p_actor_user_id: session.account.userId,
    p_athlete_profile_id: athleteProfileId,
    p_track_slug: input.trackSlug.trim(),
    p_rating: Math.round(input.rating),
    p_title: buildReviewTitle(input),
    p_body: serializeReviewBody(input),
  });

  if (error) throwAthleteCommandError(error);
  return data;
}

export async function removeEventFavorite(
  session: RequestSession,
  eventSlug: string,
  env: ServerEnv = loadServerEnv(),
) {
  const athleteProfileId = requireAthleteProfileId(session);
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient.rpc("service_remove_event_favorite", {
    p_actor_user_id: session.account.userId,
    p_athlete_profile_id: athleteProfileId,
    p_event_slug: eventSlug.trim(),
  });

  if (error) throwAthleteCommandError(error);
  return data as { eventEditionId: string; removed: boolean };
}

export async function setCurrentAthleteFavorite(
  session: RequestSession,
  kind: AthleteFavoriteKind,
  slug: string,
  following: boolean,
  env: ServerEnv = loadServerEnv(),
) {
  const athleteProfileId = requireAthleteProfileId(session);
  const adminClient = createAdminSupabaseClient(env);
  const normalizedSlug = slug.trim();
  const source = kind === "athlete"
    ? await adminClient
        .from("public_athlete_profiles")
        .select("id")
        .eq("slug", normalizedSlug)
        .eq("status", "active")
        .maybeSingle()
    : await adminClient
        .from("clubs")
        .select("id")
        .eq("slug", normalizedSlug)
        .eq("status", "active")
        .maybeSingle();

  if (source.error) throw source.error;
  if (!source.data?.id) throw notFound(kind === "athlete" ? "Athlete not found." : "Club not found.");

  const entityType = kind === "athlete" ? "athlete_profile" : "club";
  const targetColumn = kind === "athlete" ? "target_athlete_profile_id" : "club_id";
  if (following) {
    const { error } = await adminClient.from("athlete_favorites").insert({
      athlete_profile_id: athleteProfileId,
      entity_type: entityType,
      event_edition_id: null,
      track_template_id: null,
      club_id: kind === "club" ? source.data.id : null,
      target_athlete_profile_id: kind === "athlete" ? source.data.id : null,
    });
    if (error && error.code !== "23505") throwAthleteCommandError(error);
  } else {
    const { error } = await adminClient
      .from("athlete_favorites")
      .delete()
      .eq("athlete_profile_id", athleteProfileId)
      .eq("entity_type", entityType)
      .eq(targetColumn, source.data.id);
    if (error) throwAthleteCommandError(error);
  }

  return { kind, slug: normalizedSlug, following };
}

export async function getCurrentAthleteClubMembershipStates(
  session: RequestSession,
  env: ServerEnv = loadServerEnv(),
) {
  const athleteProfileId = requireAthleteProfileId(session);
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient
    .from("club_memberships")
    .select("club_id,status")
    .eq("athlete_profile_id", athleteProfileId)
    .in("status", ["active", "pending"]);

  if (error) throw error;

  return Object.fromEntries(
    (data ?? []).flatMap((membership) => (
      membership.club_id && (membership.status === "active" || membership.status === "pending")
        ? [[membership.club_id, membership.status as ClubMembershipState]]
        : []
    )),
  ) as Record<string, ClubMembershipState>;
}

export async function joinCurrentAthleteClub(
  session: RequestSession,
  clubId: string,
  env: ServerEnv = loadServerEnv(),
): Promise<ClubMembershipCommandResult> {
  // Username-only accounts are created with an internally confirmed Auth
  // identity and intentionally have no public email to verify. Treat that
  // credential as the trust boundary for club membership commands.
  if (!session.account.loginUsername) {
    requireVerifiedEmail(session);
  }
  const athleteProfileId = requireAthleteProfileId(session);
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient.rpc("service_join_club", {
    p_actor_user_id: session.account.userId,
    p_athlete_profile_id: athleteProfileId,
    p_club_id: clubId,
  });

  if (error) throwAthleteCommandError(error);
  return data as ClubMembershipCommandResult;
}

export async function leaveCurrentAthleteClub(
  session: RequestSession,
  clubId: string,
  env: ServerEnv = loadServerEnv(),
): Promise<ClubMembershipCommandResult> {
  const athleteProfileId = requireAthleteProfileId(session);
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient.rpc("service_leave_club", {
    p_actor_user_id: session.account.userId,
    p_athlete_profile_id: athleteProfileId,
    p_club_id: clubId,
  });

  if (error) throwAthleteCommandError(error);
  return data as ClubMembershipCommandResult;
}

export async function setCurrentAthletePrimaryClub(
  session: RequestSession,
  clubId: string,
  env: ServerEnv = loadServerEnv(),
) {
  const athleteProfileId = requireAthleteProfileId(session);
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient.rpc("service_set_primary_club", {
    p_actor_user_id: session.account.userId,
    p_athlete_profile_id: athleteProfileId,
    p_club_id: clubId,
  });

  if (error) throwAthleteCommandError(error);
  return data as { clubId: string; changed: boolean };
}
