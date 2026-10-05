import type { RequestSession } from "@raceson/domain/auth";
import { badRequest, forbidden, notFound } from "./errors.js";
import { loadServerEnv, type ServerEnv } from "./env.js";
import { requireAthleteProfileId, requireEditionAccess, requireVerifiedEmail } from "./permissions.js";
import { createAdminSupabaseClient } from "./supabase.js";
import { canViewPublishedEvent, type PublishedEventVisibility } from "./event-visibility.js";

export type EventReviewComment = {
  id: string;
  reviewId: string;
  authorAthleteProfileId: string;
  authorName: string;
  body: string;
  createdAt: string;
};

export type OrganizerEventCommunitySummary = {
  eventEditionId: string;
  reviewCount: number;
  commentCount: number;
  latestActivityAt: string | null;
};

type EventReviewRow = {
  id: string;
  event_edition_id: string;
  athlete_profile_id: string;
  rating: number;
  title: string | null;
  body: string;
  created_at: string;
};

type EventReviewCommentRow = {
  id: string;
  event_review_id: string;
  athlete_profile_id: string;
  body: string;
  created_at: string;
};

function buildEventReviewTitle(body: string) {
  const firstSentence = body.split(/(?<=[.!?])\s+/)[0]?.trim() || body;
  return firstSentence.length <= 72
    ? firstSentence
    : `${firstSentence.slice(0, 69).trimEnd()}...`;
}

async function requirePublicEventEditionBySlug(eventSlug: string, athleteProfileId: string, env: ServerEnv) {
  const adminClient = createAdminSupabaseClient(env);
  const { data: edition, error } = await adminClient
    .from("event_editions")
    .select("id,slug,status,published_at,public_visibility,organizer_deleted_at")
    .eq("slug", eventSlug)
    .maybeSingle<PublishedEventVisibility & { slug: string }>();
  if (error) throw error;
  if (!edition) throw notFound("Race not found");
  if (!await canViewPublishedEvent(edition, athleteProfileId, env)) {
    throw forbidden("Feedback is available only for public races");
  }
  return edition;
}

async function requirePublicEventReview(reviewId: string, athleteProfileId: string, env: ServerEnv) {
  const adminClient = createAdminSupabaseClient(env);
  const { data: review, error } = await adminClient
    .from("event_reviews")
    .select("id,event_edition_id,is_public")
    .eq("id", reviewId)
    .maybeSingle<{ id: string; event_edition_id: string; is_public: boolean }>();
  if (error) throw error;
  if (!review || !review.is_public) throw notFound("Race review not found");

  const { data: edition, error: editionError } = await adminClient
    .from("event_editions")
    .select("id,status,published_at,public_visibility,organizer_deleted_at")
    .eq("id", review.event_edition_id)
    .maybeSingle<PublishedEventVisibility>();
  if (editionError) throw editionError;
  if (!await canViewPublishedEvent(edition, athleteProfileId, env)) {
    throw forbidden("This review is not on a public race");
  }
  return review;
}

export async function upsertEventReview(
  session: RequestSession,
  input: { eventSlug: string; rating: number; text: string },
  env: ServerEnv = loadServerEnv(),
) {
  requireVerifiedEmail(session);
  const athleteProfileId = requireAthleteProfileId(session);
  const body = input.text.trim();
  const rating = Math.round(input.rating);
  if (body.length < 2 || body.length > 3000) {
    throw badRequest("Race reviews must be between 2 and 3000 characters");
  }
  if (rating < 1 || rating > 5) throw badRequest("Choose a rating between 1 and 5 stars");

  const edition = await requirePublicEventEditionBySlug(input.eventSlug.trim(), athleteProfileId, env);
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient
    .from("event_reviews")
    .upsert({
      event_edition_id: edition.id,
      athlete_profile_id: athleteProfileId,
      rating,
      title: buildEventReviewTitle(body),
      body,
      is_public: true,
    }, { onConflict: "event_edition_id,athlete_profile_id" })
    .select("id,event_edition_id,athlete_profile_id,rating,title,body,created_at")
    .single<EventReviewRow>();
  if (error) throw error;
  return data;
}

export async function addEventReviewComment(
  session: RequestSession,
  reviewId: string,
  body: string,
  env: ServerEnv = loadServerEnv(),
): Promise<EventReviewComment> {
  requireVerifiedEmail(session);
  const athleteProfileId = requireAthleteProfileId(session);
  const normalizedBody = body.trim();
  if (normalizedBody.length < 2 || normalizedBody.length > 2000) {
    throw badRequest("Comments must be between 2 and 2000 characters");
  }
  await requirePublicEventReview(reviewId, athleteProfileId, env);

  const adminClient = createAdminSupabaseClient(env);
  const { data: comment, error } = await adminClient
    .from("event_review_comments")
    .insert({
      event_review_id: reviewId,
      athlete_profile_id: athleteProfileId,
      body: normalizedBody,
      is_public: true,
    })
    .select("id,event_review_id,athlete_profile_id,body,created_at")
    .single<EventReviewCommentRow>();
  if (error) throw error;
  return {
    id: comment.id,
    reviewId: comment.event_review_id,
    authorAthleteProfileId: comment.athlete_profile_id,
    authorName: session.account.displayName || "Trail Runner",
    body: comment.body,
    createdAt: comment.created_at,
  };
}

export async function removeOwnEventReviewComment(
  session: RequestSession,
  commentId: string,
  env: ServerEnv = loadServerEnv(),
) {
  requireVerifiedEmail(session);
  const athleteProfileId = requireAthleteProfileId(session);
  const adminClient = createAdminSupabaseClient(env);
  const { data: comment, error } = await adminClient
    .from("event_review_comments")
    .select("id,athlete_profile_id")
    .eq("id", commentId)
    .maybeSingle<{ id: string; athlete_profile_id: string }>();
  if (error) throw error;
  if (!comment) throw notFound("Comment not found");
  if (comment.athlete_profile_id !== athleteProfileId) {
    throw forbidden("You can only remove your own comment");
  }
  const { error: deleteError } = await adminClient
    .from("event_review_comments")
    .delete()
    .eq("id", commentId);
  if (deleteError) throw deleteError;
  return { commentId, removed: true as const };
}

export async function getOrganizerEventCommunitySummaries(
  session: RequestSession,
  eventEditionIds: string[],
  env: ServerEnv = loadServerEnv(),
): Promise<OrganizerEventCommunitySummary[]> {
  const uniqueEventIds = Array.from(new Set(eventEditionIds));
  await Promise.all(uniqueEventIds.map((eventId) => requireEditionAccess(session, eventId, "manage", env)));
  if (!uniqueEventIds.length) return [];

  const adminClient = createAdminSupabaseClient(env);
  const { data: reviews, error } = await adminClient
    .from("event_reviews")
    .select("id,event_edition_id,created_at")
    .in("event_edition_id", uniqueEventIds)
    .returns<Array<{ id: string; event_edition_id: string; created_at: string }>>();
  if (error) throw error;

  const reviewIds = (reviews ?? []).map((review) => review.id);
  const { data: comments, error: commentsError } = reviewIds.length
    ? await adminClient
        .from("event_review_comments")
        .select("event_review_id,created_at")
        .in("event_review_id", reviewIds)
        .returns<Array<{ event_review_id: string; created_at: string }>>()
    : { data: [] as Array<{ event_review_id: string; created_at: string }>, error: null };
  if (commentsError) throw commentsError;

  const eventIdByReviewId = new Map((reviews ?? []).map((review) => [review.id, review.event_edition_id]));
  return uniqueEventIds.map((eventEditionId) => {
    const eventReviews = (reviews ?? []).filter((review) => review.event_edition_id === eventEditionId);
    const eventComments = (comments ?? []).filter(
      (comment) => eventIdByReviewId.get(comment.event_review_id) === eventEditionId,
    );
    const latestActivityAt = [...eventReviews.map((review) => review.created_at), ...eventComments.map((comment) => comment.created_at)]
      .sort((left, right) => right.localeCompare(left))[0] ?? null;
    return {
      eventEditionId,
      reviewCount: eventReviews.length,
      commentCount: eventComments.length,
      latestActivityAt,
    };
  });
}
