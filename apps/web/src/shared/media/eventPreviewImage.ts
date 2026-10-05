import { getTrackThemeCard } from "@/lib/track-image-themes";
import { resolveRecoveredPublicMediaUrl } from "./recoveredPublicMedia";

export function firstPreviewImage(
  ...candidates: Array<string | null | undefined>
) {
  for (const candidate of candidates) {
    const imageUrl = resolveRecoveredPublicMediaUrl(candidate);
    if (imageUrl) return imageUrl;
  }

  return null;
}

export function getTrackGalleryPreviewImageUrl(value: unknown) {
  if (typeof value === "string") {
    const imageUrl = value.trim();
    return imageUrl && !imageUrl.toLowerCase().startsWith("data:")
      ? resolveRecoveredPublicMediaUrl(imageUrl)
      : null;
  }
  if (!Array.isArray(value)) return null;

  const galleryItems = value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const imageUrl = typeof record.imageUrl === "string" ? record.imageUrl.trim() : "";
    if (!imageUrl || imageUrl.toLowerCase().startsWith("data:")) return [];
    return [{ imageUrl, isDefault: record.isDefault === true }];
  });

  return resolveRecoveredPublicMediaUrl(galleryItems.find((item) => item.isDefault)?.imageUrl
    ?? galleryItems[0]?.imageUrl
    ?? null);
}

export function resolveTrackPreviewImage(
  trackMedia: unknown,
  linkedEventImageUrl?: string | null,
) {
  return firstPreviewImage(
    getTrackGalleryPreviewImageUrl(trackMedia),
    linkedEventImageUrl,
  );
}

export function resolveEventPreviewImage({
  eventImageUrl,
  raceImageUrls = [],
  platformFallbackImageUrl,
  fallbackContext = [],
}: {
  eventImageUrl?: string | null;
  raceImageUrls?: Array<string | null | undefined>;
  platformFallbackImageUrl?: string | null;
  fallbackContext?: Array<string | null | undefined>;
}) {
  return firstPreviewImage(
    eventImageUrl,
    ...raceImageUrls,
    platformFallbackImageUrl,
  ) ?? getTrackThemeCard(...fallbackContext);
}
