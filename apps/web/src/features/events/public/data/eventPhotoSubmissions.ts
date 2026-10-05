import { apiRequest } from "@/lib/api";
import { getSupabaseBrowserClient } from "@/lib/supabase";

export const EVENT_COMMUNITY_PHOTO_BUCKET = "event-community-photos";
export const MAX_EVENT_PHOTO_BYTES = 20 * 1024 * 1024;
export const MAX_EVENT_PHOTO_FILES = 6;

const acceptedEventPhotoTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

function safeObjectFileName(fileName: string) {
  return fileName
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 120) || "race-photo";
}

export function validateEventPhotoFiles(files: File[]) {
  if (!files.length) return "Choose at least one photo.";
  if (files.length > MAX_EVENT_PHOTO_FILES) return `Choose up to ${MAX_EVENT_PHOTO_FILES} photos at a time.`;

  for (const file of files) {
    if (!acceptedEventPhotoTypes.has(file.type)) return "Choose JPG, PNG, or WebP photos.";
    if (file.size > MAX_EVENT_PHOTO_BYTES) return "Each photo must be smaller than 20 MB.";
  }

  return null;
}

export async function submitEventPhotoFiles(input: {
  eventEditionId: string;
  eventCategoryId: string;
  userId: string;
  files: File[];
}) {
  const validationMessage = validateEventPhotoFiles(input.files);
  if (validationMessage) throw new Error(validationMessage);

  const client = getSupabaseBrowserClient();
  if (!client) throw new Error("Photo uploads are not configured.");

  const { data: { session }, error: sessionError } = await client.auth.getSession();
  if (sessionError) throw sessionError;
  if (!session || session.user.id !== input.userId) {
    throw new Error("Sign in again to share race photos.");
  }

  const uploadResults = await Promise.allSettled(input.files.map(async (file) => {
      const storagePath = `${input.userId}/${input.eventEditionId}/${input.eventCategoryId}/${crypto.randomUUID()}-${safeObjectFileName(file.name)}`;
      const { error: uploadError } = await client.storage
        .from(EVENT_COMMUNITY_PHOTO_BUCKET)
        .upload(storagePath, file, {
          cacheControl: "3600",
          contentType: file.type,
          upsert: false,
        });

      if (uploadError) {
        if (/row-level security/i.test(uploadError.message)) {
          throw new Error("Photo submissions are not available for this race.");
        }
        throw uploadError;
      }

      return {
        objectPath: storagePath,
        originalFileName: file.name,
        contentType: file.type,
        sizeBytes: file.size,
      };
  }));

  const submissionRows = uploadResults.flatMap((result) => (
    result.status === "fulfilled" ? [result.value] : []
  ));
  const uploadedPaths = submissionRows.map((row) => row.objectPath);
  const failedUpload = uploadResults.find((result) => result.status === "rejected");

  if (failedUpload?.status === "rejected") {
    if (uploadedPaths.length) {
      await client.storage.from(EVENT_COMMUNITY_PHOTO_BUCKET).remove(uploadedPaths);
    }
    throw failedUpload.reason;
  }

  try {
    const response = await apiRequest<{ submittedCount: number }>({
      path: `/v1/event-editions/${input.eventEditionId}/photo-submissions`,
      method: "POST",
      body: {
        eventCategoryId: input.eventCategoryId,
        photos: submissionRows,
      },
    });
    return response.submittedCount;
  } catch (error) {
    if (uploadedPaths.length) {
      await client.storage.from(EVENT_COMMUNITY_PHOTO_BUCKET).remove(uploadedPaths);
    }
    throw error;
  }
}
