import type { RequestSession } from "@raceson/domain/auth";
import { badRequest, forbidden, notFound } from "./errors.js";
import { loadServerEnv, type ServerEnv } from "./env.js";
import { requireAthleteProfileId, requireOrganizationAccess, requireVerifiedEmail } from "./permissions.js";
import { createAdminSupabaseClient } from "./supabase.js";

const TRACK_REVIEW_META_MARKER = "\n\n[tport-review-meta]";

export type TrackReviewReaction = "helpful" | "not_helpful" | null;

export type PublicTrackReviewComment = {
  id: string;
  reviewId: string;
  authorAthleteProfileId: string;
  authorName: string;
  body: string;
  createdAt: string;
};

export type OrganizerTrackCommunityReview = {
  id: string;
  authorName: string;
  rating: number;
  title: string | null;
  body: string;
  createdAt: string;
  helpfulCount: number;
  notHelpfulCount: number;
  comments: PublicTrackReviewComment[];
};

type ReviewRow = {
  id: string;
  track_template_id: string;
  athlete_profile_id: string;
  rating: number;
  title: string | null;
  body: string;
  created_at: string;
  helpful_count: number;
  not_helpful_count: number;
};

type CommentRow = {
  id: string;
  track_review_id: string;
  athlete_profile_id: string;
  body: string;
  created_at: string;
};

function visibleReviewBody(body: string) {
  const markerIndex = body.lastIndexOf(TRACK_REVIEW_META_MARKER);
  return (markerIndex === -1 ? body : body.slice(0, markerIndex)).trim();
}

async function requirePublicReview(reviewId: string, env: ServerEnv) {
  const adminClient = createAdminSupabaseClient(env);
  const { data: review, error } = await adminClient
    .from("track_reviews")
    .select("id,track_template_id")
    .eq("id", reviewId)
    .maybeSingle<{ id: string; track_template_id: string }>();
  if (error) throw error;
  if (!review) throw notFound("Review not found");

  const { data: publishedVersion, error: versionError } = await adminClient
    .from("track_versions")
    .select("id")
    .eq("track_template_id", review.track_template_id)
    .not("published_at", "is", null)
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (versionError) throw versionError;
  if (!publishedVersion) throw forbidden("This review is not on a public route");
  return review;
}

async function requireTrackModerationAccess(session: RequestSession, trackTemplateId: string, env: ServerEnv) {
  const adminClient = createAdminSupabaseClient(env);
  const { data: track, error } = await adminClient
    .from("track_templates")
    .select("id,organization_id")
    .eq("id", trackTemplateId)
    .maybeSingle<{ id: string; organization_id: string }>();
  if (error) throw error;
  if (!track) throw notFound("Route not found");
  requireOrganizationAccess(session, track.organization_id, "manage");
}

async function loadAthleteNames(athleteProfileIds: string[], env: ServerEnv) {
  if (!athleteProfileIds.length) return new Map<string, string>();
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient
    .from("athlete_profiles")
    .select("id,display_name")
    .in("id", Array.from(new Set(athleteProfileIds)))
    .returns<Array<{ id: string; display_name: string }>>();
  if (error) throw error;
  return new Map((data ?? []).map((athlete) => [athlete.id, athlete.display_name]));
}

export async function setTrackReviewReaction(
  session: RequestSession,
  reviewId: string,
  reaction: TrackReviewReaction,
  env: ServerEnv = loadServerEnv(),
) {
  requireVerifiedEmail(session);
  const athleteProfileId = requireAthleteProfileId(session);
  await requirePublicReview(reviewId, env);
  const adminClient = createAdminSupabaseClient(env);

  if (reaction === null) {
    const { error } = await adminClient.from("track_review_reactions").delete()
      .eq("track_review_id", reviewId).eq("athlete_profile_id", athleteProfileId);
    if (error) throw error;
  } else {
    const { error } = await adminClient.from("track_review_reactions").upsert({
      track_review_id: reviewId,
      athlete_profile_id: athleteProfileId,
      reaction: reaction === "helpful" ? 1 : -1,
    }, { onConflict: "track_review_id,athlete_profile_id" });
    if (error) throw error;
  }

  const { data: review, error: reviewError } = await adminClient
    .from("track_reviews")
    .select("helpful_count,not_helpful_count")
    .eq("id", reviewId)
    .single<{ helpful_count: number; not_helpful_count: number }>();
  if (reviewError) throw reviewError;
  return {
    reviewId,
    reaction,
    helpfulCount: review.helpful_count,
    notHelpfulCount: review.not_helpful_count,
  };
}

export async function addTrackReviewComment(
  session: RequestSession,
  reviewId: string,
  body: string,
  env: ServerEnv = loadServerEnv(),
): Promise<PublicTrackReviewComment> {
  requireVerifiedEmail(session);
  const athleteProfileId = requireAthleteProfileId(session);
  await requirePublicReview(reviewId, env);
  const normalizedBody = body.trim();
  if (normalizedBody.length < 2 || normalizedBody.length > 2000) {
    throw badRequest("Comments must be between 2 and 2000 characters");
  }

  const adminClient = createAdminSupabaseClient(env);
  const { data: comment, error } = await adminClient.from("track_review_comments").insert({
    track_review_id: reviewId,
    athlete_profile_id: athleteProfileId,
    body: normalizedBody,
  }).select("id,track_review_id,athlete_profile_id,body,created_at").single<CommentRow>();
  if (error) throw error;
  return {
    id: comment.id,
    reviewId: comment.track_review_id,
    authorAthleteProfileId: comment.athlete_profile_id,
    authorName: session.account.displayName || "Trail Runner",
    body: comment.body,
    createdAt: comment.created_at,
  };
}

export async function removeOwnTrackReviewComment(
  session: RequestSession,
  commentId: string,
  env: ServerEnv = loadServerEnv(),
) {
  requireVerifiedEmail(session);
  const athleteProfileId = requireAthleteProfileId(session);
  const adminClient = createAdminSupabaseClient(env);
  const { data: comment, error } = await adminClient.from("track_review_comments")
    .select("id,athlete_profile_id").eq("id", commentId)
    .maybeSingle<{ id: string; athlete_profile_id: string }>();
  if (error) throw error;
  if (!comment) throw notFound("Comment not found");
  if (comment.athlete_profile_id !== athleteProfileId) throw forbidden("You can only remove your own comment");
  const { error: deleteError } = await adminClient.from("track_review_comments").delete().eq("id", commentId);
  if (deleteError) throw deleteError;
  return { commentId, removed: true };
}

export async function getOrganizerTrackCommunity(
  session: RequestSession,
  trackTemplateId: string,
  env: ServerEnv = loadServerEnv(),
): Promise<OrganizerTrackCommunityReview[]> {
  await requireTrackModerationAccess(session, trackTemplateId, env);
  const adminClient = createAdminSupabaseClient(env);
  const { data: reviews, error } = await adminClient.from("track_reviews")
    .select("id,track_template_id,athlete_profile_id,rating,title,body,created_at,helpful_count,not_helpful_count")
    .eq("track_template_id", trackTemplateId).order("created_at", { ascending: false }).returns<ReviewRow[]>();
  if (error) throw error;

  const reviewIds = (reviews ?? []).map((review) => review.id);
  const { data: comments, error: commentsError } = reviewIds.length
    ? await adminClient.from("track_review_comments")
        .select("id,track_review_id,athlete_profile_id,body,created_at")
        .in("track_review_id", reviewIds).order("created_at", { ascending: true }).returns<CommentRow[]>()
    : { data: [] as CommentRow[], error: null };
  if (commentsError) throw commentsError;

  const athleteNames = await loadAthleteNames([
    ...(reviews ?? []).map((review) => review.athlete_profile_id),
    ...(comments ?? []).map((comment) => comment.athlete_profile_id),
  ], env);
  const commentsByReviewId = new Map<string, PublicTrackReviewComment[]>();
  for (const comment of comments ?? []) {
    const mapped = {
      id: comment.id,
      reviewId: comment.track_review_id,
      authorAthleteProfileId: comment.athlete_profile_id,
      authorName: athleteNames.get(comment.athlete_profile_id) ?? "Trail Runner",
      body: comment.body,
      createdAt: comment.created_at,
    };
    commentsByReviewId.set(comment.track_review_id, [...(commentsByReviewId.get(comment.track_review_id) ?? []), mapped]);
  }

  return (reviews ?? []).map((review) => ({
    id: review.id,
    authorName: athleteNames.get(review.athlete_profile_id) ?? "Trail Runner",
    rating: review.rating,
    title: review.title,
    body: visibleReviewBody(review.body),
    createdAt: review.created_at,
    helpfulCount: review.helpful_count,
    notHelpfulCount: review.not_helpful_count,
    comments: commentsByReviewId.get(review.id) ?? [],
  }));
}

export async function removeOrganizerTrackReview(
  session: RequestSession,
  trackTemplateId: string,
  reviewId: string,
  env: ServerEnv = loadServerEnv(),
) {
  await requireTrackModerationAccess(session, trackTemplateId, env);
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient.from("track_reviews").delete()
    .eq("id", reviewId).eq("track_template_id", trackTemplateId).select("id").maybeSingle<{ id: string }>();
  if (error) throw error;
  if (!data) throw notFound("Review not found on this route");
  return { reviewId, removed: true };
}

export async function removeOrganizerTrackReviewComment(
  session: RequestSession,
  trackTemplateId: string,
  commentId: string,
  env: ServerEnv = loadServerEnv(),
) {
  await requireTrackModerationAccess(session, trackTemplateId, env);
  const adminClient = createAdminSupabaseClient(env);
  const { data: comment, error } = await adminClient.from("track_review_comments")
    .select("id,track_review_id").eq("id", commentId)
    .maybeSingle<{ id: string; track_review_id: string }>();
  if (error) throw error;
  if (!comment) throw notFound("Comment not found");
  const { data: review, error: reviewError } = await adminClient.from("track_reviews")
    .select("id").eq("id", comment.track_review_id).eq("track_template_id", trackTemplateId)
    .maybeSingle<{ id: string }>();
  if (reviewError) throw reviewError;
  if (!review) throw notFound("Comment not found on this route");
  const { error: deleteError } = await adminClient.from("track_review_comments").delete().eq("id", commentId);
  if (deleteError) throw deleteError;
  return { commentId, removed: true };
}
