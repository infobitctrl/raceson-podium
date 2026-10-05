import type { RequestSession } from "@raceson/domain/auth";
import { badRequest, conflict, forbidden, notFound } from "./errors.js";
import { loadServerEnv, type ServerEnv } from "./env.js";
import { canViewPublishedEvent, type PublishedEventVisibility } from "./event-visibility.js";
import { createAdminSupabaseClient } from "./supabase.js";

const EVENT_COMMUNITY_PHOTO_BUCKET = "event-community-photos";
const MAX_EVENT_PHOTO_BYTES = 20 * 1024 * 1024;
const MAX_EVENT_PHOTO_FILES = 6;
const EVENT_PHOTO_CONTENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export type SubmitEventPhotoSubmissionsInput = {
  eventEditionId: string;
  eventCategoryId: string;
  photos: Array<{
    objectPath: string;
    originalFileName: string;
    contentType: string;
    sizeBytes: number;
  }>;
};

export async function submitEventPhotoSubmissions(
  session: RequestSession,
  input: SubmitEventPhotoSubmissionsInput,
  env: ServerEnv = loadServerEnv(),
) {
  if (!input.photos.length || input.photos.length > MAX_EVENT_PHOTO_FILES) {
    throw badRequest(`Submit between one and ${MAX_EVENT_PHOTO_FILES} photos at a time`);
  }

  const athleteProfileId = session.account.primaryAthleteProfileId;
  const adminClient = createAdminSupabaseClient(env);
  const [{ data: category, error: categoryError }, { data: edition, error: editionError }] = await Promise.all([
    adminClient
      .from("event_categories")
      .select("id,event_edition_id,organizer_deleted_at")
      .eq("id", input.eventCategoryId)
      .maybeSingle(),
    adminClient
      .from("event_editions")
      .select("id,status,published_at,public_visibility,organizer_deleted_at")
      .eq("id", input.eventEditionId)
      .maybeSingle<PublishedEventVisibility>(),
  ]);

  if (categoryError) throw categoryError;
  if (!category || category.organizer_deleted_at || category.event_edition_id !== input.eventEditionId) {
    throw notFound("Race category not found for this race");
  }
  if (editionError) throw editionError;
  if (!await canViewPublishedEvent(edition, athleteProfileId, env)) {
    throw forbidden("Photo submissions are not available for this race.");
  }

  const expectedPrefix = `${session.account.userId}/${input.eventEditionId}/${input.eventCategoryId}/`;
  const normalizedPhotos = input.photos.map((photo) => {
    const objectPath = photo.objectPath.trim();
    const originalFileName = photo.originalFileName.trim();
    if (!objectPath.startsWith(expectedPrefix) || objectPath.includes("..") || objectPath.length > 500) {
      throw badRequest("Invalid race photo object path");
    }
    if (!originalFileName || originalFileName.length > 255) {
      throw badRequest("Invalid race photo file name");
    }
    if (!EVENT_PHOTO_CONTENT_TYPES.has(photo.contentType)) {
      throw badRequest("Use JPG, PNG, or WebP race photos");
    }
    if (!Number.isInteger(photo.sizeBytes) || photo.sizeBytes <= 0 || photo.sizeBytes > MAX_EVENT_PHOTO_BYTES) {
      throw badRequest("Each race photo must be smaller than 20 MB");
    }

    return {
      ...photo,
      objectPath,
      originalFileName,
      objectName: objectPath.slice(expectedPrefix.length),
    };
  });

  const storedPhotoChecks = await Promise.all(normalizedPhotos.map(async (photo) => {
    const { data: storedObjects, error } = await adminClient.storage
      .from(EVENT_COMMUNITY_PHOTO_BUCKET)
      .list(expectedPrefix.slice(0, -1), { search: photo.objectName, limit: 10 });
    if (error) throw error;
    return (storedObjects ?? []).some((item) => item.name === photo.objectName);
  }));

  if (storedPhotoChecks.some((exists) => !exists)) {
    throw badRequest("Upload every race photo before submitting it for review");
  }

  const { data: insertedRows, error: insertError } = await adminClient
    .from("event_photo_submissions")
    .insert(normalizedPhotos.map((photo) => ({
      event_edition_id: input.eventEditionId,
      event_category_id: input.eventCategoryId,
      athlete_profile_id: athleteProfileId,
      submitted_by_user_id: session.account.userId,
      storage_path: photo.objectPath,
      original_file_name: photo.originalFileName,
      mime_type: photo.contentType,
      size_bytes: photo.sizeBytes,
      moderation_status: "pending",
    })))
    .select("id");

  if (insertError) {
    if (insertError.code === "23505") throw conflict("One of these race photos was already submitted");
    throw insertError;
  }

  return {
    submittedCount: insertedRows?.length ?? input.photos.length,
    submissionIds: (insertedRows ?? []).map((row) => row.id),
  };
}
