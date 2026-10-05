import { getSupabaseBrowserClient } from "@/lib/supabase";
import type { OrganizerTrackGalleryItem } from "@/lib/organizer-management";
import {
  normalizeUploadImage,
  type UploadImageNormalizationOptions,
} from "@/shared/media/normalizeUploadImage";

export const TRACK_MEDIA_BUCKET = "track-media";
export const TRACK_GPX_BUCKET = "track-gpx";
export const MAX_TRACK_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_TRACK_GPX_BYTES = 50 * 1024 * 1024;
export const TRACK_UPLOAD_IMAGE_MAX_DIMENSION = 2_560;
export const TRACK_UPLOAD_IMAGE_TARGET_BYTES = 2 * 1024 * 1024;

const TRACK_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_CONCURRENT_IMAGE_UPLOADS = 2;

function safeObjectFileName(fileName: string, fallback: string) {
  const normalized = fileName
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 120);
  return normalized || fallback;
}

export function validateTrackImage(file: Pick<File, "size" | "type">) {
  if (!TRACK_IMAGE_TYPES.has(file.type)) {
    return "Choose a JPG, PNG, or WebP image.";
  }
  if (file.size > MAX_TRACK_IMAGE_BYTES) {
    return "Each image must be smaller than 20 MB.";
  }
  return null;
}

export function validateTrackGpx(file: Pick<File, "name" | "size">) {
  if (!file.name.toLowerCase().endsWith(".gpx")) {
    return "Choose a GPX file.";
  }
  if (file.size > MAX_TRACK_GPX_BYTES) {
    return "The GPX file must be smaller than 50 MB.";
  }
  return null;
}

async function mapSettledWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
) {
  const results = new Array<PromiseSettledResult<R>>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = { status: "fulfilled", value: await mapper(items[index]!) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  }));

  return results;
}

export async function uploadTrackGalleryFiles(
  organizationId: string,
  files: File[],
  normalization: UploadImageNormalizationOptions = {
    maxDimension: TRACK_UPLOAD_IMAGE_MAX_DIMENSION,
    targetBytes: TRACK_UPLOAD_IMAGE_TARGET_BYTES,
  },
): Promise<OrganizerTrackGalleryItem[]> {
  for (const file of files) {
    const validationMessage = validateTrackImage(file);
    if (validationMessage) throw new Error(validationMessage);
  }

  const client = getSupabaseBrowserClient();
  if (!client) throw new Error("Supabase is not configured for image uploads.");

  const uploads = await mapSettledWithConcurrency(
    files,
    MAX_CONCURRENT_IMAGE_UPLOADS,
    async (file) => {
      const preparedFile = await normalizeUploadImage(file, normalization);
      const storagePath = `${organizationId}/gallery/${crypto.randomUUID()}-${safeObjectFileName(preparedFile.name, "track-image.webp")}`;
      const { error } = await client.storage
        .from(TRACK_MEDIA_BUCKET)
        .upload(storagePath, preparedFile, {
          cacheControl: "31536000",
          contentType: preparedFile.type,
          upsert: false,
        });

      if (error) throw error;

      const { data } = client.storage.from(TRACK_MEDIA_BUCKET).getPublicUrl(storagePath);
      if (!data.publicUrl) {
        await client.storage.from(TRACK_MEDIA_BUCKET).remove([storagePath]);
        throw new Error("The image was uploaded, but its public URL is unavailable.");
      }

      return {
        id: crypto.randomUUID(),
        imageUrl: data.publicUrl,
        storagePath,
        caption: null,
        isDefault: false,
      } satisfies OrganizerTrackGalleryItem;
    },
  );

  const successful = uploads.flatMap((upload) =>
    upload.status === "fulfilled" ? [upload.value] : [],
  );
  const failed = uploads.find((upload) => upload.status === "rejected");
  if (failed) {
    await Promise.allSettled(
      successful.map((item) =>
        client.storage.from(TRACK_MEDIA_BUCKET).remove([item.storagePath!]),
      ),
    );
    throw failed.reason;
  }

  return successful;
}

export async function uploadTrackGpxFile(organizationId: string, file: File) {
  const validationMessage = validateTrackGpx(file);
  if (validationMessage) throw new Error(validationMessage);

  const client = getSupabaseBrowserClient();
  if (!client) throw new Error("Supabase is not configured for GPX uploads.");

  const storagePath = `${organizationId}/gpx/${crypto.randomUUID()}-${safeObjectFileName(file.name, "track.gpx")}`;
  const { error } = await client.storage.from(TRACK_GPX_BUCKET).upload(storagePath, file, {
    cacheControl: "3600",
    contentType: "application/gpx+xml",
    upsert: false,
  });

  if (error) throw error;
  return storagePath;
}

export async function removeTrackStorageObject(bucket: string, storagePath: string) {
  const client = getSupabaseBrowserClient();
  if (!client) return;

  const { error } = await client.storage.from(bucket).remove([storagePath]);
  if (error) throw error;
}
